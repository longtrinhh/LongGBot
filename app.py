from flask import Flask, render_template, request, jsonify, send_file, make_response
import asyncio
import logging
import base64
import io
from ai_client import ask_ai
from ai_image_client import AIImageClient
from shared_context import get_user_context, add_question_to_context, clear_user_context, get_user_model, set_user_model, get_full_conversation
from config import CHAT_MODELS, IMAGE_GEN_MODELS, MODEL_NAME, FLASK_SECRET_KEY
import uuid
import os
import hashlib
from PIL import Image

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY  # Secure secret key

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize image client
image_client = AIImageClient()

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
    # Try to get hash from cookie, header, or request
    code_hash = request.cookies.get('premium_code_hash')
    if not code_hash:
        # If code is sent directly, hash it
        code = request.headers.get('X-Access-Code') or request.args.get('code') or (request.json.get('code') if request.is_json and request.json else None)
        if code and code in VALID_CODES:
            code_hash = hash_code(code)
    return code_hash

def get_user_key():
    code_hash = get_premium_code_hash()
    if code_hash and code_hash in [hash_code(c) for c in VALID_CODES]:
        return code_hash  # Use hash as key for premium users
    return request.cookies.get('user_id')  # Use user_id for free users

def run_async(coro):
    return asyncio.run(coro)

# Helper to check if user has premium access (code sent from frontend)
def has_premium_access():
    code = request.headers.get('X-Access-Code') or request.args.get('code') or (request.json.get('code') if request.is_json and request.json else None)
    return code in VALID_CODES

@app.route('/')
def index():
    user_id = request.cookies.get('user_id')
    code_hash = get_premium_code_hash()
    if not user_id:
        user_id = str(uuid.uuid4())
    premium = code_hash and code_hash in [hash_code(c) for c in VALID_CODES]
    user_key = code_hash if premium else user_id
    resp = make_response(render_template(
        'index.html',
        chat_models=CHAT_MODELS,
        image_models=IMAGE_GEN_MODELS,
        current_model=get_user_model(user_key, 'chat') or 'gpt-4o-mini-search-preview-2025-03-11',
        premium=premium
    ))
    if not request.cookies.get('user_id'):
        resp.set_cookie('user_id', user_id, max_age=60*60*24*365)  # 1 year
    if code_hash:
        resp.set_cookie('premium_code_hash', code_hash, max_age=60*60*24*365)
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

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '').strip()
        image_data = data.get('image', '')  # Get uploaded image data
        user_key = get_user_key()
        premium = user_key and user_key in [hash_code(c) for c in VALID_CODES]
        if not message:
            return jsonify({'error': 'Message cannot be empty'}), 400
        if premium:
            model = get_user_model(user_key, 'chat') or 'claude-opus-4-20250514-thinking'
        else:
            model = 'gpt-4o-mini-search-preview-2025-03-11'
        context = get_user_context(user_key)
        
        # Check if this is an image generation request
        image_keywords = [
            "generate image", "tạo ảnh", "tạo tranh", "tạo logo", "gen image", 
            "gen pic", "gen photo", "gen logo", "create image", "create pic", 
            "create photo", "create logo"
        ]
        is_image_request = any(keyword in message.lower() for keyword in image_keywords)
        if is_image_request:
            if not premium:
                return jsonify({'error': 'Image generation is only available for premium users.'}), 403
            return jsonify({'type': 'image_request', 'prompt': message})
        
        # Convert base64 image data to bytes if present
        image_bytes = None
        if image_data:
            try:
                # Remove data URL prefix if present
                if image_data.startswith('data:image/'):
                    image_data = image_data.split(',')[1]
                image_bytes = base64.b64decode(image_data)
            except Exception as e:
                logger.error(f"Error decoding image data: {e}")
                return jsonify({'error': 'Invalid image data'}), 400
        
        # Call AI with image data if present
        response = run_async(ask_ai(message, model, context, image_bytes))
        add_question_to_context(user_key, message, response)
        
        return jsonify({
            'type': 'chat',
            'response': response,
            'model': model
        })
    except Exception as e:
        logger.error(f"Error in chat: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/generate_image', methods=['POST'])
def generate_image():
    user_key = get_user_key()
    premium = user_key and user_key in [hash_code(c) for c in VALID_CODES]
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
    premium = user_key and user_key in [hash_code(c) for c in VALID_CODES]
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
            if not premium and model != "gpt-4o-mini-search-preview-2025-03-11":
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

@app.route('/clear_context', methods=['POST'])
def clear_context():
    try:
        user_key = get_user_key()
        clear_user_context(user_key)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error clearing context: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/upload_image', methods=['POST'])
def upload_image():
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image file provided'}), 400
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No image file selected'}), 400
        
        # Validate file type - only accept image files
        allowed_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
        file_extension = os.path.splitext(file.filename.lower())[1]
        if file_extension not in allowed_extensions:
            return jsonify({'error': 'Only image files are allowed. Please upload a JPEG, PNG, GIF, WebP, or BMP file.'}), 400
        
        # Validate file size (max 10MB)
        max_size = 10 * 1024 * 1024  # 10MB
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning
        
        if file_size > max_size:
            return jsonify({'error': 'File size too large. Please upload an image smaller than 10MB.'}), 400
        
        # Additional validation: check if it's actually an image by reading first few bytes
        try:
            image = Image.open(file)
            image.verify()  # Verify it's a valid image
            file.seek(0)  # Reset to beginning after verification
        except Exception:
            return jsonify({'error': 'Invalid image file. Please upload a valid image.'}), 400
        
        image_data = file.read()
        image_base64 = base64.b64encode(image_data).decode('utf-8')
        return jsonify({
            'success': True,
            'image': f'data:image/jpeg;base64,{image_base64}'
        })
    except Exception as e:
        logger.error(f"Error uploading image: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@app.route('/history', methods=['GET'])
def get_history():
    user_key = get_user_key()
    history = get_full_conversation(user_key)
    return jsonify({'history': history})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 