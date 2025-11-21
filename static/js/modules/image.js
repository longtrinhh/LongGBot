// Image and document handling logic
import { showCodeModal, showAlert, hideAllSelectors, hideSidebarOnMobile, getCachedElement, hideImageUpload, hideImageGenerator, hideDocumentUpload } from './ui.js';
import { addMessage, createGeneratingIndicator, smoothScrollToBottom } from './chat.js';
import { fetchWithCode, hasPremiumAccess } from './api.js';

export function uploadImage(currentImageDataCallback) {
    if (!hasPremiumAccess()) {
        showAlert('Image upload is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }
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
                currentImageDataCallback(data.image);
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
                indicator.addEventListener('mouseenter', function () {
                    this.style.background = '#6a6a9a';
                    this.style.transform = 'scale(1.05)';
                });
                indicator.addEventListener('mouseleave', function () {
                    this.style.background = '#4a4a8a';
                    this.style.transform = 'scale(1)';
                });

                // Add click to remove functionality
                indicator.addEventListener('click', function () {
                    currentImageDataCallback(null);
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

export function generateImage(currentImageModel) {
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

export function uploadDocument(currentConversationId) {
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
                indicator.addEventListener('mouseenter', function () {
                    this.style.background = '#34ce57';
                    this.style.transform = 'scale(1.05)';
                });
                indicator.addEventListener('mouseleave', function () {
                    this.style.background = '#28a745';
                    this.style.transform = 'scale(1)';
                });

                // Add click to remove functionality
                indicator.addEventListener('click', function () {
                    clearUploadedDocument(currentConversationId);
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

export function clearUploadedDocument(currentConversationId) {
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
        body: JSON.stringify({ conversation_id: currentConversationId || null })
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

export function handlePaste(event, currentImageDataCallback) {
    // Get clipboard data
    const clipboardData = event.clipboardData || event.originalEvent?.clipboardData;
    if (!clipboardData || !clipboardData.items) {
        // No clipboard data or items, allow default text paste
        return;
    }

    const items = clipboardData.items;

    // First check if there's actually an image in the clipboard
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') !== -1) {
            hasImage = true;
            break;
        }
    }

    // If no image, allow normal text paste
    if (!hasImage) {
        return;
    }

    // Only prevent default and check premium for images
    event.preventDefault();

    // Premium gate for paste-upload (only for images)
    if (!hasPremiumAccess()) {
        showAlert('Pasting images is a premium feature. Enter a premium code to unlock.');
        showCodeModal();
        return;
    }

    // Process the image
    for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') !== -1) {
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
                            currentImageDataCallback(data.image);

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
                            indicator.addEventListener('mouseenter', function () {
                                this.style.background = '#6a6a9a';
                                this.style.transform = 'scale(1.05)';
                            });
                            indicator.addEventListener('mouseleave', function () {
                                this.style.background = '#4a4a8a';
                                this.style.transform = 'scale(1)';
                            });

                            // Add click to remove functionality
                            indicator.addEventListener('click', function () {
                                currentImageDataCallback(null);
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
