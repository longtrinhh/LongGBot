// Main application entry point
import {
    getCachedElement,
    showModelSelector,
    hideModelSelector,
    updateModelSelectors,
    updatePremiumIndicator,
    showCodeModal,
    hideCodeModal,
    showAlert,
    hideAlert,
    showConfirmModal,
    hideConfirmModal,
    initConfirmModal,
    showBotInfoModal,
    hideBotInfoModal,
    toggleSidebar,
    toggleDarkMode,
    setDarkMode,
    addMicroInteractions,
    showConversationListModal,
    hideConversationListModal,
    showImageUpload,
    hideImageUpload,
    showImageGenerator,
    hideImageGenerator,
    showDocumentUpload,
    hideDocumentUpload
} from './modules/ui.js';

import {
    sendMessage,
    stopResponse,
    addMessage,
    smoothScrollToBottom,
    initScrollMonitoring,
    enhanceAllAssistantMessagesWithCopy,
    getIsStreaming
} from './modules/chat.js';

import {
    uploadImage,
    generateImage,
    uploadDocument,
    handlePaste,
    clearUploadedDocument
} from './modules/image.js';

import {
    submitCode,
    clearContext,
    logout,
    fetchConversations,
    deleteConversation,
    createConversation,
    getConversationMessages,
    setModel,
    hasPremiumAccess
} from './modules/api.js';

import {
    getCachedConversation,
    cacheConversation
} from './modules/cache.js';

// Global State
let currentImageData = null;
let currentImageModel = localStorage.getItem('selectedImageModel') || 'imagen-4.0-ultra-generate-exp-05-20';
let currentChatModel = localStorage.getItem('selectedChatModel') || window.CURRENT_MODEL || 'gpt-4o-mini-search-preview-2025-03-11';
let currentConversationId = null;

// Parse model configuration from JSON script tag
const MODEL_CONFIG = JSON.parse(document.getElementById('models-config').textContent);
const FREE_MODELS = MODEL_CONFIG.freeModels;
const MODEL_ID_TO_NAME = MODEL_CONFIG.modelNames;

// Derive Premium models (all chat models + all image models that are NOT in free models)
// Note: We treat all image models as premium by default unless specified otherwise
const ALL_CHAT_MODELS = MODEL_CONFIG.chatModelIds;
const ALL_IMAGE_MODELS = MODEL_CONFIG.imageModelIds;

