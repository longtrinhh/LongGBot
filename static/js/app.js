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

// Global State
let currentImageData = null;
let currentImageModel = localStorage.getItem('selectedImageModel') || 'imagen-4.0-ultra-generate-exp-05-20';
let currentChatModel = localStorage.getItem('selectedChatModel') || window.CURRENT_MODEL || 'gpt-4o-mini-search-preview-2025-03-11';
let currentConversationId = null;

// Constants
const PREMIUM_MODELS = [
    "claude-sonnet-4-20250514-thinking",
    "claude-sonnet-4-5-20250929-thinking",
    "o3-high",
    "gemini-2.5-pro-preview-05-06",
    "grok-4-0709",
    "gpt-5-chat-latest",
    "gpt-5.1",
    "deepseek-r1-0528",
    "llama-4-maverick-17b-128e-instruct",
    "phi-4-multimodal-instruct",
    "sonar-reasoning-pro",
    "o3-mini-online",
    "imagen-4.0-ultra-generate-exp-05-20",
    "flux-1-kontext-max",
    "gpt-image-1",
    "midjourney-v7",
    "hidream-i1-full"
];
const FREE_MODELS = [
    "gpt-4o-mini-search-preview-2025-03-11",
    "deepseek-v3.1:free",
    "gpt-oss-120b:free",
    "deepseek-r1-0528:free",
    "kimi-k2-instruct-0905:free"
];

// Parse model ID to name mapping from JSON script tag
const MODEL_ID_TO_NAME = JSON.parse(document.getElementById('model-names').textContent);

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
    // Load messages for the selected conversation
    getConversationMessages(conversationId)
        .then(data => {
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    addMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
                });
            } else {
                addMessage('assistant', "New conversation started! How can I help you?");
            }
        });
    // Store the current conversation ID for sending messages
    currentConversationId = conversationId;
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
