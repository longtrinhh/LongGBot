import json
import os
import logging
from typing import List, Dict, Optional
from google.cloud import firestore
from google.api_core import retry, exceptions
from datetime import datetime
import time
import grpc
import re
import secrets
import tiktoken

logger = logging.getLogger(__name__)

CONTEXT_FILE = "user_contexts.json"
MODEL_FILE = "user_models.json"

user_contexts = {}
user_models = {}
user_documents = {}

_firestore_client = None

try:
    firestore_client = firestore.Client()
    logger.info("✓ Firestore client created successfully")
except Exception as e:
    logger.error(f"✗ Failed to create Firestore client: {e}")
    firestore_client = None

def get_firestore_client():
    global firestore_client
    if firestore_client is None:
        try:
            firestore_client = firestore.Client()
            logger.info("✓ Firestore client recreated successfully")
        except Exception as e:
            logger.error(f"✗ Failed to recreate Firestore client: {e}")
    return firestore_client

FIRESTORE_COLLECTION = "user_conversations"

custom_retry = retry.Retry(
    initial=0.3,
    maximum=5.0,
    multiplier=1.5,
    deadline=15.0,
    timeout=15.0
)

def sanitize_input(text: str, max_length: int = 10000) -> str:
    """Sanitize user input to prevent injection attacks"""
    if not text or not isinstance(text, str):
        return ""
    text = text[:max_length]
    text = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]', '', text)
    return text.strip()

def validate_conversation_id(conversation_id: str) -> bool:
    """Validate conversation ID format to prevent injection"""
    if not conversation_id or not isinstance(conversation_id, str):
        return False
    if len(conversation_id) > 100:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', conversation_id))

def verify_conversation_ownership(user_id: str, conversation_id: str) -> bool:
    """Verify that the user owns the conversation"""
    client = get_firestore_client()
    if not client:
        return False
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=3.0)
        if not doc.exists:
            return False
        data = doc.to_dict()
        return data.get('user_id') == user_id
    except Exception as e:
        logger.error(f"Error verifying conversation ownership: {e}")
        return False


def load_data():
    global user_contexts, user_models
    
    if os.path.exists(CONTEXT_FILE):
        try:
            with open(CONTEXT_FILE, 'r', encoding='utf-8') as f:
                user_contexts = json.load(f)
        except Exception as e:
            logger.error(f"Error loading user contexts: {e}")
            user_contexts = {}
    
    if os.path.exists(MODEL_FILE):
        try:
            with open(MODEL_FILE, 'r', encoding='utf-8') as f:
                user_models = json.load(f)
            migrated = False
            for user_id, value in list(user_models.items()):
                if isinstance(value, str):
                    user_models[user_id] = {'chat': value}
                    migrated = True
            if migrated:
                save_data()
        except Exception as e:
            logger.error(f"Error loading user models: {e}")
            user_models = {}

