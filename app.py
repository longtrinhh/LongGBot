from flask import Flask, render_template, request, jsonify, make_response
from flask_compress import Compress
import json
import asyncio
import logging
import base64
import io
from ai_client import ask_ai, ask_ai_stream
from ai_image_client import AIImageClient
from shared_context import (
    get_user_model, set_user_model, clear_user_context,
    get_firestore_conversations_for_user, get_firestore_conversation, add_firestore_message, create_firestore_conversation, delete_firestore_conversation,
    set_user_document, get_user_document, clear_user_document, has_user_document,
    set_conversation_title_if_default, generate_title_from_text, sanitize_input
)
from config import CHAT_MODELS, IMAGE_GEN_MODELS, MODEL_NAME, FLASK_SECRET_KEY
import uuid
import os
import hashlib
from PIL import Image
from document_processor import DocumentProcessor
from collections import defaultdict
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

compress = Compress()
compress.init_app(app)
app.config['COMPRESS_MIMETYPES'] = ['text/html', 'text/css', 'text/javascript', 'application/json', 'application/javascript']
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

image_client = AIImageClient()

rate_limit_storage = defaultdict(list)
RATE_LIMIT_REQUESTS = 30
RATE_LIMIT_WINDOW = 60

def check_rate_limit(user_key):
    """Simple rate limiting: max requests per time window"""
    if not user_key:
        return False
    
    now = datetime.utcnow()
    window_start = now - timedelta(seconds=RATE_LIMIT_WINDOW)
    
    requests = rate_limit_storage[user_key]
    requests = [req_time for req_time in requests if req_time > window_start]
    rate_limit_storage[user_key] = requests
    
    if len(requests) >= RATE_LIMIT_REQUESTS:
        return False
    
    rate_limit_storage[user_key].append(now)
    return True

def load_valid_codes():
    codes_path = os.path.join(os.path.dirname(__file__), 'codes.txt')
    if not os.path.exists(codes_path):
        return set()
    with open(codes_path, 'r') as f:
        return set(line.strip() for line in f if line.strip())

VALID_CODES = load_valid_codes()

def hash_code(code):
    return hashlib.sha256(code.encode('utf-8')).hexdigest()

def get_premium_code_hash():
    code_hash = request.cookies.get('premium_code_hash')
    if not code_hash:
        code = request.headers.get('X-Access-Code') or request.args.get('code') or (request.json.get('code') if request.is_json and request.json else None)
        if code and code in VALID_CODES:
            code_hash = hash_code(code)
    return code_hash

# Cache hashed codes for better performance
_HASHED_CODES_CACHE = None

def get_hashed_codes():
    global _HASHED_CODES_CACHE
    if _HASHED_CODES_CACHE is None:
        _HASHED_CODES_CACHE = {hash_code(c) for c in VALID_CODES}
    return _HASHED_CODES_CACHE

def get_user_key():
    code_hash = get_premium_code_hash()
    if code_hash and code_hash in get_hashed_codes():
        return code_hash
    return request.cookies.get('user_id')

def run_async(coro):
    return asyncio.run(coro)

def estimate_tokens(text):
    """Estimate token count for text. Uses a rough approximation of 4 characters per token."""
    if not text:
        return 0
    # Rough estimation: 4 characters per token (faster than tiktoken)
    return len(str(text)) // 4 + 10

def limit_context_to_tokens(messages, max_tokens=30000):
    """Limit context messages to stay under max_tokens limit - optimized for speed"""
    if not messages:
        return messages
    
    # Reserve tokens for system prompt and current user message
    reserved_tokens = 2000
    available_tokens = max_tokens - reserved_tokens
    
    total_tokens = 0
    limited_messages = []
    
    # Start from the most recent messages and work backwards
    for message in reversed(messages):
        content = message.get('content', '')
        if isinstance(content, list):
            # Handle multimodal content
            text_content = ''
            for item in content:
                if item.get('type') == 'text':
                    text_content += item.get('text', '')
        else:
            text_content = str(content)
        
        # Use fast estimation instead of tiktoken
        message_tokens = estimate_tokens(text_content)
        
        if total_tokens + message_tokens > available_tokens:
            break
            
        total_tokens += message_tokens
        limited_messages.insert(0, message)  # Insert at beginning to maintain order
    
    return limited_messages

