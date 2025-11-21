// UI interaction logic
import { hasPremiumAccess, getPremiumCode, submitCode, fetchConversations, deleteConversation, createConversation } from './api.js';

// Performance optimizations: Cache DOM elements to avoid repeated queries
const cachedElements = {};
export function getCachedElement(id) {
    if (!cachedElements[id]) {
        cachedElements[id] = document.getElementById(id);
    }
    return cachedElements[id];
}

export function hideAllSelectors() {
    const chatModal = getCachedElement('chatModelModal');
    const imageModal = getCachedElement('imageModelModal');
    const uploadModal = getCachedElement('imageUploadModal');
    const genModal = getCachedElement('imageGeneratorModal');
    const docModal = getCachedElement('documentUploadModal');

    // Batch DOM updates for better performance
    if (chatModal) chatModal.style.display = 'none';
    if (imageModal) imageModal.style.display = 'none';
    if (uploadModal) uploadModal.style.display = 'none';
    if (genModal) genModal.style.display = 'none';
    if (docModal) docModal.style.display = 'none';
}

// Helper function to hide sidebar on mobile when modals are opened
export function hideSidebarOnMobile() {
    const sidebar = getCachedElement('sidebar');
    const overlay = getCachedElement('sidebarOverlay');
    if (sidebar && window.innerWidth <= 700) {
        sidebar.classList.remove('open');
        if (overlay) overlay.style.display = 'none';
    }
}

export function showModelSelector(type) {
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
    } else if (type === 'image') {
        const modal = document.getElementById('imageModelModal');
        modal.style.display = 'flex';
        modal.style.opacity = '0';
        setTimeout(() => {
            modal.style.transition = 'opacity 0.2s ease-out';
            modal.style.opacity = '1';
        }, 10);
    }
}

export function hideModelSelector(type) {
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

export function showImageUpload() {
    hideAllSelectors();
    hideSidebarOnMobile();
    const modal = document.getElementById('imageUploadModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

export function hideImageUpload() {
    const modal = document.getElementById('imageUploadModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function showImageGenerator() {
    hideAllSelectors();
    hideSidebarOnMobile();
    const modal = document.getElementById('imageGeneratorModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

export function hideImageGenerator() {
    const modal = document.getElementById('imageGeneratorModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function showDocumentUpload() {
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

export function hideDocumentUpload() {
    const modal = document.getElementById('documentUploadModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function updateModelSelectors(PREMIUM_MODELS, FREE_MODELS) {
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

export function updatePremiumIndicator() {
    const indicator = document.getElementById('premiumIndicator');
    const enterCodeBtn = document.getElementById('enterCodeBtn');
    const indicatorMobile = document.getElementById('premiumIndicatorMobile');
    const enterCodeBtnMobile = document.getElementById('enterCodeBtnMobile');

    if (hasPremiumAccess()) {
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

export function showCodeModal(errorMsg = '') {
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

export function hideCodeModal() {
    const modal = document.getElementById('codeModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function showAlert(message) {
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

export function hideAlert() {
    const modal = document.getElementById('alertModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Add a global callback for confirm modal
let confirmModalCallback = null;
export function showConfirmModal(message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMessage').textContent = message;
    modal.style.display = 'flex';
    confirmModalCallback = onConfirm;
}

export function hideConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    confirmModalCallback = null;
}

export function initConfirmModal() {
    document.getElementById('confirmYesBtn').onclick = function () {
        if (typeof confirmModalCallback === 'function') confirmModalCallback();
        hideConfirmModal();
    };
    document.getElementById('confirmNoBtn').onclick = function () {
        hideConfirmModal();
    };
}

export function showBotInfoModal() {
    hideSidebarOnMobile(); // Hide sidebar on mobile when modal opens
    const modal = document.getElementById('botInfoModal');
    modal.style.display = 'flex';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        modal.style.opacity = '1';
    }, 10);
}

export function hideBotInfoModal() {
    const modal = document.getElementById('botInfoModal');
    modal.style.transition = 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    modal.style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

export function toggleSidebar() {
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

export function setDarkMode(enabled) {
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

export function toggleDarkMode() {
    const enabled = !document.body.classList.contains('dark-mode');
    setDarkMode(enabled);
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

export function addMicroInteractions() {
    // Add ripple effect to buttons
    document.addEventListener('click', function (e) {
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

export function showConversationListModal(switchConversationCallback) {
    fetchConversations()
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
                        switchConversationCallback(conv.conversation_id);
                        hideConversationListModal();
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn';
                    delBtn.title = 'Delete conversation';
                    delBtn.style = 'margin-left:8px; color:#c00; background:none; border:none; font-size:1.1em; padding:4px 8px;';
                    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        showConfirmModal('Are you sure you want to delete this conversation?', function () {
                            deleteConversation(conv.conversation_id)
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

export function hideConversationListModal() {
    // Hide the conversation list modal
    const modal = document.getElementById('conversationListModal');
    modal.style.display = 'none';
    modal.style.opacity = '';
    modal.style.transition = '';

    // Hide all modal overlays (in case any are left open)
    document.querySelectorAll('.modal-overlay').forEach(function (el) {
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
