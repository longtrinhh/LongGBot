from flask import Blueprint, render_template, request, jsonify, make_response, send_from_directory
from config import CHAT_MODELS, IMAGE_GEN_MODELS
from shared_context import (
    get_user_model, set_user_model, clear_user_context,
    get_firestore_conversations_for_user, get_firestore_conversation,
    delete_firestore_conversation, create_firestore_conversation,
    set_conversation_title_if_default, add_firestore_message,
    clear_user_document
)
import uuid
import hashlib
import logging
from datetime import datetime, timedelta
from collections import defaultdict
import os

general_bp = Blueprint('general', __name__)
logger = logging.getLogger(__name__)

# Rate limiting
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
    codes_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'codes.txt')
    if not os.path.exists(codes_path):
        return set()
    with open(codes_path, 'r') as f:
        return set(line.strip() for line in f if line.strip())

VALID_CODES_SET = load_valid_codes()

def hash_code(code):
    return hashlib.sha256(code.encode('utf-8')).hexdigest()

def get_premium_code_hash():
    code_hash = request.cookies.get('premium_code_hash')
    if not code_hash:
        code = request.headers.get('X-Access-Code') or request.args.get('code') or (request.json.get('code') if request.is_json and request.json else None)
        if code and code in VALID_CODES_SET:
            code_hash = hash_code(code)
    return code_hash

# Cache hashed codes for better performance
_HASHED_CODES_CACHE = None

def get_hashed_codes():
    global _HASHED_CODES_CACHE
    if _HASHED_CODES_CACHE is None:
        _HASHED_CODES_CACHE = {hash_code(c) for c in VALID_CODES_SET}
    return _HASHED_CODES_CACHE

def get_user_key():
    code_hash = get_premium_code_hash()
    if code_hash and code_hash in get_hashed_codes():
        return code_hash
    return request.cookies.get('user_id')

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

@general_bp.route('/')
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

@general_bp.route('/validate_code', methods=['POST'])
def validate_code():
    code = request.json.get('code', '')
    code_hash = hash_code(code)
    if code in VALID_CODES_SET:
        resp = jsonify({'valid': True})
        resp.set_cookie('premium_code_hash', code_hash, max_age=60*60*24*365)
        return resp
    else:
        resp = jsonify({'valid': False})
        resp.set_cookie('premium_code_hash', '', expires=0)
        return resp, 403

@general_bp.route('/conversations', methods=['GET'])
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

@general_bp.route('/conversations', methods=['POST'])
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

@general_bp.route('/conversations/<conversation_id>', methods=['GET'])
def get_conversation(conversation_id):
    try:
        user_key = get_user_key()
        messages = get_firestore_conversation(user_key, conversation_id)
        return jsonify({'messages': messages if messages is not None else []})
    except Exception as e:
        logger.error(f"Error getting conversation {conversation_id}: {e}", exc_info=True)
        return jsonify({'messages': [], 'error': 'Unable to load conversation'})

@general_bp.route('/conversations/<conversation_id>/message', methods=['POST'])
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

@general_bp.route('/conversations/<conversation_id>', methods=['DELETE'])
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

@general_bp.route('/set_model', methods=['POST'])
def set_model():
    try:
        data = request.get_json()
        model = data.get('model', '')
        model_type = data.get('model_type', 'chat')
        user_key = get_user_key()
        premium = user_key and user_key in get_hashed_codes()
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

@general_bp.route('/cancel_stream', methods=['POST'])
def cancel_stream():
    try:
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error canceling stream: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@general_bp.route('/clear_context', methods=['POST'])
def clear_context():
    try:
        user_key = get_user_key()
        clear_user_context(user_key)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error clearing context: {e}")
        return jsonify({'error': f'Error: {str(e)}'}), 500

@general_bp.route('/clear_document', methods=['POST'])
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

@general_bp.route('/history', methods=['GET'])
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

@general_bp.route('/firebase-config.js')
def firebase_config():
    try:
        root_dir = os.path.dirname(os.path.dirname(__file__))
        return send_from_directory(root_dir, 'firebase-config.js')
    except Exception as e:
        logger.error(f"Error serving firebase-config.js: {e}")
        return "", 404