def save_data():
    try:
        with open(CONTEXT_FILE, 'w', encoding='utf-8') as f:
            json.dump(user_contexts, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving user contexts: {e}")
    
    try:
        with open(MODEL_FILE, 'w', encoding='utf-8') as f:
            json.dump(user_models, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Error saving user models: {e}")

def get_user_context(user_key: str) -> List[Dict]:
    return user_contexts.get(str(user_key), [])

def add_question_to_context(user_key: str, question: str, answer: str, has_image: bool = False):
    user_key_str = str(user_key)
    if user_key_str not in user_contexts:
        user_contexts[user_key_str] = []
    user_contexts[user_key_str].append({
        "role": "user",
        "content": question
    })
    answer_clean = remove_think_block(answer)
    user_contexts[user_key_str].append({
        "role": "assistant",
        "content": answer_clean
    })
    if len(user_contexts[user_key_str]) > 20:
        user_contexts[user_key_str] = user_contexts[user_key_str][-20:]
    save_data()

def clear_user_context(user_key: str):
    user_key_str = str(user_key)
    if user_key_str in user_contexts:
        del user_contexts[user_key_str]
        save_data()

def get_user_model(user_key: str, model_type: str = 'chat') -> Optional[str]:
    user_entry = user_models.get(str(user_key), {})
    return user_entry.get(model_type)

def set_user_model(user_key: str, model_type: str, model: str):
    user_key_str = str(user_key)
    if user_key_str not in user_models or not isinstance(user_models[user_key_str], dict):
        user_models[user_key_str] = {}
    user_models[user_key_str][model_type] = model
    save_data()

def remove_think_block(text):
    import re
    return re.sub(r'<think>[\s\S]*?</think>', '', text, flags=re.IGNORECASE)

def get_full_conversation(user_key: str) -> List[Dict]:
    return user_contexts.get(str(user_key), [])

def get_firestore_conversations_for_user(user_id):
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return []
    
    try:
        logger.info(f"Fetching conversations from Firestore for user {user_id}")
        query = client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id)
        docs = query.stream(timeout=5.0)
        conversations = [doc.to_dict() for doc in docs]
        logger.info(f"Successfully fetched {len(conversations)} conversations for user {user_id}")
        return conversations
    except Exception as e:
        logger.error(f"Error fetching Firestore conversations: {e}")
        return []

def get_firestore_conversation(user_id, conversation_id):
    if not validate_conversation_id(conversation_id):
        logger.warning(f"Invalid conversation_id format: {conversation_id}")
        return []
    
    if not verify_conversation_ownership(user_id, conversation_id):
        logger.warning(f"User {user_id} attempted to access conversation {conversation_id} without ownership")
        return []
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return []
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=5.0)
        if doc.exists:
            return doc.to_dict().get("messages", [])
        return []
    except Exception as e:
        logger.error(f"Error getting conversation {conversation_id}: {e}")
        return []

def add_firestore_message(user_id, conversation_id, message):
    if not validate_conversation_id(conversation_id):
        logger.warning(f"Invalid conversation_id format: {conversation_id}")
        return False
    
    if not verify_conversation_ownership(user_id, conversation_id):
        logger.warning(f"User {user_id} attempted to modify conversation {conversation_id} without ownership")
        return False
    
    content = message.get('content', '')
    if isinstance(content, str):
        message['content'] = sanitize_input(content)
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return False
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=5.0)
        
        if doc.exists:
            messages = doc.to_dict().get("messages", [])
            existing_title = doc.to_dict().get("title", "New Conversation")
        else:
            messages = []
            existing_title = "New Conversation"
        
        if len(messages) >= 1000:
            logger.warning(f"Conversation {conversation_id} has too many messages")
            return False
        
        # Optimization 2: Pre-calculate token count
        message['token_count'] = estimate_tokens(message.get('content', ''))
        
        messages.append(message)
        
        doc_ref.set({
            "user_id": user_id,
            "conversation_id": conversation_id,
            "messages": messages,
            "title": existing_title,
            "last_updated": datetime.utcnow().isoformat() + 'Z'
        }, timeout=5.0)
        logger.debug(f"Message added to conversation {conversation_id}")
        return True
    except Exception as e:
        logger.error(f"Error adding message to conversation {conversation_id}: {e}")
        return False

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

def add_firestore_messages_batch(user_id, conversation_id, messages_list):
    """Add multiple messages in a single batch write (append to array)"""
    if not validate_conversation_id(conversation_id):
        logger.warning(f"Invalid conversation_id format: {conversation_id}")
        return False
    
    if not verify_conversation_ownership(user_id, conversation_id):
        logger.warning(f"User {user_id} attempted to modify conversation {conversation_id} without ownership")
        return False
        
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return False
        
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=5.0)
        
        if doc.exists:
            current_messages = doc.to_dict().get("messages", [])
            existing_title = doc.to_dict().get("title", "New Conversation")
        else:
            current_messages = []
            existing_title = "New Conversation"
            
        if len(current_messages) + len(messages_list) >= 1000:
            logger.warning(f"Conversation {conversation_id} has too many messages")
            return False
            
        for msg in messages_list:
            content = msg.get('content', '')
            if isinstance(content, str):
                msg['content'] = sanitize_input(content)
            
            # Optimization 2: Pre-calculate token count
            msg['token_count'] = estimate_tokens(msg.get('content', ''))
            
            current_messages.append(msg)
            
        doc_ref.set({
            "user_id": user_id,
            "conversation_id": conversation_id,
            "messages": current_messages,
            "title": existing_title,
            "last_updated": datetime.utcnow().isoformat() + 'Z'
        }, timeout=5.0)
        return True
    except Exception as e:
        logger.error(f"Error in batch write: {e}")
        return False