def is_free_model(model):
    """Check if a model is in the free tier"""
    free_models = [
        'gpt-4o-mini-search-preview-2025-03-11',
        'gpt-5-nano:free',
        'deepseek-v3.1:free',
        'gpt-oss-120b:free',
        'deepseek-r1-0528:free',
        'qwen3-coder-480b-a35b-instruct:free',
        'kimi-k2-instruct-0905:free'
    ]
    return model in free_models

@app.route('/')
def index():
    user_id = request.cookies.get('user_id')
    code_hash = get_premium_code_hash()
    if not user_id:
        user_id = str(uuid.uuid4())
    premium = code_hash and code_hash in get_hashed_codes()
    user_key = code_hash if premium else user_id
    resp = make_response(render_template(
        'index.html',
        chat_models=CHAT_MODELS,
        image_models=IMAGE_GEN_MODELS,
        current_model=get_user_model(user_key, 'chat') or 'gpt-4o-mini-search-preview-2025-03-11',
        premium=premium
    ))
    
    # Set cookies
    if not request.cookies.get('user_id'):
        resp.set_cookie('user_id', user_id, max_age=60*60*24*365, samesite='Lax')
    if code_hash:
        resp.set_cookie('premium_code_hash', code_hash, max_age=60*60*24*365, samesite='Lax')
    
    # Add security headers (industry best practice)
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['X-XSS-Protection'] = '1; mode=block'
    
    return resp

@app.route('/validate_code', methods=['POST'])
def validate_code():
    code = request.json.get('code', '')
    code_hash = hash_code(code)
    if code in VALID_CODES:
        resp = jsonify({'valid': True})
        resp.set_cookie('premium_code_hash', code_hash, max_age=60*60*24*365)
        return resp
    else:
        resp = jsonify({'valid': False})
        resp.set_cookie('premium_code_hash', '', expires=0)
        return resp, 403

@app.route('/conversations', methods=['GET'])
def list_conversations():
    try:
        user_key = get_user_key()
        conversations = get_firestore_conversations_for_user(user_key)
        
        # Handle case where Firestore is unavailable
        if conversations is None:
            conversations = []
        
        # Simplified sorting - faster than complex key function
        def get_sort_key(conv):
            return conv.get('created_at') or conv.get('last_updated') or conv.get('conversation_id', '')
        
        conversations_sorted = sorted(conversations, key=get_sort_key, reverse=True)
        
        # Format for frontend - avoid processing all messages
        summaries = []
        for conv in conversations_sorted:
            messages = conv.get('messages', [])
            summaries.append({
                'conversation_id': conv.get('conversation_id'),
                'title': conv.get('title', 'New Conversation'),
                'first_message': messages[0]['content'] if messages else '',
                'last_updated': conv.get('last_updated'),
                'created_at': conv.get('created_at'),
                'message_count': len(messages)
            })
        return jsonify({'conversations': summaries})
    except Exception as e:
        logger.error(f"Error listing conversations: {e}", exc_info=True)
        # Return empty list instead of error to allow app to continue
        return jsonify({'conversations': []})

@app.route('/conversations', methods=['POST'])
def new_conversation():
    user_key = get_user_key()
    if not user_key:
        return jsonify({'error': 'User not identified. Please reload the page.'}), 400
    data = request.get_json() or {}
    title = data.get('title')
    try:
        conv_id = create_firestore_conversation(user_key, title)
        return jsonify({'conversation_id': conv_id})
    except Exception as e:
        return jsonify({'error': f'Exception: {str(e)}'}), 500

@app.route('/conversations/<conversation_id>', methods=['GET'])
def get_conversation(conversation_id):
    try:
        user_key = get_user_key()
        messages = get_firestore_conversation(user_key, conversation_id)
        return jsonify({'messages': messages if messages is not None else []})
    except Exception as e:
        logger.error(f"Error getting conversation {conversation_id}: {e}", exc_info=True)
        return jsonify({'messages': [], 'error': 'Unable to load conversation'})

@app.route('/conversations/<conversation_id>/message', methods=['POST'])
def add_message(conversation_id):
    user_key = get_user_key()
    data = request.get_json()
    message = data.get('message')
    role = data.get('role', 'user')
    if not message:
        return jsonify({'error': 'Message cannot be empty'}), 400
    add_firestore_message(user_key, conversation_id, {'role': role, 'content': message})
    # If this is the first user message in an existing conversation, set the title
    if role == 'user':
        try:
            set_conversation_title_if_default(user_key, conversation_id, message)
        except Exception as e:
            logger.warning(f"Unable to set conversation title: {e}")
    return jsonify({'success': True})

