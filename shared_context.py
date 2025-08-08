import json
import os
import logging
from typing import List, Dict, Optional
from google.cloud import firestore
from datetime import datetime

logger = logging.getLogger(__name__)

CONTEXT_FILE = "user_contexts.json"
MODEL_FILE = "user_models.json"

user_contexts = {}
user_models = {}

firestore_client = firestore.Client()
FIRESTORE_COLLECTION = "user_conversations"

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
    docs = firestore_client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id).stream()
    return [doc.to_dict() for doc in docs]

def get_firestore_conversation(user_id, conversation_id):
    doc_ref = firestore_client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
    doc = doc_ref.get()
    if doc.exists:
        return doc.to_dict().get("messages", [])
    return []

def add_firestore_message(user_id, conversation_id, message):
    doc_ref = firestore_client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
    doc = doc_ref.get()
    if doc.exists:
        messages = doc.to_dict().get("messages", [])
    else:
        messages = []
    messages.append(message)
    doc_ref.set({
        "user_id": user_id,
        "conversation_id": conversation_id,
        "messages": messages
    })

def create_firestore_conversation(user_id, title=None):
    import uuid
    is_premium = isinstance(user_id, str) and len(user_id) == 64
    max_convs = 10 if is_premium else 2
    docs = list(firestore_client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id).stream())
    if len(docs) >= max_convs:
        def get_sort_key(doc):
            data = doc.to_dict()
            return data.get("created_at") or str(doc.update_time)
        docs_sorted = sorted(docs, key=get_sort_key)
        oldest_doc = docs_sorted[0]
        oldest_doc.reference.delete()
    conv_id = str(uuid.uuid4())
    doc_ref = firestore_client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conv_id}")
    doc_ref.set({
        "user_id": user_id,
        "conversation_id": conv_id,
        "messages": [],
        "title": title or "New Conversation",
        "created_at": datetime.utcnow().isoformat() + 'Z'
    })
    return conv_id

def delete_firestore_conversation(user_id, conversation_id):
    doc_ref = firestore_client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
    doc_ref.delete()

load_data() 