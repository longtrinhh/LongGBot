import aiohttp
import logging
import base64
from io import BytesIO
from PIL import Image
from config import API_KEY, API_BASE_URL

logger = logging.getLogger(__name__)

class AIImageClient:
    def __init__(self):
        self.api_key = API_KEY
        self.base_url = API_BASE_URL

    async def encode_image_to_base64(self, image_data: bytes) -> str:
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

    async def generate_image(self, prompt: str, model: str = "imagen-4.0-ultra-generate-exp-05-20", return_url: bool = False):
        """Generate image using AI model. If return_url is True, return (image_bytes, url)."""
        data = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            "response_format": "url"
        }
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/images/generations",
                    json=data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=300)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        if result.get("data") and len(result["data"]) > 0:
                            image_url = result["data"][0]["url"]
                            # Download the generated image
                            async with session.get(image_url) as img_response:
                                if img_response.status == 200:
                                    image_bytes = await img_response.read()
                                    if return_url:
                                        return image_bytes, image_url
                                    return image_bytes
                                else:
                                    logger.error(f"Failed to download generated image: {img_response.status}")
                                    return (None, image_url) if return_url else None
                        else:
                            logger.error(f"No image data in response from {model}")
                            return (None, None) if return_url else None
                    else:
                        error_text = await response.text()
                        logger.error(f"Error generating image: {response.status} - {error_text}")
                        return (None, None) if return_url else None
        except Exception as e:
            logger.error(f"Error generating image: {e}")
            return (None, None) if return_url else None

    async def edit_image(self, image_data: bytes, prompt: str, model: str = "flux-1-kontext-max") -> bytes:
        """Edit image using AI model."""
        # Encode the original image
        base64_image = await self.encode_image_to_base64(image_data)
        if not base64_image:
            return None
        
        data = {
            "model": model,
            "image": f"data:image/jpeg;base64,{base64_image}",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024"
        }
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/images/edits",
                    json=data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=300)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        if result.get("data") and len(result["data"]) > 0:
                            image_url = result["data"][0]["url"]
                            # Download the edited image
                            async with session.get(image_url) as img_response:
                                if img_response.status == 200:
                                    return await img_response.read()
                                else:
                                    logger.error(f"Failed to download edited image: {img_response.status}")
                                    return None
                        else:
                            logger.error(f"No image data in response from {model}")
                            return None
                    else:
                        error_text = await response.text()
                        logger.error(f"Error editing image: {response.status} - {error_text}")
                        return None
        except Exception as e:
            logger.error(f"Error editing image: {e}")
            return None 