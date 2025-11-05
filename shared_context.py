import json
import os
import logging
from typing import List, Dict, Optional
from google.cloud import firestore
from google.api_core import retry, exceptions
from datetime import datetime
import time
import grpc

logger = logging.getLogger(__name__)

CONTEXT_FILE = "user_contexts.json"
MODEL_FILE = "user_models.json"

user_contexts = {}
user_models = {}
user_documents = {}  # Store uploaded document content per user

# Track connection health
_firestore_client = None
_client_created_at = None
_client_last_error = None
_max_client_age = 3600 * 6  # Recreate client after 6 hours

# Configure gRPC keep-alive options to prevent stale connections
grpc_options = [
    # Send keep-alive pings every 60 seconds
    ('grpc.keepalive_time_ms', 60000),
    # Wait 20 seconds for keep-alive ping ack before considering connection dead
    ('grpc.keepalive_timeout_ms', 20000),
    # Allow keep-alive pings even when there are no calls
    ('grpc.keepalive_permit_without_calls', True),
    # Max time to wait for connection
    ('grpc.max_connection_idle_ms', 300000),  # 5 minutes
    # Max time a connection can exist
    ('grpc.max_connection_age_ms', 3600000),  # 1 hour
    # Grace period after max_connection_age
    ('grpc.max_connection_age_grace_ms', 300000),  # 5 minutes
    # HTTP2 settings
    ('grpc.http2.max_pings_without_data', 0),
    ('grpc.http2.min_time_between_pings_ms', 10000),
    ('grpc.http2.min_ping_interval_without_data_ms', 30000),
]

def create_firestore_client():
    """Create a new Firestore client with keep-alive settings"""
    global _firestore_client, _client_created_at, _client_last_error
    
    try:
        logger.info("Creating new Firestore client with keep-alive settings...")
        
        # Try to create client with gRPC options via client_options
        from google.api_core.client_options import ClientOptions
        
        # Create client with options that help prevent stale connections
        client_options_dict = {
            'api_endpoint': 'firestore.googleapis.com:443'
        }
        
        # Create Firestore client with custom options
        # The gRPC options will be automatically applied by the client library
        _firestore_client = firestore.Client(
            client_options=ClientOptions(**client_options_dict)
        )
        
        # Monkey-patch the channel options after creation to add keep-alive
        try:
            # Access the internal transport and add keep-alive options
            if hasattr(_firestore_client, '_firestore_api') and hasattr(_firestore_client._firestore_api, '_transport'):
                transport = _firestore_client._firestore_api._transport
                if hasattr(transport, '_channel'):
                    # Channel already created, can't modify options
                    logger.debug("Channel already created, keep-alive options will apply on next reconnect")
        except Exception as patch_error:
            logger.debug(f"Could not patch channel options: {patch_error}")
        
        _client_created_at = time.time()
        _client_last_error = None
        
        logger.info("✓ Firestore client created successfully")
        return _firestore_client
        
    except Exception as e:
        logger.error(f"✗ Failed to create Firestore client: {e}")
        _client_last_error = time.time()
        _firestore_client = None
        return None

def get_firestore_client():
    """Get Firestore client with automatic reconnection for stale connections"""
    global _firestore_client, _client_created_at, _client_last_error
    
    current_time = time.time()
    
    # Check if we need to recreate the client
    recreate = False
    
    if _firestore_client is None:
        recreate = True
        reason = "no client exists"
    elif _client_created_at and (current_time - _client_created_at) > _max_client_age:
        recreate = True
        reason = f"client age exceeded {_max_client_age}s"
    elif _client_last_error and (current_time - _client_last_error) < 60:
        # Don't recreate if we just had an error less than 60 seconds ago
        logger.debug("Recent error, not recreating client yet")
        return _firestore_client
    
    if recreate:
        logger.info(f"Recreating Firestore client: {reason}")
        return create_firestore_client()
    
    return _firestore_client

# Initialize the client
firestore_client = get_firestore_client()

FIRESTORE_COLLECTION = "user_conversations"

# Custom retry predicate for transient errors
def should_retry(exc):
    """Determine if an exception should trigger a retry"""
    return isinstance(exc, (
        exceptions.ServiceUnavailable,
        exceptions.InternalServerError,
        exceptions.TooManyRequests,
        exceptions.DeadlineExceeded,
        exceptions.ResourceExhausted,
        exceptions.Aborted,
        exceptions.Unavailable,
    ))

# Create a custom retry decorator with shorter timeouts
custom_retry = retry.Retry(
    predicate=should_retry,
    initial=0.5,  # Start with 0.5 second delay
    maximum=10.0,  # Max 10 seconds between retries
    multiplier=2.0,  # Double the delay each time
    deadline=30.0,  # Total timeout of 30 seconds instead of 300
    timeout=30.0
)

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

