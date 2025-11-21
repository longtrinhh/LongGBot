import aiohttp
import logging
import base64
from io import BytesIO
from PIL import Image
from config import API_KEY, API_BASE_URL
from ai_client import get_session

logger = logging.getLogger(__name__)

class AIImageClient:
    def __init__(self):
        self.api_key = API_KEY
        self.base_url = API_BASE_URL

    async def encode_image_to_base64(self, image_data: bytes) -> str:
        try:
            image = Image.open(BytesIO(image_data))
            
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            max_size = 1024
            if image.width > max_size or image.height > max_size:
                image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            buffer = BytesIO()
            image.save(buffer, format='JPEG', quality=85)
            image_bytes = buffer.getvalue()
            
            return base64.b64encode(image_bytes).decode('utf-8')
        except Exception as e:
            logger.error(f"Error encoding image: {e}")
            return None

    async def generate_image(self, prompt: str, model: str = "imagen-4.0-ultra-generate-exp-05-20", return_url: bool = False):
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
            session = await get_session()
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
            session = await get_session()
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