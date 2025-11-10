let currentImageData = null;
let currentImageModel = 'imagen-4.0-ultra-generate-exp-05-20';
let currentChatModel = window.CURRENT_MODEL || 'gpt-4o-mini-search-preview-2025-03-11';

// Performance optimizations: Cache DOM elements to avoid repeated queries
const cachedElements = {};
function getCachedElement(id) {
    if (!cachedElements[id]) {
        cachedElements[id] = document.getElementById(id);
    }
    return cachedElements[id];
}

// Debounce function for performance
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Add subtle particle effect
function createParticles() {
    const particlesContainer = document.createElement('div');
    particlesContainer.id = 'particles';
    particlesContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -1;
        overflow: hidden;
    `;
    document.body.appendChild(particlesContainer);

    for (let i = 0; i < 20; i++) {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: absolute;
            width: 4px;
            height: 4px;
            background: rgba(74, 74, 138, 0.1);
            border-radius: 50%;
            animation: float ${5 + Math.random() * 10}s linear infinite;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
        `;
        particlesContainer.appendChild(particle);
    }
}

// Add floating animation for particles
const style = document.createElement('style');
style.textContent = `
    @keyframes float {
        0% {
            transform: translateY(100vh) rotate(0deg);
            opacity: 0;
        }
        10% {
            opacity: 1;
        }
        90% {
            opacity: 1;
        }
        100% {
            transform: translateY(-100px) rotate(360deg);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize particles on page load
window.addEventListener('load', createParticles);

const PREMIUM_MODELS = [
    "claude-sonnet-4-20250514-thinking",
    "claude-sonnet-4-5-20250929-thinking",
    "o3-high",
    "gemini-2.5-pro-preview-05-06",
    "grok-4-0709",
    "gpt-5-chat-latest",
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
    "gpt-5-nano:free",
    "deepseek-v3.1:free",
    "gpt-oss-120b:free",
    "deepseek-r1-0528:free",
    "qwen3-coder-480b-a35b-instruct:free",
    "kimi-k2-instruct-0905:free"
];

// Parse model ID to name mapping from JSON script tag
const MODEL_ID_TO_NAME = JSON.parse(document.getElementById('model-names').textContent);

// Move hideAllSelectors to the top to avoid reference errors
function hideAllSelectors() {
    getCachedElement('chatModelModal').style.display = 'none';
    getCachedElement('imageModelModal').style.display = 'none';
    getCachedElement('imageUploadModal').style.display = 'none';
    getCachedElement('imageGeneratorModal').style.display = 'none';
}

// Helper function to hide sidebar on mobile when modals are opened
function hideSidebarOnMobile() {
    const sidebar = getCachedElement('sidebar');
    const overlay = getCachedElement('sidebarOverlay');
    if (sidebar && window.innerWidth <= 700) {
        sidebar.classList.remove('open');
        if (overlay) overlay.style.display = 'none';
    }
}

// Initialize micro-interactions on page load
window.addEventListener('load', addMicroInteractions);

// On page load, start with fresh conversation (don't load history)
window.onload = function() {
    console.log('Page loaded, ready for fresh conversation...');
    
    // Clear any existing image indicator
    const indicator = document.getElementById('imageIndicator');
    if (indicator) {
        indicator.remove();
    }
    
    // Don't create conversation yet - wait for user's first message
    // This prevents empty conversations from being saved
    window.currentConversationId = null;
    
    console.log('Ready for new conversation (will create on first message)');
};

function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function handlePaste(event) {
    // Premium gate for paste-upload
    if (!hasPremiumAccess()) {
        showAlert('Pasting images is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        event.preventDefault();
        return;
    }
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
                // Validate file type - only accept image files
                const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
                if (!allowedTypes.includes(file.type)) {
                    showAlert('Only image files can be pasted. Please paste a JPEG, PNG, GIF, WebP, or BMP image.');
                    return;
                }
                
                // Validate file size (max 10MB)
                const maxSize = 10 * 1024 * 1024; // 10MB
                if (file.size > maxSize) {
                    showAlert('Image file too large. Please paste an image smaller than 10MB.');
                    return;
                }
                
                // Show a clean uploading indicator without the base64 data
                const uploadingDiv = addMessage('assistant', '<i class="fas fa-spinner fa-spin"></i> <b>Uploading pasted image...</b>');
                
                // Upload image directly
                const formData = new FormData();
                formData.append('image', file);
                fetchWithCode('/upload_image', {
                    method: 'POST',
                    body: formData
                })
                .then(response => {
                    if (response.status === 403) {
                        throw new Error('Premium required');
                    }
                    return response.json();
                })
                .then(data => {
                    // Remove the uploading message
                    if (uploadingDiv && uploadingDiv.parentNode) uploadingDiv.parentNode.removeChild(uploadingDiv);
                    
                    if (data.success) {
                        currentImageData = data.image;
                        
                        // Show a clean success message with small preview
                        addMessage('assistant', 'Image pasted successfully! You can now ask me to analyze it.');
                        
                        // Update input styling to indicate image is ready
                        const messageInput = document.getElementById('messageInput');
                        messageInput.placeholder = "Ask me about the pasted image...";
                        messageInput.style.borderColor = "#4a4a8a";
                        messageInput.style.boxShadow = "0 0 10px rgba(74, 74, 138, 0.3)";
                        
                        // Remove any existing image indicator
                        const existingIndicator = document.getElementById('imageIndicator');
                        if (existingIndicator) {
                            existingIndicator.remove();
                        }
                        
                        // Add floating indicator with small preview
                        const indicator = document.createElement('div');
                        indicator.id = 'imageIndicator';
                        indicator.innerHTML = `<i class="fas fa-image"></i> Image ready (click to remove)`;
                        
                        if (data.image) {
                            const thumb = document.createElement('img');
                            thumb.src = data.image;
                            thumb.alt = 'preview';
                            thumb.style.cssText = `
                                width: 36px;
                                height: 36px;
                                object-fit: cover;
                                border-radius: 8px;
                                margin-right: 10px;
                                vertical-align: middle;
                                box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                                border: 1px solid #eee;
                                background: #fff;
                                display: inline-block;
                            `;
                            indicator.prepend(thumb);
                        }
                        
                        // Style the floating indicator
                        indicator.style.cssText = `
                            position: fixed;
                            bottom: 90px;
                            right: 40px;
                            z-index: 2000;
                            background: #4a4a8a;
                            color: white;
                            padding: 8px 16px 8px 8px;
                            border-radius: 16px;
                            font-size: 1rem;
                            box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                            animation: fadeInUp 0.3s ease-out;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s;
                        `;
                        
                        // Add hover effects
                        indicator.addEventListener('mouseenter', function() {
                            this.style.background = '#6a6a9a';
                            this.style.transform = 'scale(1.05)';
                        });
                        indicator.addEventListener('mouseleave', function() {
                            this.style.background = '#4a4a8a';
                            this.style.transform = 'scale(1)';
                        });
                        
                        // Add click to remove functionality
                        indicator.addEventListener('click', function() {
                            currentImageData = null;
                            messageInput.placeholder = "Type your message here...";
                            messageInput.style.borderColor = "";
                            messageInput.style.boxShadow = "";
                            this.remove();
                            addMessage('assistant', 'Image removed.');
                        });
                        
                        messageInput.parentElement.appendChild(indicator);
                    } else {
                        addMessage('assistant', `Error uploading image: ${data.error}`, 'error');
                    }
                })
                .catch(error => {
                    // Remove the uploading message
                    if (uploadingDiv && uploadingDiv.parentNode) uploadingDiv.parentNode.removeChild(uploadingDiv);
                    if (error.message === 'Premium required') {
                        showAlert('Pasting images is a premium feature. Enter a premium code to unlock.');
                        showCodeModal();
                    } else {
                        addMessage('assistant', `Error uploading image: ${error.message}`, 'error');
                    }
                });
                event.preventDefault();
                break;
            }
        }
    }
}

// Global variable to track current stream reader
let currentStreamReader = null;
let isStreaming = false;

function stopResponse() {
    if (currentStreamReader && isStreaming) {
        currentStreamReader.cancel();
        currentStreamReader = null;
        isStreaming = false;
        
        // Reset scroll tracking flags
        userScrolledUp = false;
        
        // Reset UI
        const sendBtn = getCachedElement('sendBtn');
        const stopBtn = getCachedElement('stopBtn');
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        
        // Call backend to notify cancellation
        fetchWithCode('/cancel_stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        }).catch(error => {
            console.log('Error notifying backend of cancellation:', error);
        });
        
        // Add a message indicating the response was stopped
        addMessage('assistant', '<span style="color: #ff6b6b; font-style: italic;"><i class="fas fa-stop"></i> Response stopped by user.</span>', 'stopped');
    }
}

function sendMessage() {
    console.log('sendMessage called');
    const input = getCachedElement('messageInput');
    const sendBtn = getCachedElement('sendBtn');
    const stopBtn = getCachedElement('stopBtn');
    const message = input.value.trim();
    if (!message) return;
    
    // Add loading state to send button and show stop button
    sendBtn.classList.add('loading');
    sendBtn.disabled = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    isStreaming = true;
    
    // Reset scroll tracking flags
    userScrolledUp = false;
    lastAutoScrollTime = 0;
    
    // Add the user message
    addMessage('user', message);
    input.value = '';
    
    // Reset input styling and remove image indicator only
    // Keep document indicator visible for multiple questions
    input.placeholder = "Type your message here...";
    input.style.borderColor = "";
    input.style.boxShadow = "";
    const imageIndicator = document.getElementById('imageIndicator');
    if (imageIndicator) {
        imageIndicator.remove();
    }
    
    // If a document indicator exists, keep it for this request so the server can read the doc
    // The indicator and backend state will be cleared after the response completes
    
    // Insert an animated 'thinking...' assistant message and keep its element
    let thinkingMessage = createThinkingIndicator();
    if (currentImageData) {
        thinkingMessage = createThinkingIndicator().replace('thinking', 'analyzing image');
    } else if (document.getElementById('documentIndicator')) {
        thinkingMessage = createThinkingIndicator().replace('thinking', 'analyzing document');
    }
    const thinkingDiv = addMessage('assistant', thinkingMessage, 'thinking');
    
    // Prepare request data
    const requestData = { message: message };
    // If there's an uploaded image, include it in the request
    if (currentImageData) {
        requestData.image = currentImageData;
        // Clear the current image data after sending
        currentImageData = null;
    }
    // Include conversation_id if set
    if (window.currentConversationId) {
        requestData.conversation_id = window.currentConversationId;
    }
    
    // Use streaming endpoint
    fetchWithCode('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || 'Network error');
            });
        }
        
        // Remove the 'thinking...' message completely
        if (thinkingDiv && thinkingDiv.parentNode) {
            thinkingDiv.parentNode.removeChild(thinkingDiv);
        }
        
        // Create a new assistant message for streaming
        const assistantMessageDiv = addMessage('assistant', '', 'streaming');
        let fullResponse = '';
        let hasReceivedFirstChunk = false;
        let thinkingShown = false;
        
        const reader = response.body.getReader();
        currentStreamReader = reader;
        const decoder = new TextDecoder();
        
        function readStream() {
            return reader.read().then(({ done, value }) => {
                if (done) {
                    // Remove loading state
                    sendBtn.classList.remove('loading');
                    sendBtn.disabled = false;
                    sendBtn.style.display = 'flex';
                    stopBtn.style.display = 'none';
                    isStreaming = false;
        
        // Reset scroll tracking flags
        userScrolledUp = false;
                    currentStreamReader = null;
                    // Add copy buttons to the just-finished message
                    setTimeout(enhanceAllAssistantMessagesWithCopy, 0);
                    return;
                }
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            // Capture conversation_id from the stream as soon as it arrives
                            if (data.conversation_id && !window.currentConversationId) {
                                window.currentConversationId = data.conversation_id;
                            }
                            
                            if (data.error) {
                                // Remove loading state
                                sendBtn.classList.remove('loading');
                                sendBtn.disabled = false;
                                sendBtn.style.display = 'flex';
                                stopBtn.style.display = 'none';
                                isStreaming = false;
        
        // Reset scroll tracking flags
        userScrolledUp = false;
                                currentStreamReader = null;
                                addMessage('assistant', `Error: ${data.error}`, 'error');
                                return;
                            } else if (data.chunk !== undefined) {
                                const messageContent = assistantMessageDiv.querySelector('.message-content');
                                
                                // If chunk is empty string, show thinking indicator
                                if (data.chunk === '') {
                                    if (!thinkingShown && messageContent) {
                                        messageContent.innerHTML = '<span class="stream-thinking-indicator" style="color: #888; font-style: italic;"><i class="fas fa-brain"></i> Thinking...</span>';
                                        thinkingShown = true;
                                    }
                                    continue;
                                }
                                
                                // Check for <think>...</think> block
                                const thinkMatch = data.chunk.match(/^<think>([\s\S]*?)<\/think>$/i);
                                if (thinkMatch) {
                                    // Only show the indicator once
                                    if (!thinkingShown && messageContent) {
                                        messageContent.innerHTML = '<span class="stream-thinking-indicator" style="color: #888; font-style: italic;"><i class="fas fa-brain"></i> Thinking...</span>';
                                        thinkingShown = true;
                                    }
                                    // Do not append to fullResponse
                                    continue;
                                } else {
                                    // Remove the thinking indicator if present when we get actual content
                                    if (thinkingShown && messageContent) {
                                        messageContent.innerHTML = '';
                                        thinkingShown = false;
                                    }
                                }
                                
                                if (!hasReceivedFirstChunk) {
                                    hasReceivedFirstChunk = true;
                                }
                                fullResponse += data.chunk;
                                // Update the message content with markdown rendering
                                if (messageContent) {
                                    messageContent.innerHTML = marked.parse(fullResponse);
                                }
                                // Only auto-scroll if user is near bottom (don't force during streaming)
                                smoothScrollToBottom(document.getElementById('chatMessages'), false);
                            } else if (data.done) {
                                if (data.conversation_id && !window.currentConversationId) {
                                    window.currentConversationId = data.conversation_id;
                                }
                                // Remove loading state
                                sendBtn.classList.remove('loading');
                                sendBtn.disabled = false;
                                sendBtn.style.display = 'flex';
                                stopBtn.style.display = 'none';
                                isStreaming = false;
        
        // Reset scroll tracking flags
        userScrolledUp = false;
                                currentStreamReader = null;
                                // Auto-clear document indicator after the first completed response
                                const docInd2 = document.getElementById('documentIndicator');
                                if (docInd2) {
                                    docInd2.remove();
                                    fetch('/clear_document', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ conversation_id: window.currentConversationId || null })
                                    }).catch(() => {});
                                    const msgInput2 = document.getElementById('messageInput');
                                    if (msgInput2) {
                                        msgInput2.placeholder = 'Type your message here...';
                                        msgInput2.style.borderColor = '';
                                        msgInput2.style.boxShadow = '';
                                    }
                                }

                                // Add copy buttons to the just-finished message (only the last one for efficiency)
                                setTimeout(() => {
                                    const allAssistantMessages = document.querySelectorAll('.message.assistant .message-content');
                                    if (allAssistantMessages.length > 0) {
                                        const last = allAssistantMessages[allAssistantMessages.length - 1];
                                        // Enhance only the last message
                                        if (!last.querySelector('.copy-btn-bar')) {
                                            // (reuse the logic from enhanceAllAssistantMessagesWithCopy for a single message)
                                            let rawMarkdown = fullResponse; // Use fullResponse instead of textContent
                                            const codeBlocks = last.querySelectorAll('pre > code');
                                            codeBlocks.forEach((codeBlock, idx) => {
                                                const pre = codeBlock.parentElement;
                                                if (pre.querySelector('.copy-code-btn')) return;
                                                const btn = document.createElement('button');
                                                btn.className = 'copy-code-btn btn';
                                                btn.title = 'Copy code';
                                                btn.innerHTML = '<i class="fas fa-copy"></i>';
                                                btn.onclick = function(e) {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(codeBlock.textContent);
                                                    btn.classList.add('copied');
                                                    setTimeout(() => { btn.classList.remove('copied'); }, 1200);
                                                };
                                                pre.style.position = 'relative';
                                                btn.style.position = 'absolute';
                                                btn.style.top = '8px';
                                                btn.style.right = '8px';
                                                btn.style.zIndex = '2';
                                                pre.appendChild(btn);
                                            });
                                            const copyBtns = document.createElement('div');
                                            copyBtns.className = 'copy-btn-bar copy-btn-bar-bottom';
                                            const markdownBtn = document.createElement('button');
                                            markdownBtn.className = 'copy-markdown-btn btn';
                                            markdownBtn.title = 'Copy Markdown';
                                            markdownBtn.innerHTML = '<i class="fas fa-copy"></i>';
                                            const plainBtn = document.createElement('button');
                                            plainBtn.className = 'copy-plain-btn btn';
                                            plainBtn.title = 'Copy Plain Text';
                                            plainBtn.innerHTML = '<i class="fas fa-file-alt"></i>';
                                            copyBtns.appendChild(markdownBtn);
                                            copyBtns.appendChild(plainBtn);
                                            last.appendChild(copyBtns);
                                            markdownBtn.onclick = function(e) {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText(rawMarkdown);
                                                markdownBtn.classList.add('copied');
                                                setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
                                            };
                                            plainBtn.onclick = function(e) {
                                                e.stopPropagation();
                                                let plain = rawMarkdown
                                                    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''))
                                                    .replace(/`([^`]+)`/g, '$1')
                                                    .replace(/\*\*([^*]+)\*\*/g, '$1')
                                                    .replace(/\*([^*]+)\*/g, '$1')
                                                    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                                                    .replace(/\!\[(.*?)\]\(.*?\)/g, '')
                                                    .replace(/#+\s/g, '')
                                                    .replace(/\n{2,}/g, '\n')
                                                    .replace(/^- /gm, '')
                                                    .replace(/> /g, '')
                                                    .replace(/\|/g, '');
                                                navigator.clipboard.writeText(plain);
                                                plainBtn.classList.add('copied');
                                                setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
                                            };
                                        }
                                    }
                                }, 0);
                                return;
                            }
                        } catch (e) {
                            // Ignore JSON parse errors for incomplete chunks
                        }
                    }
                }
                
                return readStream();
            });
        }
        
        return readStream();
    })
    .catch(error => {
        // Remove loading state
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        isStreaming = false;
        
        // Reset scroll tracking flags
        userScrolledUp = false;
        currentStreamReader = null;
        
        if (thinkingDiv && thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
        addMessage('assistant', `Error: ${error.message}`, 'error');
    });
}