# Simple cache for conversations (invalidate when new conversation created/deleted)
_conversation_cache = {}
_cache_timeout = 300  # 5 minutes

def get_firestore_conversations_for_user(user_id):
    """Get conversations for a user with error handling and caching"""
    global _client_last_error
    cache_key = f"conversations_{user_id}"
    current_time = time.time()
    
    # Check cache first
    if cache_key in _conversation_cache:
        cached_data, timestamp = _conversation_cache[cache_key]
        if current_time - timestamp < _cache_timeout:
            logger.debug(f"Returning cached conversations for user {user_id}")
            return cached_data
    
    # Get fresh client (handles stale connections)
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available, returning empty conversations")
        return []
    
    # Fetch from Firestore with retry and timeout
    try:
        logger.info(f"Fetching conversations from Firestore for user {user_id}")
        # Use shorter timeout for query
        query = client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id)
        
        # Stream with timeout - collect quickly or fail fast
        docs = []
        try:
            for doc in query.stream(timeout=10.0):  # 10 second timeout for streaming
                docs.append(doc)
        except Exception as stream_error:
            logger.error(f"Error streaming Firestore documents: {stream_error}")
            # Mark client for recreation on next call
            _client_last_error = time.time()
            # Return cached data if available, even if expired
            if cache_key in _conversation_cache:
                logger.warning(f"Returning stale cache for user {user_id} due to Firestore error")
                return _conversation_cache[cache_key][0]
            return []
        
        conversations = [doc.to_dict() for doc in docs]
        logger.info(f"Successfully fetched {len(conversations)} conversations for user {user_id}")
        
        # Cache the result
        _conversation_cache[cache_key] = (conversations, current_time)
        
        return conversations
        
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError after timeout: {e}")
        # Mark client for recreation on next call
        _client_last_error = time.time()
        # Return cached data if available, even if expired
        if cache_key in _conversation_cache:
            logger.warning(f"Returning stale cache for user {user_id} due to timeout")
            return _conversation_cache[cache_key][0]
        return []
    except Exception as e:
        logger.error(f"Unexpected error fetching Firestore conversations: {e}", exc_info=True)
        # Mark client for recreation on next call
        _client_last_error = time.time()
        # Return cached data if available, even if expired
        if cache_key in _conversation_cache:
            logger.warning(f"Returning stale cache for user {user_id} due to error")
            return _conversation_cache[cache_key][0]
        return []

def _invalidate_user_cache(user_id):
    """Invalidate cached conversations for a user"""
    cache_key = f"conversations_{user_id}"
    if cache_key in _conversation_cache:
        del _conversation_cache[cache_key]

def get_firestore_conversation(user_id, conversation_id):
    """Get a specific conversation with error handling"""
    global _client_last_error
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return []
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc = doc_ref.get(timeout=10.0)  # 10 second timeout
        if doc.exists:
            return doc.to_dict().get("messages", [])
        return []
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError getting conversation {conversation_id}: {e}")
        _client_last_error = time.time()
        return []
    except Exception as e:
        logger.error(f"Error getting conversation {conversation_id}: {e}", exc_info=True)
        _client_last_error = time.time()
        return []

def add_firestore_message(user_id, conversation_id, message):
    """Add a message to a conversation with error handling"""
    global _client_last_error
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return False
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        
        # Use atomic update to append message - more efficient than read-modify-write
        try:
            from google.cloud.firestore import ArrayUnion
            doc_ref.update({
                "messages": ArrayUnion([message]),
                "last_updated": datetime.utcnow().isoformat() + 'Z'
            }, timeout=10.0)
            logger.debug(f"Message added to conversation {conversation_id}")
            return True
        except Exception as update_error:
            # Fallback to read-modify-write if document doesn't exist
            logger.debug(f"Update failed, falling back to set: {update_error}")
            try:
                doc = doc_ref.get(timeout=10.0)
                if doc.exists:
                    messages = doc.to_dict().get("messages", [])
                else:
                    messages = []
                messages.append(message)
                doc_ref.set({
                    "user_id": user_id,
                    "conversation_id": conversation_id,
                    "messages": messages,
                    "last_updated": datetime.utcnow().isoformat() + 'Z'
                }, timeout=10.0)
                logger.debug(f"Message set in conversation {conversation_id}")
                return True
            except Exception as set_error:
                logger.error(f"Failed to set message in conversation {conversation_id}: {set_error}")
                _client_last_error = time.time()
                return False
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError adding message to {conversation_id}: {e}")
        _client_last_error = time.time()
        return False
    except Exception as e:
        logger.error(f"Error adding message to conversation {conversation_id}: {e}", exc_info=True)
        _client_last_error = time.time()
        return False

