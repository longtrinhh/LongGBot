from flask import Blueprint, request, jsonify
from ai_client import run_async_global
from ai_image_client import AIImageClient
from shared_context import get_user_model
from config import IMAGE_GEN_MODELS
from routes.general import get_user_key, get_hashed_codes
import logging
import base64

image_bp = Blueprint('image', __name__)
logger = logging.getLogger(__name__)
image_client = AIImageClient()

@image_bp.route('/generate_image', methods=['POST'])
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
        image_data, image_url = run_async_global(image_client.generate_image(prompt, model, return_url=True))
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

@image_bp.route('/edit_image', methods=['POST'])
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
        edited_image_data = run_async_global(image_client.edit_image(image_bytes, prompt, model))
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
