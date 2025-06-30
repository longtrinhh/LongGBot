import aiohttp
import logging
import base64
import re
from io import BytesIO
from PIL import Image
from config import API_KEY, API_BASE_URL, MODEL_NAME
from shared_context import add_question_to_context, get_user_context, get_user_model

logger = logging.getLogger(__name__)

async def encode_image_to_base64(image_data: bytes) -> str:
    """Encode image data to base64 string."""
    try:
        # Open image with PIL to validate and potentially resize
        image = Image.open(BytesIO(image_data))
        
        # Convert to RGB if necessary (for JPEG compatibility)
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize if too large (max 1024x1024 for API efficiency)
        max_size = 1024
        if image.width > max_size or image.height > max_size:
            image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        
        # Save to bytes buffer
        buffer = BytesIO()
        image.save(buffer, format='JPEG', quality=85)
        image_bytes = buffer.getvalue()
        
        # Encode to base64
        return base64.b64encode(image_bytes).decode('utf-8')
    except Exception as e:
        logger.error(f"Error encoding image: {e}")
        return None

def remove_think_block(text):
    """Remove <think>...</think> blocks (including multiline)"""
    return re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)

async def ask_ai(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None) -> str:
    """Ask AI model with optional image support."""
    # Prepare messages
    messages = context[:] if context else []
    
        # Always append the latest user message
    messages.append({"role": "user", "content": question})

    
    # If there's an image, encode it and add to the last user message
    if image_data:
        base64_image = await encode_image_to_base64(image_data)
        if base64_image:
            # Find the last user message and add image to it
            for i in range(len(messages) - 1, -1, -1):
                if messages[i]["role"] == "user":
                    if isinstance(messages[i]["content"], str):
                        # Convert string content to list format with image
                        messages[i]["content"] = [
                            {"type": "text", "text": messages[i]["content"]},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                        ]
                    elif isinstance(messages[i]["content"], list):
                        # Add image to existing list content
                        messages[i]["content"].append({
                            "type": "image_url", 
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                        })
                    break
    
    data = {
        "model": model,
        "messages": messages,
        "max_tokens": 10000,
        "temperature": 0.7,
        "system": "You are a helpful AI assistant. Use proper markdown formatting in your responses including headers (##, ###), bold (**text**), italic (*text*), code blocks (```), inline code (`code`), lists (- or 1.), and tables when appropriate. You can think through problems step by step and provide detailed, accurate responses. You can also analyze images and answer questions about them."
    }
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{API_BASE_URL}/chat/completions",
                json=data,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=300)  # Increased timeout for image processing
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("choices") and len(result["choices"]) > 0:
                        answer = result["choices"][0]["message"]["content"]
                        # Only remove <think> blocks, preserve all other markdown formatting
                        answer_clean = remove_think_block(answer)
                        return answer_clean
                    else:
                        logger.error(f"No response content from {model}")
                        return "Error: Unable to get a response. Please try again later."
                else:
                    error_text = await response.text()
                    logger.error(f"Error from API: {response.status} - {error_text}")
                    return f"Error: API error ({response.status}). Please try again later."
    except Exception as e:
        logger.error(f"Error asking AI: {e}")
        return f"Error: An error occurred with the bot: {str(e)}" 