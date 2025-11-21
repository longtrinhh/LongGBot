from flask import Blueprint, request, jsonify
from routes.general import get_user_key, get_hashed_codes, set_conversation_title_if_default
from shared_context import set_user_document
from document_processor import DocumentProcessor
from PIL import Image
import logging
import os
import io
import base64

upload_bp = Blueprint('upload', __name__)
logger = logging.getLogger(__name__)

@upload_bp.route('/upload_image', methods=['POST'])
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

@upload_bp.route('/upload_document', methods=['POST'])
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