const PREMIUM_MODELS = [
    ...ALL_CHAT_MODELS.filter(id => !FREE_MODELS.includes(id)),
    ...ALL_IMAGE_MODELS.filter(id => !FREE_MODELS.includes(id))
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    addMicroInteractions();
    initConfirmModal();
    updatePremiumIndicator();
    initScrollMonitoring();
    updateModelSelectors(PREMIUM_MODELS, FREE_MODELS);

    // Initialize dark mode from localStorage
    const darkModeEnabled = localStorage.getItem('darkMode') === 'true';
    if (darkModeEnabled) {
        setDarkMode(true);
    }

    // Initialize model display from localStorage
    const savedModel = localStorage.getItem('selectedChatModel');
    if (savedModel && document.getElementById('currentModel')) {
        document.getElementById('currentModel').textContent = MODEL_ID_TO_NAME[savedModel] || savedModel;
        // Mark the selected model in the modal
        const modelOptions = document.querySelectorAll('#chatModelModal .model-option');
        modelOptions.forEach(option => {
            const optionModelId = option.getAttribute('data-model-id');
            if (optionModelId === savedModel) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
        // Also update the backend to sync with frontend if needed
        setModel(savedModel, 'chat').catch(err => console.error('Failed to sync model:', err));
    }

    // Initialize image model display from localStorage
    const savedImageModel = localStorage.getItem('selectedImageModel');
    if (savedImageModel) {
        const imageModelOptions = document.querySelectorAll('#imageModelModal .model-option');
        imageModelOptions.forEach(option => {
            const optionModelId = option.getAttribute('data-model-id');
            if (optionModelId === savedImageModel) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    }

    // Setup event listeners
    setupEventListeners();

    // Handle viewport changes for mobile
    setupViewportHandling();
});

window.onload = function () {
    // Clear any existing image indicator
    const indicator = document.getElementById('imageIndicator');
    if (indicator) {
        indicator.remove();
    }

    // Don't create conversation yet - wait for user's first message
    currentConversationId = null;

    updatePremiumIndicator();

    // Initialize image indicator click handler
    document.addEventListener('click', function (e) {
        if (e.target.closest('#imageIndicator')) {
            clearUploadedImage();
        }
    });

    // Initialize sidebar overlay handler
    document.addEventListener('click', function (e) {
        const sidebar = document.getElementById('sidebar');

        // If sidebar is open on mobile and click is outside sidebar and not on burger button
        if (sidebar && sidebar.classList.contains('open') &&
            window.innerWidth <= 700 &&
            !sidebar.contains(e.target) &&
            !e.target.closest('.burger-btn')) {
            sidebar.classList.remove('open');
        }
    });

    setTimeout(enhanceAllAssistantMessagesWithCopy, 500);
};

// Add resize listener to handle mobile premium indicator on screen size changes
window.addEventListener('resize', function () {
    if (window.innerWidth <= 700) {
        updatePremiumIndicator();
    }
});

function setupEventListeners() {
    // Global click handler for buttons that need to call exported functions
    // We need to attach these to window or use event delegation because HTML onclick attributes won't see modules

    // Attach functions to window for HTML onclick access
    window.toggleSidebar = toggleSidebar;
    window.showConversationListModal = () => showConversationListModal(switchConversationCallback);
    window.hideConversationListModal = hideConversationListModal;
    window.createNewConversation = createNewConversationCallback;
    window.clearContext = clearContextCallback;
    window.showModelSelector = showModelSelector;
    window.hideModelSelector = hideModelSelector;
    window.showImageUpload = showImageUpload;
    window.hideImageUpload = hideImageUpload;
    window.showImageGenerator = showImageGenerator;
    window.hideImageGenerator = hideImageGenerator;
    window.showDocumentUpload = showDocumentUpload;
    window.hideDocumentUpload = hideDocumentUpload;
    window.showBotInfoModal = showBotInfoModal;
    window.hideBotInfoModal = hideBotInfoModal;
    window.showCodeModal = showCodeModal;
    window.hideCodeModal = hideCodeModal;
    window.hideAlert = hideAlert;
    window.hideConfirmModal = hideConfirmModal;
    window.toggleDarkMode = toggleDarkMode;
    window.logout = logout;
    window.stopResponse = stopResponse;
    window.sendMessage = () => sendMessage(currentImageData, currentConversationId, (id) => currentConversationId = id);
    window.uploadImage = () => uploadImage((data) => currentImageData = data);
    window.generateImage = () => generateImage(currentImageModel);
    window.uploadDocument = () => uploadDocument(currentConversationId);
    window.submitCode = submitCodeCallback;
    window.modelOptionClick = modelOptionClick;
    window.handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(currentImageData, currentConversationId, (id) => currentConversationId = id);
        }
    };
    window.handlePaste = (e) => handlePaste(e, (data) => currentImageData = data);

    // Upload menu overlay functions
    window.showUploadMenu = () => {
        const overlay = document.getElementById('uploadOverlay');
        if (overlay) {
            const isVisible = overlay.style.display === 'flex';
            overlay.style.display = isVisible ? 'none' : 'flex';
        }
    };

    window.hideUploadMenu = () => {
        const overlay = document.getElementById('uploadOverlay');
        if (overlay) overlay.style.display = 'none';
    };

    // Click outside to close overlay
    document.addEventListener('click', (e) => {
        const overlay = document.getElementById('uploadOverlay');
        const uploadBtn = document.getElementById('uploadBtn');
        if (overlay && overlay.style.display === 'flex') {
            if (!overlay.contains(e.target) && !uploadBtn.contains(e.target)) {
                overlay.style.display = 'none';
            }
        }
    });



    // Input event listeners
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('focus', function () {
            setTimeout(function () {
                smoothScrollToBottom(document.getElementById('chatMessages'), true);
            }, 300);
        });
    }
}

function setupViewportHandling() {
    const chatMessages = document.getElementById('chatMessages');

    window.addEventListener('resize', function () {
        setTimeout(function () {
            if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 300);
    });

    let lastViewportHeight = window.innerHeight;
    function handleViewportChange() {
        const currentHeight = window.innerHeight;
        if (Math.abs(currentHeight - lastViewportHeight) > 50) {
            // Significant height change (likely keyboard open/close)
            setTimeout(function () {
                if (chatMessages) {
                    smoothScrollToBottom(chatMessages, true);
                }
                // Force a reflow to ensure proper positioning
                document.body.style.height = '100dvh';
                setTimeout(function () {
                    document.body.style.height = '';
                }, 10);
            }, 100);
        }
        lastViewportHeight = currentHeight;
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', function () {
        setTimeout(handleViewportChange, 500);
    });
}

// Callbacks to bridge modules
function switchConversationCallback(conversationId) {
    // Store the current conversation ID for sending messages
    currentConversationId = conversationId;

    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';

    // 1. Try to load from cache first for immediate display
    const cachedMessages = getCachedConversation(conversationId);
    if (cachedMessages) {
        cachedMessages.forEach(msg => {
            addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
        });
        // Scroll to bottom after loading cache
        setTimeout(() => {
            smoothScrollToBottom(chatMessages, false);
        }, 0);
    }

    // 2. Fetch from backend to get updates (stale-while-revalidate)
    getConversationMessages(conversationId)
        .then(data => {
            // If we have cached messages, we only want to update if there are changes
            // For simplicity in this version, we'll just re-render if we didn't have cache,
            // or if the server has more messages. 
            // A better approach would be to diff, but for now let's just update the cache
            // and only re-render if we had nothing cached.

            if (data.messages && data.messages.length > 0) {
                // Update cache with fresh data
                cacheConversation(conversationId, data.messages);

                // If we didn't have cache, render now
                if (!cachedMessages) {
                    data.messages.forEach(msg => {
                        addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
                    });
                } else if (data.messages.length > cachedMessages.length) {
                    // If server has more messages, append the new ones
                    // This is a simple check; in reality we might want to be more robust
                    const newMessages = data.messages.slice(cachedMessages.length);
                    newMessages.forEach(msg => {
                        addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
                    });
                }
            } else if (!cachedMessages) {
                addMessage('assistant', "New conversation started! How can I help you?");
            }
        })
        .catch(err => {
            console.error('Failed to fetch conversation:', err);
            if (!cachedMessages) {
                addMessage('assistant', "Failed to load conversation. Please try again.");
            }
        });
}