@app.route('/conversations/<conversation_id>', methods=['DELETE'])
def delete_conversation(conversation_id):
    user_key = get_user_key()
    if not user_key:
        return jsonify({'error': 'User not identified.'}), 400
    
    if not check_rate_limit(user_key):
        return jsonify({'error': 'Rate limit exceeded'}), 429
    
    try:
        success = delete_firestore_conversation(user_key, conversation_id)
        if not success:
            return jsonify({'error': 'Failed to delete conversation or unauthorized'}), 403
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        image_data = data.get('image', '')
        conversation_id = data.get('conversation_id')
        user_key = get_user_key()
        
        if not user_key:
            return jsonify({'error': 'User not identified'}), 401
        
        if not check_rate_limit(user_key):
            return jsonify({'error': 'Rate limit exceeded. Please slow down.'}), 429
        
        message = sanitize_input(message, max_length=50000)
        
        premium = user_key and user_key in get_hashed_codes()
        
        if not message:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        if premium:
            model = get_user_model(user_key, 'chat') or 'claude-sonnet-4-20250514-thinking'
        else:
            model = get_user_model(user_key, 'chat') or 'gpt-4o-mini-search-preview-2025-03-11'
        
        if conversation_id:
            context = get_firestore_conversation(user_key, conversation_id)
        else:
            # Create new conversation without setting title yet (will be set later)
            conversation_id = create_firestore_conversation(user_key)
            context = []
        
        # Limit context for free models to stay under 32k tokens, premium to 100k tokens
        if premium:
            context = limit_context_to_tokens(context, max_tokens=100000)
        elif is_free_model(model):
            context = limit_context_to_tokens(context, max_tokens=30000)
            
        image_keywords = [
            "generate image", "tạo ảnh", "tạo tranh", "tạo logo", "gen image", 
            "gen pic", "gen photo", "gen logo", "create image", "create pic", 
            "create photo", "create logo"
        ]
        is_image_request = any(keyword in message.lower() for keyword in image_keywords)
        if is_image_request:
            if not premium:
                return jsonify({'error': 'Image generation is only available for premium users.'}), 403
            return jsonify({'type': 'image_request', 'prompt': message, 'conversation_id': conversation_id})
        
        image_bytes = None
        if image_data:
            try:
                if image_data.startswith('data:image/'):
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
            except Exception as e:
                logger.error(f"Error decoding image data: {e}")
                return jsonify({'error': 'Invalid image data'}), 400
        
        # If there is a stored document and it hasn't been injected into this conversation yet,
        # inject it once as a system message so it persists in history even after removal.
        document = get_user_document(user_key)
        if document:
            injected_conv = document.get('injected_conversation_id')
            if injected_conv != conversation_id:
                system_text = (
                    f"The user has uploaded a document named '{document['filename']}' "
                    f"(type: {document['file_type']}). Here is its content for reference. "
                    f"Use it to answer future questions until the user uploads a new document or asks to ignore it.\n\n"
                    f"--- DOCUMENT CONTENT START ---\n"
                    f"{document['content']}\n"
                    f"--- DOCUMENT CONTENT END ---"
                )
                # Add to persistent history
                add_firestore_message(user_key, conversation_id, { 'role': 'system', 'content': system_text })
                # Also include in the in-memory context for this immediate call
                context = (context or []) + [{ 'role': 'system', 'content': system_text }]
                # Mark as injected for this conversation
                document['injected_conversation_id'] = conversation_id
                
                # Re-apply context limiting after document injection
                if premium:
                    context = limit_context_to_tokens(context, max_tokens=100000)
                elif is_free_model(model):
                    context = limit_context_to_tokens(context, max_tokens=30000)

        final_message = message
        
        response = run_async(ask_ai(final_message, model, context, image_bytes))
        
        # Batch Firestore writes for better performance
        add_firestore_message(user_key, conversation_id, {'role': 'user', 'content': message})
        add_firestore_message(user_key, conversation_id, {'role': 'assistant', 'content': response})
        
        # Set title after messages are added (single call instead of checking first)
        set_conversation_title_if_default(user_key, conversation_id, message)
        
        return jsonify({
            'type': 'chat',
            'response': response,
            'model': model,
            'conversation_id': conversation_id
        })
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        image_data = data.get('image', '')
        conversation_id = data.get('conversation_id')
        user_key = get_user_key()
        
        if not user_key:
            return jsonify({'error': 'User not identified'}), 401
        
        if not check_rate_limit(user_key):
            return jsonify({'error': 'Rate limit exceeded. Please slow down.'}), 429
        
        message = sanitize_input(message, max_length=50000)
        
        hashed_codes = get_hashed_codes()
        premium = user_key and user_key in hashed_codes
        
        if not message:
            return jsonify({'error': 'Message cannot be empty'}), 400
            
        if premium:
            model = get_user_model(user_key, 'chat') or 'claude-sonnet-4-20250514-thinking'
        else:
            model = get_user_model(user_key, 'chat') or 'gpt-4o-mini-search-preview-2025-03-11'
            
        if conversation_id:
            context = get_firestore_conversation(user_key, conversation_id)
        else:
            # Create new conversation without setting title yet (will be set later)
            conversation_id = create_firestore_conversation(user_key)
            context = []
        
        # Limit context for free models to stay under 32k tokens, premium to 100k tokens
        if premium:
            context = limit_context_to_tokens(context, max_tokens=100000)
        elif is_free_model(model):
            context = limit_context_to_tokens(context, max_tokens=30000)
        
        # Quick check for image generation requests (only if premium)
        if premium and message.lower().startswith(('generate image', 'gen image', 'create image', 'tạo ảnh', 'tạo tranh', 'gen pic')):
            return jsonify({'type': 'image_request', 'prompt': message, 'conversation_id': conversation_id})
            
        image_bytes = None
        if image_data:
            try:
                if image_data.startswith('data:image/'):
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
            except Exception as e:
                logger.error(f"Error decoding image data: {e}")
                return jsonify({'error': 'Invalid image data'}), 400

        # Inject document once as a system message in this conversation if needed
        document = get_user_document(user_key)
        if document:
            injected_conv = document.get('injected_conversation_id')
            if injected_conv != conversation_id:
                system_text = (
                    f"The user has uploaded a document named '{document['filename']}' "
                    f"(type: {document['file_type']}). Here is its content for reference. "
                    f"Use it to answer future questions until the user uploads a new document or asks to ignore it.\n\n"
                    f"--- DOCUMENT CONTENT START ---\n"
                    f"{document['content']}\n"
                    f"--- DOCUMENT CONTENT END ---"
                )
                # Persist and include in streaming context immediately
                add_firestore_message(user_key, conversation_id, { 'role': 'system', 'content': system_text })
                context = (context or []) + [{ 'role': 'system', 'content': system_text }]
                document['injected_conversation_id'] = conversation_id
                
                # Re-apply context limiting after document injection
                if premium:
                    context = limit_context_to_tokens(context, max_tokens=100000)
                elif is_free_model(model):
                    context = limit_context_to_tokens(context, max_tokens=30000)

        final_message = message

        def generate():
            full_response = ""
            full_thinking = ""
            try:
                async def stream_response():
                    nonlocal full_response, full_thinking
                    async for chunk in ask_ai_stream(final_message, model, context, image_bytes):
                        if chunk:
                            try:
                                chunk_data = json.loads(chunk)
                                chunk_type = chunk_data.get('type', 'content')
                                text = chunk_data.get('text', '')
                                
                                if chunk_type == 'thinking':
                                    full_thinking += text
                                    # Send thinking separately with special marker
                                    yield f"data: {json.dumps({'type': 'thinking', 'chunk': text, 'model': model, 'conversation_id': conversation_id})}\n\n"
                                else:
                                    # Regular content
                                    full_response += text
                                    yield f"data: {json.dumps({'type': 'content', 'chunk': text, 'model': model, 'conversation_id': conversation_id})}\n\n"
                            except json.JSONDecodeError:
                                # Fallback for non-JSON chunks (backward compatibility)
                                full_response += chunk
                                yield f"data: {json.dumps({'type': 'content', 'chunk': chunk, 'model': model, 'conversation_id': conversation_id})}\n\n"
                    
                    # Save only the actual response without thinking blocks
                    add_firestore_message(user_key, conversation_id, {'role': 'user', 'content': message})
                    add_firestore_message(user_key, conversation_id, {'role': 'assistant', 'content': full_response})
                    
                    set_conversation_title_if_default(user_key, conversation_id, message)
                    
                    yield f"data: {json.dumps({'type': 'done', 'done': True, 'model': model, 'conversation_id': conversation_id})}\n\n"
                
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    async_gen = stream_response()
                    while True:
                        try:
                            chunk = loop.run_until_complete(async_gen.__anext__())
                            yield chunk
                        except StopAsyncIteration:
                            break
                finally:
                    loop.close()
                    
            except Exception as e:
                logger.error(f"Error in streaming chat: {e}")
                yield f"data: {json.dumps({'error': f'Error: {str(e)}'})}\n\n"

        return app.response_class(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
        
    except Exception as e:
        logger.error(f"Error in chat_stream: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/generate_image', methods=['POST'])
def generate_image():
    user_key = get_user_key()
    hashed_codes = get_hashed_codes()
    premium = user_key and user_key in hashed_codes
    if not premium:
        return jsonify({'error': 'Image generation is only available for premium users.'}), 403
    try:
        data = request.get_json()
        prompt = data.get('prompt', '').strip()
        model = data.get('model') or get_user_model(user_key, 'image') or (IMAGE_GEN_MODELS[0][0] if IMAGE_GEN_MODELS else None)
        if not prompt:
            return jsonify({'error': 'Prompt cannot be empty'}), 400
        image_data, image_url = run_async(image_client.generate_image(prompt, model, return_url=True))
        if image_data or image_url:
            image_base64 = base64.b64encode(image_data).decode('utf-8') if image_data else None
            return jsonify({
                'type': 'image',
                'image': f'data:image/jpeg;base64,{image_base64}' if image_base64 else None,
                'image_url': image_url,
                'model': model
            })
        else:
            return jsonify({'error': 'Failed to generate image'}), 500
    except Exception as e:
        logger.error(f"Error generating image: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/edit_image', methods=['POST'])
def edit_image():
    user_key = get_user_key()
    hashed_codes = get_hashed_codes()
    premium = user_key and user_key in hashed_codes
    if not premium:
        return jsonify({'error': 'Image editing is only available for premium users.'}), 403
    try:
        data = request.get_json()
        prompt = data.get('prompt', '').strip()
        image_data = data.get('image', '')
        model = data.get('model') or get_user_model(user_key, 'image') or (IMAGE_GEN_MODELS[0][0] if IMAGE_GEN_MODELS else None)
        if not prompt or not image_data:
            return jsonify({'error': 'Prompt and image are required'}), 400
        try:
            image_bytes = base64.b64decode(image_data.split(',')[1])
        except:
            return jsonify({'error': 'Invalid image data'}), 400
        edited_image_data = run_async(image_client.edit_image(image_bytes, prompt, model))
        if edited_image_data:
            image_base64 = base64.b64encode(edited_image_data).decode('utf-8')
            return jsonify({
                'type': 'image',
                'image': f'data:image/jpeg;base64,{image_base64}',
                'model': model
            })
        else:
            return jsonify({'error': 'Failed to edit image'}), 500
    except Exception as e:
        logger.error(f"Error editing image: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/set_model', methods=['POST'])
def set_model():
    try:
        data = request.get_json()
        model = data.get('model', '')
        model_type = data.get('model_type', 'chat')
        user_key = get_user_key()
        premium = user_key and user_key in [hash_code(c) for c in VALID_CODES]
        if model_type == 'chat':
            if not premium and not is_free_model(model):
                return jsonify({'error': 'This model is only available for premium users.'}), 403
        if model_type == 'image':
            if not premium:
                return jsonify({'error': 'Image models are only available for premium users.'}), 403
        if not model:
            return jsonify({'error': 'Model cannot be empty'}), 400
        set_user_model(user_key, model_type, model)
        return jsonify({'success': True, 'model': model, 'model_type': model_type})
    except Exception as e:
        logger.error(f"Error setting model: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/cancel_stream', methods=['POST'])
def cancel_stream():
    try:
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error canceling stream: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/clear_context', methods=['POST'])
def clear_context():
    try:
        user_key = get_user_key()
        clear_user_context(user_key)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error clearing context: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/clear_document', methods=['POST'])
def clear_document():
    try:
        user_key = get_user_key()
        data = request.get_json(silent=True) or {}
        conversation_id = data.get('conversation_id')
        # Add a system message to instruct the model to ignore the previously uploaded document
        if conversation_id:
            add_firestore_message(user_key, conversation_id, {
                'role': 'system',
                'content': 'The previously uploaded document has been removed. Ignore it for future answers, but keep prior conversation context.'
            })
        clear_user_document(user_key)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error clearing document: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/upload_image', methods=['POST'])
def upload_image():
    try:
        # Premium gate for image uploads - optimized
        user_key = get_user_key()
        hashed_codes = get_hashed_codes()
        premium = user_key and user_key in hashed_codes
        if not premium:
            return jsonify({'error': 'Image upload is only available for premium users.'}), 403
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
            
        file = request.files['image']
        
        if file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
        file_extension = os.path.splitext(file.filename.lower())[1]
        
        if file_extension not in allowed_extensions:
            return jsonify({'error': 'Only image files are allowed. Please upload a JPEG, PNG, GIF, WebP, or BMP file.'}), 400
        
        max_size = 10 * 1024 * 1024
        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > max_size:
            return jsonify({'error': 'File size too large. Please upload an image smaller than 10MB.'}), 400
        
        file.seek(0)
        image_data = file.read()
        
        # Validate and optimize image in one step
        try:
            img = Image.open(io.BytesIO(image_data))
            
            # Validate the image by getting its format
            if img.format not in ['JPEG', 'PNG', 'GIF', 'WEBP', 'BMP']:
                return jsonify({'error': 'Unsupported image format. Please upload a JPEG, PNG, GIF, WebP, or BMP file.'}), 400
            
            # Convert to RGB if necessary (this also validates the image)
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            elif img.mode != 'RGB':
                img = img.convert('RGB')
                
            # Resize if too large (max 1024x1024)
            max_size = 1024
            if img.width > max_size or img.height > max_size:
                img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            # Compress and save optimized image
            optimized_buffer = io.BytesIO()
            img.save(optimized_buffer, format='JPEG', quality=85, optimize=True)
            image_data = optimized_buffer.getvalue()
            
        except Exception as e:
            logger.error(f"Image processing failed: {e}")
            return jsonify({'error': 'Invalid image file. Please upload a valid image.'}), 400
        
        image_base64 = base64.b64encode(image_data).decode('utf-8')
        
        return jsonify({
            'success': True,
            'image': f'data:image/jpeg;base64,{image_base64}'
        })
        
    except Exception as e:
        logger.error(f"Error uploading image: {e}", exc_info=True)
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/upload_document', methods=['POST'])
def upload_document():
    try:
        # Premium gate for document uploads - optimized
        user_key = get_user_key()
        hashed_codes = get_hashed_codes()
        premium = user_key and user_key in hashed_codes
        if not premium:
            return jsonify({'error': 'Document upload is only available for premium users.'}), 403
        if 'document' not in request.files:
            return jsonify({'error': 'No document file provided'}), 400
            
        file = request.files['document']
        
        if file.filename == '':
            return jsonify({'error': 'No document file selected'}), 400
        
        # Validate file using document processor
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Seek back to beginning
        
        is_valid, error_message = DocumentProcessor.validate_document_file(file.filename, file_size)
        if not is_valid:
            return jsonify({'error': error_message}), 400
        
        # Read file data
        file_data = file.read()
        
        # Process document and extract text
        success, content, file_type = DocumentProcessor.process_document(file_data, file.filename)
        
        if not success:
            return jsonify({'error': content}), 400
        
        # Store document content for the user
        set_user_document(user_key, content, file.filename, file_type)
        
        # If a conversation id was provided in headers or query, try to set a title
        conv_hint = request.args.get('conversation_id') or request.headers.get('X-Conversation-Id')
        if conv_hint:
            try:
                # Prefer document filename as a friendly title if current title is default
                base_title = os.path.splitext(file.filename)[0]
                set_conversation_title_if_default(user_key, conv_hint, base_title)
            except Exception:
                pass
        
        return jsonify({
            'success': True,
            'filename': file.filename,
            'file_type': file_type,
            'message': f'Document "{file.filename}" uploaded and processed successfully! You can ask multiple questions about its content. Click the green indicator to remove the document when done.'
        })
        
    except Exception as e:
        logger.error(f"Error uploading document: {e}", exc_info=True)
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/history', methods=['GET'])
def get_history():
    try:
        user_key = get_user_key()
        conversation_id = request.args.get('conversation_id')
        if conversation_id:
            history = get_firestore_conversation(user_key, conversation_id)
        else:
            conversations = get_firestore_conversations_for_user(user_key)
            if conversations:
                conversation_id = conversations[0]['conversation_id']
                history = get_firestore_conversation(user_key, conversation_id)
            else:
                history = []
        return jsonify({'history': history if history is not None else [], 'conversation_id': conversation_id})
    except Exception as e:
        logger.error(f"Error getting history: {e}", exc_info=True)
        return jsonify({'history': [], 'conversation_id': None, 'error': 'Unable to load history'})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 