def create_firestore_conversation(user_id, title=None):
    if title:
        title = sanitize_input(title, max_length=100)
    
    conv_id = secrets.token_urlsafe(32)
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return conv_id
    
    try:
        is_premium = isinstance(user_id, str) and len(user_id) == 64
        max_convs = 10 if is_premium else 2
        
        try:
            docs = []
            for doc in client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id).stream(timeout=5.0):
                docs.append(doc)
        except Exception as stream_error:
            logger.error(f"Error streaming documents for conversation limit check: {stream_error}")
            docs = []
        
        if len(docs) >= max_convs:
            try:
                def get_sort_key(doc):
                    data = doc.to_dict()
                    return data.get("created_at") or str(doc.update_time)
                docs_sorted = sorted(docs, key=get_sort_key)
                oldest_doc = docs_sorted[0]
                oldest_doc.reference.delete(timeout=10.0)
                logger.info(f"Deleted oldest conversation for user {user_id}")
            except Exception as delete_error:
                logger.error(f"Error deleting oldest conversation: {delete_error}")
        
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conv_id}")
        doc_ref.set({
            "user_id": user_id,
            "conversation_id": conv_id,
            "messages": [],
            "title": title or "New Conversation",
            "created_at": datetime.utcnow().isoformat() + 'Z'
        }, timeout=10.0)
        logger.info(f"Created new conversation {conv_id} for user {user_id}")
        return conv_id
        
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        return conv_id

def delete_firestore_conversation(user_id, conversation_id):
    if not validate_conversation_id(conversation_id):
        logger.warning(f"Invalid conversation_id format: {conversation_id}")
        return False
    
    if not verify_conversation_ownership(user_id, conversation_id):
        logger.warning(f"User {user_id} attempted to delete conversation {conversation_id} without ownership")
        return False
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return False
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc_ref.delete(timeout=5.0)
        logger.info(f"Deleted conversation {conversation_id} for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Error deleting conversation {conversation_id}: {e}")
        return False

def set_conversation_title_if_default(user_id, conversation_id, new_title):
    if not validate_conversation_id(conversation_id):
        return
    
    if not verify_conversation_ownership(user_id, conversation_id):
        logger.warning(f"User {user_id} attempted to update title for conversation {conversation_id} without ownership")
        return
    
    new_title = sanitize_input(new_title, max_length=100)
    client = get_firestore_client()
    if not client:
        logger.debug("Firestore client not available, skipping title update")
        return
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=10.0)
        if not doc.exists:
            return
        data = doc.to_dict() or {}
        current = data.get("title")
        
        if not current or current.strip().lower() == "new conversation":
            safe = (new_title or "").strip()
            if not safe:
                return
            if len(safe) > 80:
                safe = safe[:80] + "…"
            doc_ref.update({"title": safe}, timeout=5.0)
            logger.debug(f"Updated title for conversation {conversation_id}")
    except Exception as e:
        logger.error(f"Error setting conversation title: {e}")

def generate_title_from_text(text: str) -> str:
    if not text:
        return "New Conversation"
    s = str(text)
    s = s.replace('`', ' ').replace('\r', ' ').strip()
    first_line = s.split('\n', 1)[0]
    
    import re
    sentence = re.split(r"(?<=[.!?])\s", first_line)[0] if first_line else s
    candidate = sentence.strip() or s.strip()
    candidate = re.sub(r"\s+", " ", candidate)
    
    max_len = 60
    if len(candidate) > max_len:
        candidate = candidate[:max_len].rstrip() + "…"
    return candidate or "New Conversation"

def set_user_document(user_key: str, content: str, filename: str, file_type: str):
    user_key_str = str(user_key)
    user_documents[user_key_str] = {
        'content': content,
        'filename': filename,
        'file_type': file_type,
        'injected_conversation_id': None
    }

def get_user_document(user_key: str) -> Optional[Dict]:
    user_key_str = str(user_key)
    return user_documents.get(user_key_str)

def clear_user_document(user_key: str):
    user_key_str = str(user_key)
    if user_key_str in user_documents:
        del user_documents[user_key_str]

def has_user_document(user_key: str) -> bool:
    user_key_str = str(user_key)
    return user_key_str in user_documents

load_data()