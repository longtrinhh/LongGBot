// API interaction logic

export function getPremiumCode() {
    return localStorage.getItem('premium_code') || '';
}

export function hasPremiumAccess() {
    return localStorage.getItem('premium_code_valid') === 'true';
}

export function fetchWithCode(url, options = {}) {
    const code = getPremiumCode();
    if (!options.headers) options.headers = {};
    options.headers['X-Access-Code'] = code;
    return fetch(url, options);
}

export function submitCode(code) {
    return fetch('/validate_code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    })
        .then(res => res.json().then(data => ({ status: res.status, data })));
}

export function clearContext() {
    return fetch('/clear_context', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    })
        .then(response => response.json());
}

export function clearUploadedDocument(conversationId) {
    return fetch('/clear_document', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: conversationId || null })
    })
        .then(response => response.json());
}

export function logout() {
    // Clear all cookies
    document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'premium_code_hash=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

    // Clear localStorage
    localStorage.removeItem('premium_code_valid');
    localStorage.removeItem('darkMode');

    // Reload the page to reset the session
    window.location.reload();
}

export function fetchConversations() {
    return fetch('/conversations').then(response => response.json());
}

export function deleteConversation(conversationId) {
    return fetch(`/conversations/${conversationId}`, {
        method: 'DELETE',
        credentials: 'include'
    }).then(response => response.json());
}

export function createConversation() {
    return fetch('/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({})
    }).then(response => response.json());
}

export function getConversationMessages(conversationId) {
    return fetch(`/conversations/${conversationId}`).then(response => response.json());
}

export function setModel(modelId, type) {
    return fetchWithCode('/set_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, model_type: type })
    }).then(response => response.json());
}

export function cancelStream() {
    return fetchWithCode('/cancel_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    });
}
