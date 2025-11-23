from flask import Blueprint, request, jsonify, current_app
from ai_client import ask_ai, ask_ai_stream
from shared_context import (
    get_user_model, get_firestore_conversation, create_firestore_conversation,
    add_firestore_message, set_conversation_title_if_default, get_user_document,
    add_firestore_messages_batch,
    sanitize_input
)
from routes.general import get_user_key, check_rate_limit, get_hashed_codes, is_free_model
import logging
import json
import base64
import tiktoken
import threading

chat_bp = Blueprint('chat', __name__)
logger = logging.getLogger(__name__)

def estimate_tokens(text):
    """Estimate token count for text using tiktoken for accuracy."""
    if not text:
        return 0
    try:
        encoding = tiktoken.get_encoding("cl100k_base")
        # Add 20 tokens overhead per message for safety (system prompts, formatting, etc.)
        return len(encoding.encode(str(text))) + 20
    except Exception as e:
        logger.error(f"Error encoding tokens: {e}")
        # Fallback to heuristic if tiktoken fails
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
        # Always calculate tokens to ensure accuracy (legacy counts might be wrong)
        # Benchmarking shows this takes ~50ms for 100k tokens, which is acceptable.
        content = message.get('content', '')
        if isinstance(content, list):
            # Handle multimodal content
            text_content = ""
            for item in content:
                if item.get('type') == 'text':
                    text_content += item.get('text', '')
            msg_tokens = estimate_tokens(text_content)
        else:
            msg_tokens = estimate_tokens(content)
        
        if total_tokens + msg_tokens > available_tokens:
            break
            
        total_tokens += msg_tokens
        limited_messages.append(message)
    
    # Reverse back to chronological order
    return list(reversed(limited_messages))

@chat_bp.route('/chat', methods=['POST'])
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
        
        # Limit context for free models to stay under 32k tokens, premium to 95k tokens (safety buffer)
        if premium:
            context = limit_context_to_tokens(context, max_tokens=95000)
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
        pending_messages = []
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
                # Add to persistent history (batched later)
                pending_messages.append({ 'role': 'system', 'content': system_text })
                # Also include in the in-memory context for this immediate call
                context = (context or []) + [{ 'role': 'system', 'content': system_text }]
                # Mark as injected for this conversation
                document['injected_conversation_id'] = conversation_id
                
                # Re-apply context limiting after document injection
                if premium:
                    context = limit_context_to_tokens(context, max_tokens=95000)
                elif is_free_model(model):
                    context = limit_context_to_tokens(context, max_tokens=30000)

        final_message = message
        
        response = ask_ai(final_message, model, context, image_bytes)
        
        # Batch Firestore writes in background thread (non-blocking)
        messages_to_save = pending_messages + [
            {'role': 'user', 'content': message},
            {'role': 'assistant', 'content': response}
        ]
        
        def save_to_firestore():
            try:
                add_firestore_messages_batch(user_key, conversation_id, messages_to_save)
                set_conversation_title_if_default(user_key, conversation_id, message)
            except Exception as e:
                logger.error(f"Error saving to Firestore in background: {e}")
        
        # Run Firestore writes in background thread to avoid blocking the response
        threading.Thread(target=save_to_firestore, daemon=True).start()
        
        return jsonify({
            'type': 'chat',
            'response': response,
            'model': model,
            'conversation_id': conversation_id
        })
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@chat_bp.route('/chat/stream', methods=['POST'])
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
        
        # Limit context for free models to stay under 32k tokens, premium to 95k tokens (safety buffer)
        if premium:
            context = limit_context_to_tokens(context, max_tokens=95000)
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
        pending_messages = []
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
                # Persist and include in streaming context immediately (batched later)
                pending_messages.append({ 'role': 'system', 'content': system_text })
                context = (context or []) + [{ 'role': 'system', 'content': system_text }]
                document['injected_conversation_id'] = conversation_id
                
                # Re-apply context limiting after document injection
                if premium:
                    context = limit_context_to_tokens(context, max_tokens=95000)
                elif is_free_model(model):
                    context = limit_context_to_tokens(context, max_tokens=30000)

        final_message = message

        def generate():
            full_response = ""
            full_thinking = ""
            try:
                for chunk in ask_ai_stream(final_message, model, context, image_bytes):
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
                
                # Save in background thread to avoid blocking stream completion
                messages_to_save = pending_messages + [
                    {'role': 'user', 'content': message},
                    {'role': 'assistant', 'content': full_response}
                ]
                
                def save_to_firestore():
                    try:
                        add_firestore_messages_batch(user_key, conversation_id, messages_to_save)
                        set_conversation_title_if_default(user_key, conversation_id, message)
                    except Exception as e:
                        logger.error(f"Error saving to Firestore in background: {e}")
                
                # Run Firestore writes in background thread
                threading.Thread(target=save_to_firestore, daemon=True).start()
                
                yield f"data: {json.dumps({'type': 'done', 'done': True, 'model': model, 'conversation_id': conversation_id})}\n\n"
                    
            except Exception as e:
                logger.error(f"Error in streaming chat: {e}")
                yield f"data: {json.dumps({'error': f'Error: {str(e)}'})}\n\n"

        return current_app.response_class(
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