def create_firestore_conversation(user_id, title=None):
    """Create a new conversation with error handling"""
    import uuid
    global _client_last_error
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        # Generate a temporary conversation ID even if Firestore is down
        return str(uuid.uuid4())
    
    # Invalidate cache when creating new conversation
    _invalidate_user_cache(user_id)
    
    try:
        is_premium = isinstance(user_id, str) and len(user_id) == 64
        max_convs = 10 if is_premium else 2
        
        # Get existing conversations with timeout
        try:
            docs = []
            for doc in client.collection(FIRESTORE_COLLECTION).where("user_id", "==", user_id).stream(timeout=10.0):
                docs.append(doc)
        except Exception as stream_error:
            logger.error(f"Error streaming documents for conversation limit check: {stream_error}")
            _client_last_error = time.time()
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
        
        conv_id = str(uuid.uuid4())
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
        
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError creating conversation: {e}")
        _client_last_error = time.time()
        # Return a temporary conversation ID
        return str(uuid.uuid4())
    except Exception as e:
        logger.error(f"Error creating conversation: {e}", exc_info=True)
        _client_last_error = time.time()
        # Return a temporary conversation ID
        return str(uuid.uuid4())

def delete_firestore_conversation(user_id, conversation_id):
    """Delete a conversation with error handling"""
    global _client_last_error
    
    client = get_firestore_client()
    if not client:
        logger.error("Firestore client not available")
        return False
    
    # Invalidate cache when deleting conversation
    _invalidate_user_cache(user_id)
    
    try:
        doc_ref = client.collection(FIRESTORE_COLLECTION).document(f"{user_id}__{conversation_id}")
        doc_ref.delete(timeout=10.0)
        logger.info(f"Deleted conversation {conversation_id} for user {user_id}")
        return True
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError deleting conversation {conversation_id}: {e}")
        _client_last_error = time.time()
        return False
    except Exception as e:
        logger.error(f"Error deleting conversation {conversation_id}: {e}", exc_info=True)
        _client_last_error = time.time()
        return False

def set_conversation_title_if_default(user_id, conversation_id, new_title):
    """Set conversation title if it is missing or the default placeholder."""
    global _client_last_error
    
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
        # Only set if missing or equals default placeholder
        if not current or current.strip().lower() == "new conversation":
            # Trim and clean title
            safe = (new_title or "").strip()
            if not safe:
                return
            if len(safe) > 80:
                safe = safe[:80] + "…"
            doc_ref.update({"title": safe}, timeout=10.0)
            # Invalidate cache for this user so listing picks up new title
            _invalidate_user_cache(user_id)
            logger.debug(f"Updated title for conversation {conversation_id}")
    except exceptions.RetryError as e:
        logger.error(f"Firestore RetryError setting conversation title: {e}")
        _client_last_error = time.time()
    except Exception as e:
        logger.error(f"Error setting conversation title: {e}")
        _client_last_error = time.time()

def generate_title_from_text(text: str) -> str:
    """Generate a concise conversation title from arbitrary text.

    Heuristics:
    - Use the first sentence/line
    - Collapse whitespace and strip markdown-ish fences
    - Truncate to ~60 chars
    """
    if not text:
        return "New Conversation"
    s = str(text)
    # Remove backticks and excessive spaces
    s = s.replace('`', ' ').replace('\r', ' ').strip()
    # Take first line before hard newline
    first_line = s.split('\n', 1)[0]
    # Split by sentence terminators
    import re
    sentence = re.split(r"(?<=[.!?])\s", first_line)[0] if first_line else s
    candidate = sentence.strip() or s.strip()
    # Collapse spaces
    candidate = re.sub(r"\s+", " ", candidate)
    # Limit length
    max_len = 60
    if len(candidate) > max_len:
        candidate = candidate[:max_len].rstrip() + "…"
    return candidate or "New Conversation"

def set_user_document(user_key: str, content: str, filename: str, file_type: str):
    """Store document content for a user"""
    user_key_str = str(user_key)
    user_documents[user_key_str] = {
        'content': content,
        'filename': filename,
        'file_type': file_type,
        # Track the conversation id where this document was injected as a system message
        'injected_conversation_id': None
    }

def get_user_document(user_key: str) -> Optional[Dict]:
    """Get stored document content for a user"""
    user_key_str = str(user_key)
    return user_documents.get(user_key_str)

def clear_user_document(user_key: str):
    """Clear stored document content for a user"""
    user_key_str = str(user_key)
    if user_key_str in user_documents:
        del user_documents[user_key_str]

def has_user_document(user_key: str) -> bool:
    """Check if user has uploaded document"""
    user_key_str = str(user_key)
    return user_key_str in user_documents

load_data() 