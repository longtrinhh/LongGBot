import aiohttp
import asyncio
import logging
import base64
import re
import json
import threading
import queue
from io import BytesIO
from PIL import Image
from config import API_KEY, API_BASE_URL, MODEL_NAME

logger = logging.getLogger(__name__)

# Background Loop Management
_loop = None
_thread = None
_session = None
_init_lock = threading.Lock()

def start_background_loop(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()

def get_background_loop():
    global _loop, _thread
    with _init_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            _thread = threading.Thread(target=start_background_loop, args=(_loop,), daemon=True)
            _thread.start()
    return _loop

async def get_session():
    global _session
    if _session is None or _session.closed:
        _session = aiohttp.ClientSession()
    return _session

async def close_session():
    global _session
    if _session and not _session.closed:
        await _session.close()

def run_async_global(coro):
    """Run a coroutine on the background loop and return the result synchronously."""
    loop = get_background_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result()

def run_stream_global(async_gen):
    """Consume an async generator on the background loop and yield items synchronously."""
    q = queue.Queue()
    loop = get_background_loop()
    
    async def producer():
        try:
            async for item in async_gen:
                q.put(item)
            q.put(None) # Sentinel for done
        except Exception as e:
            logger.error(f"Error in stream producer: {e}")
            q.put(e) # Sentinel for error

    asyncio.run_coroutine_threadsafe(producer(), loop)
    
    while True:
        item = q.get()
        if item is None:
            break
        if isinstance(item, Exception):
            # Re-raise exception from the async generator
            raise item
        yield item

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

def prepare_messages(question, model, context, image_data):
    messages = context[:] if context else []
    messages.append({"role": "user", "content": question})

    if image_data:
        pass
    
    return messages

async def _ask_ai_stream_internal(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None):
    api_key = API_KEY
    if not api_key:
        yield json.dumps({"type": "error", "text": "Error: API key not found."})
        return

    # Handle image encoding here
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
        "stream": True,
        "system": "You are a helpful AI assistant. Use proper markdown formatting in your responses including headers (##, ###), bold (**text**), italic (*text*), code blocks (```), inline code (`code`), lists (- or 1.), and tables when appropriate. You can think through problems step by step and provide detailed, accurate responses. You can also analyze images and answer questions about them."
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    if model in ["o1-preview-2024-09-12", "o1-mini-2024-09-12"]:
        data["max_completion_tokens"] = 10000

    try:
        session = await get_session()
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
                                            before_think = re.split(r'<think>', current_buffer, flags=re.IGNORECASE)[0]
                                            if before_think:
                                                yield json.dumps({'type': 'content', 'text': before_think})
                                            current_buffer = re.sub(r'^.*?<think>', '', current_buffer, flags=re.IGNORECASE | re.DOTALL)
                                            think_buffer = ""
                                        
                                        if in_think_block:
                                            if '</think>' in current_buffer.lower():
                                                parts = re.split(r'</think>', current_buffer, maxsplit=1, flags=re.IGNORECASE)
                                                think_content = parts[0]
                                                think_buffer += think_content
                                                
                                                if think_buffer.strip():
                                                    yield json.dumps({'type': 'thinking', 'text': think_buffer.strip()})
                                                
                                                in_think_block = False
                                                think_buffer = ""
                                                current_buffer = parts[1] if len(parts) > 1 else ""
                                                
                                                if current_buffer:
                                                    yield json.dumps({'type': 'content', 'text': current_buffer})
                                                    current_buffer = ""
                                            else:
                                                think_buffer += current_buffer
                                                yield json.dumps({'type': 'thinking', 'text': current_buffer})
                                                current_buffer = ""
                                        else:
                                            if current_buffer:
                                                yield json.dumps({'type': 'content', 'text': current_buffer})
                                                current_buffer = ""
                        except json.JSONDecodeError:
                            continue
                
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

def ask_ai_stream(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None):
    return run_stream_global(_ask_ai_stream_internal(question, model, context, image_data))

async def _ask_ai_internal(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None) -> str:
    api_key = API_KEY
    if not api_key:
        return "Error: API key not found."

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
        "stream": False,
        "system": "You are a helpful AI assistant. Use proper markdown formatting in your responses including headers (##, ###), bold (**text**), italic (*text*), code blocks (```), inline code (`code`), lists (- or 1.), and tables when appropriate. You can think through problems step by step and provide detailed, accurate responses. You can also analyze images and answer questions about them."
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    if model in ["o1-preview-2024-09-12", "o1-mini-2024-09-12"]:
        data["max_completion_tokens"] = 10000
    
    try:
        session = await get_session()
        async with session.post(
            f"{API_BASE_URL}/chat/completions",
            json=data,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=120)
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

def ask_ai(question: str, model: str = MODEL_NAME, context=None, image_data: bytes = None) -> str:
    return run_async_global(_ask_ai_internal(question, model, context, image_data))