function createNewConversationCallback() {
    showConfirmModal('Are you sure you want to create a new conversation?', function () {
        createConversation()
            .then(data => {
                if (data.conversation_id) {
                    showConversationListModal(switchConversationCallback);
                    switchConversationCallback(data.conversation_id);
                    hideConversationListModal();
                }
            });
    });
}

function clearContextCallback() {
    if (confirm('Are you sure you want to clear the chat history?')) {
        clearContext()
            .then(data => {
                if (data.success) {
                    // Clear current image data
                    currentImageData = null;

                    // Reset input styling and remove image indicator
                    const input = document.getElementById('messageInput');
                    input.placeholder = "Type your message here...";
                    input.style.borderColor = "";
                    input.style.boxShadow = "";
                    const indicator = document.getElementById('imageIndicator');
                    if (indicator) {
                        indicator.remove();
                    }

                    document.getElementById('chatMessages').innerHTML = `
                    <div class="message assistant">
                        <div class="message-content">
                            Chat history cleared! How can I help you today?
                        </div>
                    </div>
                `;
                } else {
                    addMessage('assistant', `Error: ${data.error}`, 'error');
                }
            })
            .catch(error => {
                addMessage('assistant', `Error: ${error.message}`, 'error');
            });
    }
}

function submitCodeCallback() {
    const code = document.getElementById('codeInput').value.trim();
    submitCode(code).then(({ status, data }) => {
        if (status === 200 && data.valid) {
            localStorage.setItem('premium_code', code);
            localStorage.setItem('premium_code_valid', 'true');
            hideCodeModal();
            window.location.reload();
        } else {
            localStorage.setItem('premium_code', '');
            localStorage.setItem('premium_code_valid', 'false');
            document.getElementById('codeError').textContent = 'Invalid code!';
            updateModelSelectors(PREMIUM_MODELS, FREE_MODELS);
        }
    });
    updatePremiumIndicator();
}

function modelOptionClick(modelId, type) {
    // Block access if model is NOT in free models AND user doesn't have premium
    if (!FREE_MODELS.includes(modelId) && !hasPremiumAccess()) {
        showCodeModal('Enter a valid premium code to use this model.');
        return;
    }

    if (type === 'chat') {
        currentChatModel = modelId;
        localStorage.setItem('selectedChatModel', modelId);
        document.getElementById('currentModel').textContent = MODEL_ID_TO_NAME[modelId] || modelId;
        // Update chat model UI only
        const modelOptions = document.querySelectorAll('#chatModelModal .model-option');
        modelOptions.forEach(option => {
            const optionModelId = option.getAttribute('data-model-id');
            if (optionModelId === modelId) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
                // Remove indicator if it exists
                const indicator = option.querySelector('.current-indicator');
                if (indicator) {
                    indicator.remove();
                }
            }
        });
    } else if (type === 'image') {
        currentImageModel = modelId;
        localStorage.setItem('selectedImageModel', modelId);
        // Update image model UI only
        const modelOptions = document.querySelectorAll('#imageModelModal .model-option');
        modelOptions.forEach(option => {
            const optionModelId = option.getAttribute('data-model-id');
            if (optionModelId === modelId) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
                // Remove indicator if it exists
                const indicator = option.querySelector('.current-indicator');
                if (indicator) {
                    indicator.remove();
                }
            }
        });
    }

    setModel(modelId, type)
        .then(data => {
            if (data.success) {
                hideModelSelector(type);
                addMessage('assistant', 'Model changed successfully!', 'success');
            } else {
                addMessage('assistant', `Error: ${data.error}`, 'error');
            }
        })
        .catch(error => {
            addMessage('assistant', `Error: ${error.message}`, 'error');
        });
}

function clearUploadedImage() {
    currentImageData = null;

    // Reset input styling and remove image indicator
    const input = document.getElementById('messageInput');
    input.placeholder = "Type your message here...";
    input.style.borderColor = "";
    input.style.boxShadow = "";
    const indicator = document.getElementById('imageIndicator');
    if (indicator) {
        indicator.remove();
    }

    addMessage('assistant', 'Uploaded image cleared. You can upload a new image or continue chatting.');
}
