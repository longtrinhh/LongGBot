import aiohttp
import logging
import base64
import re
import json
from io import BytesIO
from PIL import Image
from config import API_KEY, API_BASE_URL, MODEL_NAME

logger = logging.getLogger(__name__)

async def encode_image_to_base64(image_data: bytes) -> str:
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

def remove_think_block(text):
    return re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)

def extract_think_blocks(text):
    """Extract all thinking blocks from text"""
    matches = re.findall(r'<think>([\s\S]*?)</think>', text, flags=re.IGNORECASE)
    return matches

def is_inside_think_block(text):
    """Check if we're currently inside a thinking block"""
    open_tags = len(re.findall(r'<think>', text, flags=re.IGNORECASE))
    close_tags = len(re.findall(r'</think>', text, flags=re.IGNORECASE))
    return open_tags > close_tags

async def ask_ai_stream(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None):
    messages = context[:] if context else []
    messages.append({"role": "user", "content": question})

    if image_data:
        base64_image = await encode_image_to_base64(image_data)
        if base64_image:
            for i in range(len(messages) - 1, -1, -1):
                if messages[i]["role"] == "user":
                    if isinstance(messages[i]["content"], str):
                        messages[i]["content"] = [
                            {"type": "text", "text": messages[i]["content"]},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                        ]
                    elif isinstance(messages[i]["content"], list):
                        messages[i]["content"].append({
                            "type": "image_url", 
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                        })
                    break
    
    # Disable web search if an image is provided or a document is present in context
    web_search_flag = True
    if image_data:
        web_search_flag = False
    else:
        try:
            # Detect injected document system message
            if any(
                m.get('role') == 'system' and isinstance(m.get('content'), str) and '--- DOCUMENT CONTENT START ---' in m.get('content', '')
                for m in messages
            ):
                web_search_flag = False
        except Exception:
            pass

    data = {
        "model": model,
        "messages": messages,
        "max_tokens": 10000,
        "temperature": 0.7,
        "web_search": web_search_flag,
        "stream": True,
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
                timeout=aiohttp.ClientTimeout(total=300)
            ) as response:
                if response.status == 200:
                    full_response = ""
                    current_buffer = ""
                    in_think_block = False
                    think_buffer = ""
                    
                    async for line in response.content:
                        line = line.decode('utf-8').strip()
                        if line.startswith('data: '):
                            data_str = line[6:]
                            if data_str == '[DONE]':
                                break
                            try:
                                data_json = json.loads(data_str)
                                if 'choices' in data_json and len(data_json['choices']) > 0:
                                    choice = data_json['choices'][0]
                                    if 'delta' in choice and 'content' in choice['delta']:
                                        content = choice['delta']['content']
                                        if content:
                                            full_response += content
                                            current_buffer += content
                                            
                                            # Check for think block markers
                                            if '<think>' in current_buffer.lower():
                                                in_think_block = True
                                                # Send any content before <think>
                                                before_think = re.split(r'<think>', current_buffer, flags=re.IGNORECASE)[0]
                                                if before_think:
                                                    yield json.dumps({'type': 'content', 'text': before_think})
                                                current_buffer = re.sub(r'^.*?<think>', '', current_buffer, flags=re.IGNORECASE | re.DOTALL)
                                                think_buffer = ""
                                            
                                            if in_think_block:
                                                if '</think>' in current_buffer.lower():
                                                    # Extract thinking content
                                                    parts = re.split(r'</think>', current_buffer, maxsplit=1, flags=re.IGNORECASE)
                                                    think_content = parts[0]
                                                    think_buffer += think_content
                                                    
                                                    # Send complete thinking block
                                                    if think_buffer.strip():
                                                        yield json.dumps({'type': 'thinking', 'text': think_buffer.strip()})
                                                    
                                                    in_think_block = False
                                                    think_buffer = ""
                                                    current_buffer = parts[1] if len(parts) > 1 else ""
                                                    
                                                    # Continue with remaining content
                                                    if current_buffer:
                                                        yield json.dumps({'type': 'content', 'text': current_buffer})
                                                        current_buffer = ""
                                                else:
                                                    # Still inside think block
                                                    think_buffer += current_buffer
                                                    yield json.dumps({'type': 'thinking', 'text': current_buffer})
                                                    current_buffer = ""
                                            else:
                                                # Normal content
                                                if current_buffer:
                                                    yield json.dumps({'type': 'content', 'text': current_buffer})
                                                    current_buffer = ""
                            except json.JSONDecodeError:
                                continue
                    
                    # Flush any remaining content
                    if current_buffer:
                        if in_think_block:
                            yield json.dumps({'type': 'thinking', 'text': current_buffer})
                        else:
                            yield json.dumps({'type': 'content', 'text': current_buffer})
                else:
                    error_text = await response.text()
                    logger.error(f"Error from API: {response.status} - {error_text}")
                    yield f"Error: API error ({response.status}). Please try again later."
    except Exception as e:
        logger.error(f"Error asking AI: {e}")
        yield f"Error: An error occurred with the bot: {str(e)}"

async def ask_ai(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None) -> str:
    messages = context[:] if context else []
    messages.append({"role": "user", "content": question})

    if image_data:
        base64_image = await encode_image_to_base64(image_data)
        if base64_image:
            for i in range(len(messages) - 1, -1, -1):
                if messages[i]["role"] == "user":
                    if isinstance(messages[i]["content"], str):
                        messages[i]["content"] = [
                            {"type": "text", "text": messages[i]["content"]},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                        ]
                    elif isinstance(messages[i]["content"], list):
                        messages[i]["content"].append({
                            "type": "image_url", 
                            "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
                        })
                    break
    
    # Disable web search if an image is provided or a document is present in context
    web_search_flag = True
    if image_data:
        web_search_flag = False
    else:
        try:
            if any(
                m.get('role') == 'system' and isinstance(m.get('content'), str) and '--- DOCUMENT CONTENT START ---' in m.get('content', '')
                for m in messages
            ):
                web_search_flag = False
        except Exception:
            pass

    data = {
        "model": model,
        "messages": messages,
        "max_tokens": 10000,
        "temperature": 0.7,
        "web_search": web_search_flag,
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
                timeout=aiohttp.ClientTimeout(total=300)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    if result.get("choices") and len(result["choices"]) > 0:
                        answer = result["choices"][0]["message"]["content"]
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