// Chat logic
import { getCachedElement, showAlert, showCodeModal, hideAllSelectors, hideSidebarOnMobile } from './ui.js';
import { fetchWithCode, cancelStream } from './api.js';
import { renderMath, convertSquareBracketMath, safeCopy, markdownToPlain, extractSources, linkifyReferences } from './utils.js';

let currentStreamReader = null;
let isStreaming = false;
let userScrolledUp = false;
let lastAutoScrollTime = 0;

export function getIsStreaming() {
    return isStreaming;
}

export function setIsStreaming(value) {
    isStreaming = value;
}

export function stopResponse() {
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
        cancelStream().catch(() => {
            // Silently handle cancellation error
        });

        // Add a message indicating the response was stopped
        addMessage('assistant', '<span style="color: #ff6b6b; font-style: italic;"><i class="fas fa-stop"></i> Response stopped by user.</span>', 'stopped');
    }
}

export function sendMessage(currentImageData, currentConversationId, setCurrentConversationIdCallback) {
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
        // Clear the current image data after sending - handled by caller or we return a flag?
        // We should return a flag or callback to clear it
    }
    // Include conversation_id if set
    if (currentConversationId) {
        requestData.conversation_id = currentConversationId;
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
            let fullThinking = '';
            let hasReceivedFirstChunk = false;
            let thinkingBlock = null;

            const reader = response.body.getReader();
            currentStreamReader = reader;
            const decoder = new TextDecoder();
            let lineBuffer = ''; // Buffer for incomplete lines across chunks

            function readStream() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        // Process any remaining buffered line
                        if (lineBuffer.trim().startsWith('data: ')) {
                            try {
                                const data = JSON.parse(lineBuffer.trim().slice(6));
                                if (data.conversation_id && !currentConversationId) {
                                    setCurrentConversationIdCallback(data.conversation_id);
                                }
                            } catch (e) {
                                console.warn('Failed to parse final buffered line:', e);
                            }
                        }

                        sendBtn.classList.remove('loading');
                        sendBtn.disabled = false;
                        sendBtn.style.display = 'flex';
                        stopBtn.style.display = 'none';
                        isStreaming = false;
                        userScrolledUp = false;
                        currentStreamReader = null;
                        setTimeout(enhanceAllAssistantMessagesWithCopy, 0);
                        return;
                    }

                    // Use {stream: true} to handle incomplete UTF-8 sequences at chunk boundaries
                    const chunk = decoder.decode(value, { stream: true });

                    // Prepend any buffered content from previous chunk
                    const fullChunk = lineBuffer + chunk;
                    const lines = fullChunk.split('\n');

                    // Keep the last line in buffer if it doesn't end with \n (incomplete)
                    // If chunk ends with \n, the last element after split will be empty string
                    lineBuffer = lines.pop() || '';

                    // Process complete lines only
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                if (data.conversation_id && !currentConversationId) {
                                    setCurrentConversationIdCallback(data.conversation_id);
                                }

                                if (data.error) {
                                    sendBtn.classList.remove('loading');
                                    sendBtn.disabled = false;
                                    sendBtn.style.display = 'flex';
                                    stopBtn.style.display = 'none';
                                    isStreaming = false;
                                    userScrolledUp = false;
                                    currentStreamReader = null;
                                    addMessage('assistant', `Error: ${data.error}`, 'error');
                                    return;
                                } else if (data.type === 'thinking' && data.chunk !== undefined) {
                                    // Handle thinking content separately
                                    if (!thinkingBlock) {
                                        // Create thinking section before main content
                                        thinkingBlock = document.createElement('div');
                                        thinkingBlock.className = 'thinking-block';

                                        const thinkingHeader = document.createElement('div');
                                        thinkingHeader.className = 'thinking-header';
                                        thinkingHeader.innerHTML = '<i class="fas fa-brain"></i> Thinking Process';

                                        const thinkingContent = document.createElement('div');
                                        thinkingContent.className = 'thinking-content';

                                        thinkingBlock.appendChild(thinkingHeader);
                                        thinkingBlock.appendChild(thinkingContent);

                                        assistantMessageDiv.querySelector('.message-content').prepend(thinkingBlock);
                                    }

                                    fullThinking += data.chunk;
                                    const thinkingContent = thinkingBlock.querySelector('.thinking-content');
                                    if (thinkingContent) {
                                        thinkingContent.textContent = fullThinking;
                                        smoothScrollToBottom(document.getElementById('chatMessages'), false);
                                    }
                                } else if (data.type === 'content' && data.chunk !== undefined) {
                                    // Handle regular content
                                    if (!hasReceivedFirstChunk) {
                                        hasReceivedFirstChunk = true;
                                    }

                                    fullResponse += data.chunk;
                                    const messageContent = assistantMessageDiv.querySelector('.message-content');

                                    if (messageContent) {
                                        if (window._parseTimeout) {
                                            cancelAnimationFrame(window._parseTimeout);
                                        }

                                        window._parseTimeout = requestAnimationFrame(() => {
                                            // Create or update the response div after thinking
                                            let responseDiv = messageContent.querySelector('.response-content');
                                            if (!responseDiv) {
                                                responseDiv = document.createElement('div');
                                                responseDiv.className = 'response-content';
                                                messageContent.appendChild(responseDiv);
                                            }
                                            responseDiv.innerHTML = marked.parse(convertSquareBracketMath(fullResponse));
                                            renderMath(responseDiv);
                                            smoothScrollToBottom(document.getElementById('chatMessages'), false);
                                        });
                                    }
                                } else if (data.type === 'done' && data.done) {
                                    if (data.conversation_id && !currentConversationId) {
                                        setCurrentConversationIdCallback(data.conversation_id);
                                    }

                                    if (window._parseTimeout) {
                                        cancelAnimationFrame(window._parseTimeout);
                                        window._parseTimeout = null;
                                    }

                                    const messageContent = assistantMessageDiv.querySelector('.message-content');
                                    if (messageContent && fullResponse) {
                                        let responseDiv = messageContent.querySelector('.response-content');
                                        if (!responseDiv) {
                                            responseDiv = document.createElement('div');
                                            responseDiv.className = 'response-content';
                                            messageContent.appendChild(responseDiv);
                                        }
                                        responseDiv.innerHTML = marked.parse(convertSquareBracketMath(fullResponse));
                                        renderMath(responseDiv);

                                        // Update the raw markdown data attribute for copy buttons
                                        assistantMessageDiv.setAttribute('data-raw-markdown', fullResponse);
                                    }

                                    sendBtn.classList.remove('loading');
                                    sendBtn.disabled = false;
                                    sendBtn.style.display = 'flex';
                                    stopBtn.style.display = 'none';
                                    isStreaming = false;
                                    userScrolledUp = false;
                                    currentStreamReader = null;

                                    const docInd2 = document.getElementById('documentIndicator');
                                    if (docInd2) {
                                        docInd2.remove();
                                        fetch('/clear_document', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ conversation_id: currentConversationId || null })
                                        }).catch(() => { });
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
                                                // Get raw markdown from the parent message element's data attribute
                                                const parentMessage = last.closest('.message');
                                                let rawMarkdown = parentMessage ? parentMessage.getAttribute('data-raw-markdown') : fullResponse;
                                                const codeBlocks = last.querySelectorAll('pre > code');
                                                codeBlocks.forEach((codeBlock, idx) => {
                                                    const pre = codeBlock.parentElement;
                                                    if (pre.querySelector('.copy-code-btn')) return;
                                                    const btn = document.createElement('button');
                                                    btn.className = 'copy-code-btn btn';
                                                    btn.title = 'Copy code';
                                                    btn.innerHTML = '<i class="fas fa-copy"></i>';
                                                    btn.onclick = function (e) {
                                                        e.stopPropagation();
                                                        safeCopy(codeBlock.textContent)
                                                            .then(() => {
                                                                btn.classList.add('copied');
                                                                setTimeout(() => { btn.classList.remove('copied'); }, 1200);
                                                            })
                                                            .catch(() => {
                                                                showAlert('Failed to copy code to clipboard. Please try manually.');
                                                            });
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
                                                markdownBtn.onclick = function (e) {
                                                    e.stopPropagation();
                                                    safeCopy(rawMarkdown)
                                                        .then(() => {
                                                            markdownBtn.classList.add('copied');
                                                            setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
                                                        })
                                                        .catch(() => {
                                                            showAlert('Failed to copy markdown to clipboard. Please try manually.');
                                                        });
                                                };
                                                plainBtn.onclick = function (e) {
                                                    e.stopPropagation();
                                                    const plain = markdownToPlain(rawMarkdown);
                                                    safeCopy(plain)
                                                        .then(() => {
                                                            plainBtn.classList.add('copied');
                                                            setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
                                                        })
                                                        .catch(() => {
                                                            showAlert('Failed to copy text to clipboard. Please try manually.');
                                                        });
                                                };
                                            }
                                        }
                                    }, 0);
                                    return;
                                }
                            } catch (e) {
                                // Skip lines with JSON parse errors (shouldn't happen with proper buffering)
                                console.warn('Failed to parse SSE line:', line, e);
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

export function addMessage(sender, content, type = 'normal', imageData = null) {
    const messagesContainer = getCachedElement('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;

    let messageContent = '';
    let rawMarkdown = content;

    if (sender === 'assistant' && type !== 'error' && type !== 'success') {
        // Remove <think> blocks if present
        let htmlContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
        rawMarkdown = htmlContent;
        // Preprocess model text that uses square brackets for math, then render
        rawMarkdown = convertSquareBracketMath(rawMarkdown);
        // Use marked library to render markdown
        htmlContent = marked.parse(rawMarkdown);

        // Render LaTeX math
        const tempMathDiv = document.createElement('div');
        tempMathDiv.innerHTML = htmlContent;
        renderMath(tempMathDiv);
        htmlContent = tempMathDiv.innerHTML;

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
            btn.onclick = function (e) {
                e.stopPropagation();
                safeCopy(codeBlock.textContent)
                    .then(() => {
                        btn.classList.add('copied');
                        setTimeout(() => { btn.classList.remove('copied'); }, 1200);
                    })
                    .catch(() => {
                        showAlert('Failed to copy code to clipboard. Please try manually.');
                    });
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
    // Store raw markdown on the element so enhanceAllAssistantMessagesWithCopy can use it
    if (sender === 'assistant') {
        try {
            messageDiv.setAttribute('data-raw-markdown', rawMarkdown || '');
        } catch (e) { /* ignore */ }
    }
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
            markdownBtn.onclick = function (e) {
                e.stopPropagation();
                // Get raw markdown from data attribute, fallback to local variable
                const markdownToCopy = messageDiv.getAttribute('data-raw-markdown') || rawMarkdown;
                safeCopy(markdownToCopy)
                    .then(() => {
                        markdownBtn.classList.add('copied');
                        setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
                    })
                    .catch(() => {
                        showAlert('Failed to copy markdown to clipboard. Please try manually.');
                    });
            };
        }
        if (plainBtn) {
            plainBtn.onclick = function (e) {
                e.stopPropagation();
                // Get raw markdown from data attribute, fallback to local variable
                const markdownToCopy = messageDiv.getAttribute('data-raw-markdown') || rawMarkdown;
                // Convert markdown to plain text safely
                const plain = markdownToPlain(markdownToCopy);
                safeCopy(plain)
                    .then(() => {
                        plainBtn.classList.add('copied');
                        setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
                    })
                    .catch(() => {
                        showAlert('Failed to copy text to clipboard. Please try manually.');
                    });
            };
        }
    }

    return messageDiv;
}

export function createThinkingIndicator() {
    return `<span style="color: #888; font-style: italic;"><i class="fas fa-brain"></i> Thinking...</span>`;
}

export function createGeneratingIndicator() {
    return `**Generating image**...`;
}

export function createTypingIndicator() {
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

export function isNearBottom(container, threshold = 50) {
    if (!container) return true;
    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    return (scrollHeight - scrollTop - clientHeight) <= threshold;
}

export function smoothScrollToBottom(container, forceScroll = false) {
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

export function initScrollMonitoring() {
    const chatMessages = document.getElementById('chatMessages');

    if (!chatMessages) return;

    let scrollTimeout;

    chatMessages.addEventListener('scroll', function (e) {
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

export function enhanceAllAssistantMessagesWithCopy() {
    const assistantMessages = document.querySelectorAll('.message.assistant .message-content');
    assistantMessages.forEach(msgContent => {
        // Avoid double-enhancing
        if (msgContent.querySelector('.copy-btn-bar')) return;
        // Get the raw markdown from a data attribute if present, else try to reconstruct
        let rawMarkdown = '';
        const parentMsg = msgContent.closest('.message');
        if (parentMsg && parentMsg.getAttribute('data-raw-markdown')) {
            rawMarkdown = parentMsg.getAttribute('data-raw-markdown');
        } else {
            rawMarkdown = msgContent.textContent || '';
        }
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
            btn.onclick = function (e) {
                e.stopPropagation();
                safeCopy(codeBlock.textContent)
                    .then(() => {
                        btn.classList.add('copied');
                        setTimeout(() => { btn.classList.remove('copied'); }, 1200);
                    })
                    .catch(() => {
                        showAlert('Failed to copy code to clipboard. Please try manually.');
                    });
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
        markdownBtn.onclick = function (e) {
            e.stopPropagation();
            safeCopy(rawMarkdown)
                .then(() => {
                    markdownBtn.classList.add('copied');
                    setTimeout(() => { markdownBtn.classList.remove('copied'); }, 1200);
                })
                .catch(() => {
                    showAlert('Failed to copy markdown to clipboard. Please try manually.');
                });
        };
        plainBtn.onclick = function (e) {
            e.stopPropagation();
            // Convert markdown to plain text safely
            const plain = markdownToPlain(rawMarkdown);
            safeCopy(plain)
                .then(() => {
                    plainBtn.classList.add('copied');
                    setTimeout(() => { plainBtn.classList.remove('copied'); }, 1200);
                })
                .catch(() => {
                    showAlert('Failed to copy text to clipboard. Please try manually.');
                });
        };
    });
}
