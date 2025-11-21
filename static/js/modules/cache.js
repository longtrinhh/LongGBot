const CACHE_PREFIX = 'conv_';
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50; // conversations

export function cacheConversation(conversationId, messages) {
    try {
        const cacheData = {
            messages: messages,
            timestamp: Date.now()
        };
        localStorage.setItem(CACHE_PREFIX + conversationId, JSON.stringify(cacheData));
        pruneCache();
    } catch (e) {
        console.warn('Cache write failed:', e);
    }
}

export function getCachedConversation(conversationId) {
    try {
        const cached = localStorage.getItem(CACHE_PREFIX + conversationId);
        if (!cached) return null;

        const data = JSON.parse(cached);
        const age = Date.now() - data.timestamp;

        if (age > CACHE_EXPIRY_MS) {
            localStorage.removeItem(CACHE_PREFIX + conversationId);
            return null;
        }

        return data.messages;
    } catch (e) {
        return null;
    }
}

export function updateConversationCache(conversationId, newMessages) {
    const cached = getCachedConversation(conversationId);
    if (cached) {
        // If newMessages is an array, append it. If it's a single message object, wrap it.
        const messagesToAdd = Array.isArray(newMessages) ? newMessages : [newMessages];
        cacheConversation(conversationId, [...cached, ...messagesToAdd]);
    }
}

export function clearConversationCache(conversationId) {
    localStorage.removeItem(CACHE_PREFIX + conversationId);
}

function pruneCache() {
    try {
        // Keep cache size under control
        const keys = Object.keys(localStorage)
            .filter(k => k.startsWith(CACHE_PREFIX))
            .map(k => ({
                key: k,
                data: JSON.parse(localStorage.getItem(k))
            }))
            .sort((a, b) => a.data.timestamp - b.data.timestamp);

        while (keys.length > MAX_CACHE_SIZE) {
            localStorage.removeItem(keys.shift().key);
        }
    } catch (e) {
        console.warn('Cache pruning failed:', e);
    }
}