function createThinkingIndicator() {
    return `<span style="color: #888; font-style: italic;"><i class="fas fa-brain"></i> Thinking...</span>`;
}

function createGeneratingIndicator() {
    return `**Generating image**...`;
}

function createTypingIndicator() {
    return `
        <div class="typing-indicator">
            <span>AI is typing</span>
            <div class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
}

function markdownTableToHtml(md) {
    // Convert markdown table to HTML table
    // Only supports simple tables (no row/colspan, no alignment)
    const lines = md.trim().split('\n');
    if (lines.length < 2 || !lines[1].match(/^\|[-| ]+\|$/)) return md; // Not a table
    let html = '<table class="md-table"><thead><tr>';
    const headers = lines[0].split('|').slice(1, -1).map(h => h.trim());
    headers.forEach(h => html += `<th>${h}</th>`);
    html += '</tr></thead><tbody>';
    for (let i = 2; i < lines.length; i++) {
        if (!lines[i].trim().startsWith('|')) continue;
        html += '<tr>';
        const cells = lines[i].split('|').slice(1, -1).map(c => c.trim());
        cells.forEach(c => html += `<td>${c}</td>`);
        html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
}

function extractSources(md) {
    // Find a 'Sources:' section and build a mapping
    const sources = {};
    const match = md.match(/Sources?:\s*([\s\S]*)/i);
    if (match) {
        const lines = match[1].split(/\n|<br>/);
        lines.forEach(line => {
            const m = line.match(/(\d+)\.\s*(https?:\/\/\S+)/);
            if (m) sources[m[1]] = m[2];
        });
    }
    return sources;
}

function linkifyReferences(md, sources) {
    // Replace [1], [2], ... with links if mapping exists
    return md.replace(/\[(\d+)\]/g, (m, n) => {
        if (sources[n]) return `<a href="${sources[n]}" target="_blank">[${n}]</a>`;
        return m;
    });
}

// Track if user has manually scrolled during streaming
let userScrolledUp = false;
let lastAutoScrollTime = 0;

// Check if user is near the bottom of the chat
function isNearBottom(container, threshold = 50) {
    if (!container) return true;
    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

// Enhanced scroll to bottom with smooth animation
function smoothScrollToBottom(container, forceScroll = false) {
    if (!container) return;
    
    // During streaming, be more restrictive about auto-scrolling
    if (!forceScroll && isStreaming) {
        // Check if user has manually scrolled up during streaming
        if (userScrolledUp) {
            return;
        }
        // Only auto-scroll if user is very close to bottom during streaming
        if (!isNearBottom(container, 30)) {
            return;
        }
    } else if (!forceScroll && !isNearBottom(container)) {
        return;
    }
    
    // Add a small delay to ensure DOM updates are complete
    setTimeout(() => {
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        const maxScrollTop = scrollHeight - clientHeight;
        
        // On mobile, add extra padding to ensure last message is visible
        const isMobile = window.innerWidth <= 700;
        const extraPadding = isMobile ? 20 : 0;
    
        container.scrollTo({
            top: maxScrollTop + extraPadding,
            behavior: 'smooth'
        });
        
        // Track auto-scroll time
        lastAutoScrollTime = Date.now();
    }, 50);
}


// Monitor scroll position for user behavior tracking
function initScrollMonitoring() {
    const chatMessages = document.getElementById('chatMessages');
    
    if (!chatMessages) return;
    
    let scrollTimeout;
    
    chatMessages.addEventListener('scroll', function(e) {
        // Clear existing timeout
        clearTimeout(scrollTimeout);
        
        // Debounce scroll events
        scrollTimeout = setTimeout(() => {
            const isUserAtBottom = isNearBottom(chatMessages, 100);
            
            // Check if this was a user-initiated scroll during streaming
            if (isStreaming) {
                const timeSinceAutoScroll = Date.now() - lastAutoScrollTime;
                
                // If scroll happened more than 100ms after auto-scroll, it's likely user-initiated
                if (timeSinceAutoScroll > 100 && !isUserAtBottom) {
                    userScrolledUp = true;
                } else if (isUserAtBottom) {
                    // User scrolled back to bottom
                    userScrolledUp = false;
                }
            }
        }, 100);
    });
}

// Add micro-interactions
function addMicroInteractions() {
    // Add ripple effect to buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('btn') || e.target.closest('.btn')) {
            const button = e.target.classList.contains('btn') ? e.target : e.target.closest('.btn');
            const ripple = document.createElement('span');
            const rect = button.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            const x = e.clientX - rect.left - size / 2;
            const y = e.clientY - rect.top - size / 2;
            
            ripple.style.cssText = `
                position: absolute;
                width: ${size}px;
                height: ${size}px;
                left: ${x}px;
                top: ${y}px;
                background: rgba(255, 255, 255, 0.3);
                border-radius: 50%;
                transform: scale(0);
                animation: ripple 0.6s linear;
                pointer-events: none;
            `;
            
            button.appendChild(ripple);
            setTimeout(() => ripple.remove(), 600);
        }
    });

    // Add ripple animation
    const rippleStyle = document.createElement('style');
    rippleStyle.textContent = `
        @keyframes ripple {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(rippleStyle);
}

// Enhanced addMessage function with proper markdown rendering
function addMessage(sender, content, type = 'normal', imageData = null) {
    const messagesContainer = getCachedElement('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    let messageContent = '';
    let rawMarkdown = content;
    
    if (sender === 'assistant' && type !== 'error' && type !== 'success') {
        // Remove <think> blocks if present
        let htmlContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
        rawMarkdown = htmlContent;
        // Use marked library to render markdown
        htmlContent = marked.parse(htmlContent);
        
        // Extract sources and linkify references (keep this for compatibility)
        const sources = extractSources(htmlContent);
        htmlContent = linkifyReferences(htmlContent, sources);
        
        // Add copy code buttons to code blocks (icon only)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const codeBlocks = tempDiv.querySelectorAll('pre > code');
        codeBlocks.forEach((codeBlock, idx) => {
            const pre = codeBlock.parentElement;
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn btn';
            btn.title = 'Copy code';
            btn.innerHTML = '<i class="fas fa-copy"></i>';
            btn.onclick = function(e) {
                e.stopPropagation();
                navigator.clipboard.writeText(codeBlock.textContent);
                btn.classList.add('copied');
                setTimeout(() => { btn.classList.remove('copied'); }, 1200);
            };
            pre.style.position = 'relative';
            btn.style.position = 'absolute';
            btn.style.top = '8px';
            btn.style.right = '8px';
            btn.style.zIndex = '2';
            pre.appendChild(btn);
        });
        // Copy bar at the end (bottom right) of the message
        let copyBtns = `<div class="copy-btn-bar copy-btn-bar-bottom">
            <button class="copy-markdown-btn btn" title="Copy Markdown"><i class="fas fa-copy"></i></button>
            <button class="copy-plain-btn btn" title="Copy Plain Text"><i class="fas fa-file-alt"></i></button>
        </div>`;
        if (imageData) {
            messageContent = `<div class="message-content">` +
                `<img src="${imageData}" class="message-image" alt="Generated image" style="display:block;margin-bottom:10px;max-width:100%;border-radius:8px;" loading="lazy" onload="smoothScrollToBottom(getCachedElement('chatMessages'), true);">` +
                tempDiv.innerHTML + copyBtns + `</div>`;
        } else {
            messageContent = `<div class="message-content">${tempDiv.innerHTML}${copyBtns}</div>`;
        }
    } else if (sender === 'user') {
        // Display user messages as plain text only
        let plainText = content;
        
        // Remove <think> blocks if present
        plainText = plainText.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // Escape HTML to display as plain text
        plainText = plainText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        // Convert line breaks to <br> for display
        plainText = plainText.replace(/\n/g, '<br>');
        
        messageContent = `<div class="message-content">${plainText}</div>`;
    } else {
        // For system messages (error, success, thinking, generating), keep basic formatting
        let htmlContent = content;
        
        // Remove <think> blocks if present
        htmlContent = htmlContent.replace(/<think>[\s\S]*?<\/think>/gi, '');
        
        // Basic formatting for system messages (just line breaks and basic bold)
        htmlContent = htmlContent.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
        
        if (type === 'error') {
            messageContent = `<div class="message-content error">${htmlContent}</div>`;
        } else if (type === 'success') {
            messageContent = `<div class="message-content success">${htmlContent}</div>`;
        } else if (type === 'thinking') {
            messageContent = `<div class="message-content">${htmlContent}</div>`;
        } else if (type === 'generating') {
            messageContent = `<div class="message-content">${htmlContent}</div>`;
        } else if (type === 'streaming') {
            messageContent = `<div class="message-content"></div>`;
        } else {
            messageContent = `<div class="message-content">${htmlContent}</div>`;
        }
    }
    
    messageDiv.innerHTML = messageContent;
    messagesContainer.appendChild(messageDiv);
    
    // Add entrance animation
    messageDiv.style.opacity = '0';
    messageDiv.style.transform = sender === 'user' ? 'translateX(30px)' : 'translateX(-30px)';
    
    // Trigger animation after a small delay
    setTimeout(() => {
        messageDiv.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        messageDiv.style.opacity = '1';
        messageDiv.style.transform = 'translateX(0)';
    }, 10);
    
    // Smooth scroll to bottom (force scroll for new messages)
    setTimeout(() => {
        smoothScrollToBottom(messagesContainer, true);
    }, 100);
    
    // If there's an image, scroll again after it loads
    if (imageData) {
        const img = messageDiv.querySelector('img');
        if (img) {
            img.onload = () => {
                setTimeout(() => {
                    smoothScrollToBottom(messagesContainer, true);
                }, 100);
            };
        }
    }
    
    // Add copy markdown/plain event listeners for assistant messages
    if (sender === 'assistant' && type !== 'error' && type !== 'success') {
        const markdownBtn = messageDiv.querySelector('.copy-markdown-btn');
        const plainBtn = messageDiv.querySelector('.copy-plain-btn');
        if (markdownBtn) {
            markdownBtn.onclick = function(e) {
                e.stopPropagation();
                navigator.clipboard.writeText(rawMarkdown);
                markdownBtn.classList.add('copied');
                setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
            };
        }
        if (plainBtn) {
            plainBtn.onclick = function(e) {
                e.stopPropagation();
                // Remove markdown formatting for plain text
                let plain = rawMarkdown
                    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''))
                    .replace(/`([^`]+)`/g, '$1')
                    .replace(/\*\*([^*]+)\*\*/g, '$1')
                    .replace(/\*([^*]+)\*/g, '$1')
                    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                    .replace(/\!\[(.*?)\]\(.*?\)/g, '')
                    .replace(/#+\s/g, '')
                    .replace(/\n{2,}/g, '\n')
                    .replace(/^- /gm, '')
                    .replace(/> /g, '')
                    .replace(/\|/g, '');
                navigator.clipboard.writeText(plain);
                plainBtn.classList.add('copied');
                setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
            };
        }
    }
    
    return messageDiv;
}

function showModelSelector(type) {
    hideAllSelectors();
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    if (type === 'chat') {
        const modal = document.getElementById('chatModelModal');
        modal.style.display = 'flex';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.transition = 'opacity 0.2s ease-out';
            modal.style.opacity = '1';
        }, 10);
        // Highlight the current chat model only
        setTimeout(() => {
            const modelOptions = document.querySelectorAll('#chatModelModal .model-option');
            modelOptions.forEach(option => {
                const modelId = option.getAttribute('data-model-id');
                if (modelId === currentChatModel) {
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
        }, 0);
    } else if (type === 'image') {
        const modal = document.getElementById('imageModelModal');
        modal.style.display = 'flex';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.transition = 'opacity 0.2s ease-out';
            modal.style.opacity = '1';
        }, 10);
        // Highlight the current image model only
        setTimeout(() => {
            const modelOptions = document.querySelectorAll('#imageModelModal .model-option');
            modelOptions.forEach(option => {
                const modelId = option.getAttribute('data-model-id');
                if (modelId === currentImageModel) {
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
        }, 0);
    }
}

function hideModelSelector(type) {
    console.log('hideModelSelector called with type:', type);
    if (type === 'chat') {
        const modal = document.getElementById('chatModelModal');
        modal.style.transition = 'opacity 0.2s ease-out';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    } else {
        const modal = document.getElementById('imageModelModal');
        modal.style.transition = 'opacity 0.2s ease-out';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 200);
    }
}

function selectModel(modelId, type) {
    if (type === 'chat') {
        currentChatModel = modelId;
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
    fetchWithCode('/set_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, model_type: type })
    })
    .then(response => response.json())
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

function clearContext() {
    console.log('clearContext called');
    if (confirm('Are you sure you want to clear the chat history?')) {
        fetch('/clear_context', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
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

function showImageUpload() {
    if (!hasPremiumAccess()) {
        showAlert('Image upload is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }
    hideAllSelectors();
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    const modal = document.getElementById('imageUploadModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

function hideImageUpload() {
    console.log('hideImageUpload called');
    const modal = document.getElementById('imageUploadModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function uploadImage() {
    if (!hasPremiumAccess()) {
        showAlert('Image upload is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }
    console.log('uploadImage called');
    const fileInput = document.getElementById('imageFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Please select a file first');
        return;
    }
    
    // Validate file type - only accept image files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (!allowedTypes.includes(file.type)) {
        showAlert('Only image files are allowed. Please select a JPEG, PNG, GIF, WebP, or BMP file.');
        fileInput.value = '';
        return;
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        showAlert('File size too large. Please select an image smaller than 10MB.');
        fileInput.value = '';
        return;
    }
    
    // Add loading state to upload button - find the specific upload button
    const uploadBtn = document.querySelector('#imageUploadModal button[onclick="uploadImage()"]');
    if (uploadBtn) {
        uploadBtn.classList.add('loading');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    }
    
    const formData = new FormData();
    formData.append('image', file);
    
    // Use regular fetch since upload doesn't require premium auth
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    fetch('/upload_image', {
        method: 'POST',
        body: formData,
        signal: controller.signal
    })
    .then(response => {
        clearTimeout(timeoutId); // Clear timeout on successful response
        console.log('Upload response status:', response.status);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Upload response data:', data);
        // Remove loading state
        if (uploadBtn) {
            uploadBtn.classList.remove('loading');
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
        
        if (data.success) {
            currentImageData = data.image;
            addMessage('assistant', 'Image uploaded successfully! You can now ask me to analyze it.');
            hideImageUpload();
            
            // Update chat input styling to indicate image is ready
            const messageInput = document.getElementById('messageInput');
            messageInput.placeholder = "Ask me about the uploaded image...";
            messageInput.style.borderColor = "#4a4a8a";
            messageInput.style.boxShadow = "0 0 10px rgba(74, 74, 138, 0.3)";
            
            // Remove any existing image indicator
            const existingIndicator = document.getElementById('imageIndicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            
            // Add floating indicator with small preview
            const indicator = document.createElement('div');
            indicator.id = 'imageIndicator';
            indicator.innerHTML = `<i class="fas fa-image"></i> Image ready (click to remove)`;
            
            if (data.image) {
                const thumb = document.createElement('img');
                thumb.src = data.image;
                thumb.alt = 'preview';
                thumb.style.cssText = `
                    width: 36px;
                    height: 36px;
                    object-fit: cover;
                    border-radius: 8px;
                    margin-right: 10px;
                    vertical-align: middle;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
                    border: 1px solid #eee;
                    background: #fff;
                    display: inline-block;
                `;
                indicator.prepend(thumb);
            }
            
            // Style the floating indicator
            indicator.style.cssText = `
                position: fixed;
                bottom: 90px;
                right: 40px;
                z-index: 2000;
                background: #4a4a8a;
                color: white;
                padding: 8px 16px 8px 8px;
                border-radius: 16px;
                font-size: 1rem;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                animation: fadeInUp 0.3s ease-out;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            `;
            
            // Add hover effects
            indicator.addEventListener('mouseenter', function() {
                this.style.background = '#6a6a9a';
                this.style.transform = 'scale(1.05)';
            });
            indicator.addEventListener('mouseleave', function() {
                this.style.background = '#4a4a8a';
                this.style.transform = 'scale(1)';
            });
            
            // Add click to remove functionality
            indicator.addEventListener('click', function() {
                currentImageData = null;
                messageInput.placeholder = "Type your message here...";
                messageInput.style.borderColor = "";
                messageInput.style.boxShadow = "";
                this.remove();
                addMessage('assistant', 'Image removed.');
            });
            
            messageInput.parentElement.appendChild(indicator);
        } else {
            addMessage('assistant', `Error uploading image: ${data.error}`, 'error');
            hideImageUpload();
        }
        document.getElementById('imageFile').value = '';
    })
    .catch(error => {
        clearTimeout(timeoutId); // Clear timeout on error
        console.error('Upload error:', error);
        
        // Remove loading state
        if (uploadBtn) {
            uploadBtn.classList.remove('loading');
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
        
        let errorMessage = 'Error uploading image';
        if (error.name === 'AbortError') {
            errorMessage = 'Upload timed out. Please try again with a smaller image.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        } else {
            errorMessage = `Error uploading image: ${error.message}`;
        }
        
        addMessage('assistant', errorMessage, 'error');
        hideImageUpload();
        document.getElementById('imageFile').value = '';
    });
}

function showImageGenerator() {
    hideAllSelectors();
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    const modal = document.getElementById('imageGeneratorModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

function hideImageGenerator() {
    console.log('hideImageGenerator called');
    const modal = document.getElementById('imageGeneratorModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function generateImage() {
    const prompt = document.getElementById('imagePrompt').value.trim();
    if (!prompt) {
        showAlert('Please enter a prompt');
        return;
    }
    
    // Add loading state to generate button - use a more reliable selector
    const generateBtn = document.querySelector('#imageGeneratorModal button[onclick="generateImage()"]');
    if (generateBtn) {
        generateBtn.classList.add('loading');
        generateBtn.disabled = true;
    }
    
    hideImageGenerator(); // Close the modal immediately
    // Show 'Generating image...' message
    addMessage('user', `Generate image: ${prompt}`);
    const thinkingDiv = addMessage('assistant', createGeneratingIndicator(), 'generating');
    fetchWithCode('/generate_image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            prompt: prompt,
            model: currentImageModel
        })
    })
    .then(response => response.json())
    .then(data => {
        // Remove loading state
        if (generateBtn) {
            generateBtn.classList.remove('loading');
            generateBtn.disabled = false;
        }
        
        // Remove the 'Generating image...' message
        if (thinkingDiv && thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
        if (data.error) {
            addMessage('assistant', `Error: ${data.error}`, 'error');
        } else {
            let imageMsg = 'Generated image:';
            if (data.image_url) {
                imageMsg += `<br><a href="${data.image_url}" target="_blank">View Image URL</a>`;
            }
            addMessage('assistant', imageMsg, 'normal', data.image);
        }
        document.getElementById('imagePrompt').value = '';
    })
    .catch(error => {
        // Remove loading state
        if (generateBtn) {
            generateBtn.classList.remove('loading');
            generateBtn.disabled = false;
        }
        
        if (thinkingDiv && thinkingDiv.parentNode) thinkingDiv.parentNode.removeChild(thinkingDiv);
        addMessage('assistant', `Error: ${error.message}`, 'error');
    });
}

function testClick() {
    console.log('testClick called');
    alert('Test click works! If you see this, clicking is working.');
    addMessage('assistant', 'Test click successful! Clicking is working properly.');
}

// Add a global callback for confirm modal
let confirmModalCallback = null;
function showConfirmModal(message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMessage').textContent = message;
    modal.style.display = 'flex';
    confirmModalCallback = onConfirm;
}
function hideConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    confirmModalCallback = null;
}
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('confirmYesBtn').onclick = function() {
        if (typeof confirmModalCallback === 'function') confirmModalCallback();
        hideConfirmModal();
    };
    document.getElementById('confirmNoBtn').onclick = function() {
        hideConfirmModal();
    };
});

// Replace alert with custom modal
function showAlert(message) {
    hideSidebarOnMobile();
    const modal = document.getElementById('alertModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
    document.getElementById('alertMessage').textContent = message;
}
function hideAlert() {
    const modal = document.getElementById('alertModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    if (window.innerWidth <= 700) {
        if (sidebar.classList.contains('open')) {
            overlay.style.display = 'block';
        } else {
            overlay.style.display = 'none';
        }
    } else {
        overlay.style.display = 'none';
    }
}

function getPremiumCode() {
    return localStorage.getItem('premium_code') || '';
}
function hasPremiumAccess() {
    return localStorage.getItem('premium_code_valid') === 'true';
}
function showCodeModal(errorMsg = '') {
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    const modal = document.getElementById('codeModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
    document.getElementById('codeError').textContent = errorMsg || '';
    document.getElementById('codeInput').value = getPremiumCode();
}
function hideCodeModal() {
    const modal = document.getElementById('codeModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}
function submitCode() {
    const code = document.getElementById('codeInput').value.trim();
    // Validate code with backend
    fetch('/validate_code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
    })
    .then(res => res.json().then(data => ({ status: res.status, data })))
    .then(({ status, data }) => {
        if (status === 200 && data.valid) {
            localStorage.setItem('premium_code', code);
            localStorage.setItem('premium_code_valid', 'true');
            hideCodeModal();
            window.location.reload();
        } else {
            localStorage.setItem('premium_code', '');
            localStorage.setItem('premium_code_valid', 'false');
            document.getElementById('codeError').textContent = 'Invalid code!';
            updateModelSelectors();
        }
    });
    updatePremiumIndicator();
}
function updateModelSelectors() {
    // Chat models
    document.querySelectorAll('.model-option').forEach(opt => {
        const val = opt.getAttribute('data-model-id');
        // Add Free label to all free models
        if (FREE_MODELS.includes(val)) {
            if (!opt.querySelector('.free-label')) {
                const label = document.createElement('span');
                label.className = 'free-label';
                label.textContent = 'Free';
                opt.appendChild(label);
            }
            // Remove premium-disabled class for free models
            opt.classList.remove('premium-disabled');
            const premiumLabel = opt.querySelector('.premium-label');
            if (premiumLabel) premiumLabel.remove();
        } else {
            const label = opt.querySelector('.free-label');
            if (label) label.remove();
        }
        if (PREMIUM_MODELS.includes(val) && !FREE_MODELS.includes(val)) {
            if (!hasPremiumAccess()) {
                opt.classList.add('premium-disabled');
                if (!opt.querySelector('.premium-label')) {
                    const label = document.createElement('span');
                    label.className = 'premium-label';
                    label.textContent = 'Premium';
                    opt.appendChild(label);
                }
            } else {
                opt.classList.remove('premium-disabled');
                const label = opt.querySelector('.premium-label');
                if (label) label.remove();
            }
        } else {
            opt.classList.remove('premium-disabled');
            const label = opt.querySelector('.premium-label');
            if (label) label.remove();
        }
    });
}
window.addEventListener('DOMContentLoaded', updateModelSelectors);

// Patch model selector click logic
function modelOptionClick(modelId, type) {
    if (PREMIUM_MODELS.includes(modelId) && !FREE_MODELS.includes(modelId) && !hasPremiumAccess()) {
        showCodeModal('Enter a valid premium code to use this model.');
        return;
    }
    selectModel(modelId, type);
}

function updatePremiumIndicator() {
    const indicator = document.getElementById('premiumIndicator');
    const enterCodeBtn = document.getElementById('enterCodeBtn');
    const indicatorMobile = document.getElementById('premiumIndicatorMobile');
    const enterCodeBtnMobile = document.getElementById('enterCodeBtnMobile');
    
    console.log('updatePremiumIndicator called');
    console.log('hasPremiumAccess():', hasPremiumAccess());
    console.log('indicator:', indicator);
    console.log('indicatorMobile:', indicatorMobile);
    
    if (hasPremiumAccess()) {
        console.log('Setting premium indicators to active');
        if (indicator) {
            indicator.classList.add('active');
            indicator.style.display = 'inline-flex';
        }
        if (indicatorMobile) {
            indicatorMobile.classList.add('active');
            indicatorMobile.style.display = 'inline-flex';
        }
        if (enterCodeBtn) enterCodeBtn.style.display = 'none';
        if (enterCodeBtnMobile) enterCodeBtnMobile.style.display = 'none';
    } else {
        console.log('Setting premium indicators to inactive - hiding them');
        if (indicator) {
            indicator.classList.remove('active');
            indicator.style.display = 'none';
        }
        if (indicatorMobile) {
            indicatorMobile.classList.remove('active');
            indicatorMobile.style.display = 'none';
        }
        if (enterCodeBtn) enterCodeBtn.style.display = 'inline-block';
        if (enterCodeBtnMobile) enterCodeBtnMobile.style.display = 'inline-block';
    }
}

// Call updatePremiumIndicator on page load and after DOM is ready
window.addEventListener('DOMContentLoaded', function() {
    console.log('DOMContentLoaded - updating premium indicator');
    updatePremiumIndicator();
    
    // Initialize scroll monitoring for user behavior tracking
    initScrollMonitoring();
    
    // Additional mobile-specific initialization
    if (window.innerWidth <= 700) {
        console.log('Mobile device detected - ensuring mobile premium indicator is properly initialized');
        const indicatorMobile = document.getElementById('premiumIndicatorMobile');
        const enterCodeBtnMobile = document.getElementById('enterCodeBtnMobile');
        
        if (indicatorMobile) {
            console.log('Mobile premium indicator found:', indicatorMobile);
        }
        if (enterCodeBtnMobile) {
            console.log('Mobile enter code button found:', enterCodeBtnMobile);
        }
    }
    
    var input = document.getElementById('messageInput');
    var chatMessages = document.getElementById('chatMessages');
    if (input && chatMessages) {
        input.addEventListener('focus', function() {
            setTimeout(function() {
                smoothScrollToBottom(chatMessages, true);
            }, 300);
        });
    }
    window.addEventListener('resize', function() {
        setTimeout(function() {
            if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 300);
    });
    
    // Handle viewport changes for mobile browser UI
    let lastViewportHeight = window.innerHeight;
    function handleViewportChange() {
        const currentHeight = window.innerHeight;
        if (Math.abs(currentHeight - lastViewportHeight) > 50) {
            // Significant height change (likely keyboard open/close)
            setTimeout(function() {
                if (chatMessages) {
                    smoothScrollToBottom(chatMessages, true);
                }
                // Force a reflow to ensure proper positioning
                document.body.style.height = '100dvh';
                setTimeout(function() {
                    document.body.style.height = '';
                }, 10);
            }, 100);
        }
        lastViewportHeight = currentHeight;
    }
    
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', function() {
        setTimeout(handleViewportChange, 500);
    });
});

window.addEventListener('load', function() {
    console.log('Window loaded - updating premium indicator');
    updatePremiumIndicator();
});

// Add resize listener to handle mobile premium indicator on screen size changes
window.addEventListener('resize', function() {
    if (window.innerWidth <= 700) {
        console.log('Screen resized to mobile - updating premium indicator');
        updatePremiumIndicator();
    }
});

function fetchWithCode(url, options = {}) {
    const code = getPremiumCode();
    if (!options.headers) options.headers = {};
    options.headers['X-Access-Code'] = code;
    return fetch(url, options);
}
function showBotInfoModal() {
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    const modal = document.getElementById('botInfoModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}
function hideBotInfoModal() {
    const modal = document.getElementById('botInfoModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
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

// Document upload functions
function showDocumentUpload() {
    if (!hasPremiumAccess()) {
        showAlert('Document upload is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }
    hideAllSelectors();
    hideSidebarOnMobile();
    const modal = document.getElementById('documentUploadModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

function hideDocumentUpload() {
    const modal = document.getElementById('documentUploadModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

function uploadDocument() {
    if (!hasPremiumAccess()) {
        showAlert('Document upload is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }
    const fileInput = document.getElementById('documentFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Please select a file first');
        return;
    }
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['.pdf', '.docx'];
    const fileName = file.name.toLowerCase();
    const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
    
    if (!allowedTypes.includes(file.type) && !hasValidExtension) {
        showAlert('Only PDF (.pdf) and Word (.docx) documents are supported.');
        fileInput.value = '';
        return;
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        showAlert('File size too large. Please select a document smaller than 10MB.');
        fileInput.value = '';
        return;
    }
    
    // Add loading state
    const uploadBtn = document.querySelector('#documentUploadModal button[onclick="uploadDocument()"]');
    if (uploadBtn) {
        uploadBtn.classList.add('loading');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }
    
    const formData = new FormData();
    formData.append('document', file);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for documents
    
    fetch('/upload_document', {
        method: 'POST',
        body: formData,
        signal: controller.signal
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        // Remove loading state
        if (uploadBtn) {
            uploadBtn.classList.remove('loading');
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
        
        if (data.success) {
            addMessage('assistant', data.message);
            hideDocumentUpload();
            
            // Update chat input styling to indicate document is ready
            const messageInput = document.getElementById('messageInput');
            messageInput.placeholder = "Ask me questions about the uploaded document...";
            messageInput.style.borderColor = "#28a745";
            messageInput.style.boxShadow = "0 0 10px rgba(40, 167, 69, 0.3)";
            
            // Remove any existing document indicator
            const existingIndicator = document.getElementById('documentIndicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
            
            // Add floating indicator
            const indicator = document.createElement('div');
            indicator.id = 'documentIndicator';
            indicator.innerHTML = `<i class="fas fa-file-alt"></i> <span class="doc-label">${data.filename} loaded (click to remove)</span>`;
            indicator.setAttribute('title', data.filename);
            
            // Style the floating indicator
            indicator.style.cssText = `
                position: fixed;
                bottom: 90px;
                right: 24px;
                z-index: 2000;
                background: #28a745;
                color: white;
                padding: 10px 14px;
                border-radius: 18px;
                font-size: 0.98rem;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                animation: fadeInUp 0.3s ease-out;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: all 0.2s;
                max-width: min(80vw, 600px);
            `;
            // Ensure long filenames don't overflow visually
            const labelEl = indicator.querySelector('.doc-label');
            if (labelEl) {
                labelEl.style.display = 'inline-block';
                labelEl.style.overflow = 'hidden';
                labelEl.style.textOverflow = 'ellipsis';
                labelEl.style.whiteSpace = 'nowrap';
                labelEl.style.maxWidth = 'calc(min(80vw, 600px) - 44px)'; // leave room for icon
            }
            
            // Add hover effects
            indicator.addEventListener('mouseenter', function() {
                this.style.background = '#34ce57';
                this.style.transform = 'scale(1.05)';
            });
            indicator.addEventListener('mouseleave', function() {
                this.style.background = '#28a745';
                this.style.transform = 'scale(1)';
            });
            
            // Add click to remove functionality
            indicator.addEventListener('click', function() {
                clearUploadedDocument();
            });
            
            messageInput.parentElement.appendChild(indicator);
        } else {
            addMessage('assistant', `Error uploading document: ${data.error}`, 'error');
            hideDocumentUpload();
        }
        document.getElementById('documentFile').value = '';
    })
    .catch(error => {
        clearTimeout(timeoutId);
        console.error('Upload error:', error);
        
        // Remove loading state
        if (uploadBtn) {
            uploadBtn.classList.remove('loading');
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
        }
        
        let errorMessage = 'Error uploading document';
        if (error.name === 'AbortError') {
            errorMessage = 'Upload timed out. Please try again with a smaller document.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        } else {
            errorMessage = `Error uploading document: ${error.message}`;
        }
        
        addMessage('assistant', errorMessage, 'error');
        hideDocumentUpload();
        document.getElementById('documentFile').value = '';
    });
}

function clearUploadedDocument() {
    // Reset input styling and remove document indicator
    const input = document.getElementById('messageInput');
    input.placeholder = "Type your message here...";
    input.style.borderColor = "";
    input.style.boxShadow = "";
    const indicator = document.getElementById('documentIndicator');
    if (indicator) {
        indicator.remove();
    }
    
    // Call backend to clear document
    fetch('/clear_document', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversation_id: window.currentConversationId || null })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            addMessage('assistant', 'Uploaded document cleared. You can upload a new document or continue chatting.');
        }
    })
    .catch(error => {
        console.error('Error clearing document:', error);
        addMessage('assistant', 'Document cleared locally.');
    });
}

// Add click handler to image indicator to clear it
function addImageIndicatorClickHandler() {
    document.addEventListener('click', function(e) {
        if (e.target.closest('#imageIndicator')) {
            clearUploadedImage();
        }
    });
}

// Initialize image indicator click handler
window.addEventListener('load', addImageIndicatorClickHandler);

// Add click handler to close sidebar when clicking outside on mobile
function addSidebarOverlayHandler() {
    document.addEventListener('click', function(e) {
        const sidebar = document.getElementById('sidebar');
        const topbarMobile = document.getElementById('topbarMobile');
        
        // If sidebar is open on mobile and click is outside sidebar and not on burger button
        if (sidebar && sidebar.classList.contains('open') && 
            window.innerWidth <= 700 && 
            !sidebar.contains(e.target) && 
            !e.target.closest('.burger-btn')) {
            sidebar.classList.remove('open');
        }
    });
}

// Initialize sidebar overlay handler
window.addEventListener('load', addSidebarOverlayHandler);

window.addEventListener('DOMContentLoaded', function() {
    var input = document.getElementById('messageInput');
    var chatMessages = document.getElementById('chatMessages');
    if (input && chatMessages) {
        input.addEventListener('focus', function() {
            setTimeout(function() {
                smoothScrollToBottom(chatMessages, true);
            }, 300);
        });
    }
    window.addEventListener('resize', function() {
        setTimeout(function() {
            if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 300);
    });
});

// Dark mode logic
function setDarkMode(enabled) {
    if (enabled) {
        document.body.classList.add('dark-mode');
        localStorage.setItem('darkMode', 'true');
        setDarkModeIcon(true);
    } else {
        document.body.classList.remove('dark-mode');
        localStorage.setItem('darkMode', 'false');
        setDarkModeIcon(false);
    }
}
function toggleDarkMode() {
    const enabled = !document.body.classList.contains('dark-mode');
    setDarkMode(enabled);
}

function logout() {
    if (confirm('Are you sure you want to logout? This will clear your session and you\'ll need to enter your premium code again if you have one.')) {
        // Clear all cookies
        document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'premium_code_hash=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        
        // Clear localStorage
        localStorage.removeItem('premium_code_valid');
        localStorage.removeItem('darkMode');
        
        // Reload the page to reset the session
        window.location.reload();
    }
}
function setDarkModeIcon(enabled) {
    const icon = enabled ? 'fa-sun' : 'fa-moon';
    const iconOff = enabled ? 'fa-moon' : 'fa-sun';
    const btn = document.getElementById('darkModeToggle');
    if (btn) {
        const i = btn.querySelector('i');
        if (i) {
            i.classList.remove(iconOff);
            i.classList.add(icon);
        }
    }
}
// On page load, apply saved mode
(function() {
    const dark = localStorage.getItem('darkMode') === 'true';
    setDarkMode(dark);
})();

function showConversationListModal() {
    fetch('/conversations')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('conversationListContainer');
            container.innerHTML = '';
            if (data.conversations && data.conversations.length > 0) {
                data.conversations.forEach(conv => {
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.marginBottom = '6px';

                    const btn = document.createElement('button');
                    btn.className = 'btn';
                    btn.style = 'flex:1 1 auto; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    btn.textContent = conv.title || conv.first_message || 'Conversation';
                    btn.onclick = () => {
                        switchConversation(conv.conversation_id);
                        hideConversationListModal();
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn';
                    delBtn.title = 'Delete conversation';
                    delBtn.style = 'margin-left:8px; color:#c00; background:none; border:none; font-size:1.1em; padding:4px 8px;';
                    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        showConfirmModal('Are you sure you want to delete this conversation?', function() {
                            fetch(`/conversations/${conv.conversation_id}`, {
                                method: 'DELETE',
                                credentials: 'include'
                            })
                            .then(response => response.json())
                            .then(result => {
                                if (result.success) {
                                    row.remove();
                                } else {
                                    showAlert('Failed to delete conversation: ' + (result.error || 'Unknown error'));
                                }
                            });
                        });
                    };

                    row.appendChild(btn);
                    row.appendChild(delBtn);
                    container.appendChild(row);
                });
            } else {
                container.innerHTML = '<div style="color:#888;text-align:center;">No conversations yet.</div>';
            }
        });
    document.getElementById('conversationListModal').style.display = 'flex';
}
function hideConversationListModal() {
    // Hide the conversation list modal
    const modal = document.getElementById('conversationListModal');
    modal.style.display = 'none';
    modal.style.opacity = '';
    modal.style.transition = '';

    // Hide all modal overlays (in case any are left open)
    document.querySelectorAll('.modal-overlay').forEach(function(el) {
        el.style.display = 'none';
        el.style.opacity = '';
        el.style.transition = '';
    });

    // Hide sidebar overlay if visible (for mobile)
    var sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
        sidebarOverlay.style.display = 'none';
    }
}
function createNewConversation() {
    showConfirmModal('Are you sure you want to create a new conversation?', function() {
        fetch('/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})
        })
        .then(response => response.json())
        .then(data => {
            if (data.conversation_id) {
                showConversationListModal();
                switchConversation(data.conversation_id);
                hideConversationListModal();
            }
        });
    });
}
function switchConversation(conversationId) {
    // Load messages for the selected conversation
    fetch(`/conversations/${conversationId}`)
        .then(response => response.json())
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
    window.currentConversationId = conversationId;
}

function enhanceAllAssistantMessagesWithCopy() {
    const assistantMessages = document.querySelectorAll('.message.assistant .message-content');
    assistantMessages.forEach(msgContent => {
        // Avoid double-enhancing
        if (msgContent.querySelector('.copy-btn-bar')) return;
        // Get the raw markdown from a data attribute if present, else try to reconstruct
        let rawMarkdown = msgContent.textContent || '';
        // Try to get the markdown from a hidden element if you store it, else fallback to textContent
        // Add copy code buttons to code blocks
        const codeBlocks = msgContent.querySelectorAll('pre > code');
        codeBlocks.forEach((codeBlock, idx) => {
            const pre = codeBlock.parentElement;
            if (pre.querySelector('.copy-code-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn btn';
            btn.title = 'Copy code';
            btn.innerHTML = '<i class="fas fa-copy"></i>';
            btn.onclick = function(e) {
                e.stopPropagation();
                navigator.clipboard.writeText(codeBlock.textContent);
                btn.classList.add('copied');
                setTimeout(() => { btn.classList.remove('copied'); }, 1200);
            };
            pre.style.position = 'relative';
            btn.style.position = 'absolute';
            btn.style.top = '8px';
            btn.style.right = '8px';
            btn.style.zIndex = '2';
            pre.appendChild(btn);
        });
        // Add copy markdown and plain text buttons at the bottom right
        const copyBtns = document.createElement('div');
        copyBtns.className = 'copy-btn-bar copy-btn-bar-bottom';
        const markdownBtn = document.createElement('button');
        markdownBtn.className = 'copy-markdown-btn btn';
        markdownBtn.title = 'Copy Markdown';
        markdownBtn.innerHTML = '<i class="fas fa-copy"></i>';
        const plainBtn = document.createElement('button');
        plainBtn.className = 'copy-plain-btn btn';
        plainBtn.title = 'Copy Plain Text';
        plainBtn.innerHTML = '<i class="fas fa-file-alt"></i>';
        copyBtns.appendChild(markdownBtn);
        copyBtns.appendChild(plainBtn);
        msgContent.appendChild(copyBtns);
        // Markdown copy: fallback to textContent if no raw markdown
        markdownBtn.onclick = function(e) {
            e.stopPropagation();
            navigator.clipboard.writeText(rawMarkdown);
            markdownBtn.classList.add('copied');
            setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
        };
        plainBtn.onclick = function(e) {
            e.stopPropagation();
            // Remove markdown formatting for plain text
            let plain = rawMarkdown
                .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''))
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                .replace(/\!\[(.*?)\]\(.*?\)/g, '')
                .replace(/#+\s/g, '')
                .replace(/\n{2,}/g, '\n')
                .replace(/^- /gm, '')
                .replace(/> /g, '')
                .replace(/\|/g, '');
            navigator.clipboard.writeText(plain);
            plainBtn.classList.add('copied');
            setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
        };
    });
}
// Call after history is loaded
window.addEventListener('load', () => {
    setTimeout(enhanceAllAssistantMessagesWithCopy, 500);
});
