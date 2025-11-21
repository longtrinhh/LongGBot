// Utility functions

// Debounce function for performance
export function debounce(func, wait) {
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

// Throttle function for high-frequency events (better than debounce for scrolling)
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Helper function to render LaTeX math in an element
export function renderMath(element) {
    if (typeof renderMathInElement !== 'undefined') {
        try {
            renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false }
                ],
                throwOnError: false,
                strict: false
            });
        } catch (e) {
            console.warn('Math rendering error:', e);
        }
    } else {
        console.warn('renderMathInElement not available yet, retrying in 100ms');
        setTimeout(() => renderMath(element), 100);
    }
}

// Normalize square-bracket math produced by some models like: [ E = mc^2 ]
export function convertSquareBracketMath(md) {
    if (!md || typeof md !== 'string') return md;

    return md.replace(/\[\s*([\s\S]*?)\s*\]/g, (match, inner) => {
        // If it already appears to be proper TeX or markdown math, leave it
        if (/^\$.*\$/.test(inner) || /^\\\[/.test(inner) || /^\\\(/.test(inner) || /\$\$/.test(inner)) {
            return match;
        }

        // Heuristic: treat as math if it contains backslash (TeX), common TeX commands,
        // math operators, or superscript/subscript markers.
        const looksLikeMath = /\\|\\times|\\log|\\approx|\\frac|\\text|\^|_|=|\\left|\\right|\bpi\b/.test(inner) || /[0-9]+\s*[+\-\/*^=]/.test(inner);
        if (looksLikeMath) {
            return '\\[' + inner + '\\]';
        }
        return match;
    });
}

// Safe copy helper: use clipboard API and fallback to execCommand
export function safeCopy(text) {
    return new Promise((resolve, reject) => {
        if (!text) {
            reject(new Error('No text to copy'));
            return;
        }

        // Prefer modern clipboard API
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(resolve).catch(() => {
                // Fallback to older method
                fallbackCopy(text, resolve, reject);
            });
            return;
        }

        // Fallback for very old browsers
        fallbackCopy(text, resolve, reject);
    });
}

function fallbackCopy(text, resolve, reject) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        const selected = document.getSelection().rangeCount > 0 ? document.getSelection().getRangeAt(0) : null;
        ta.select();
        if (document.execCommand('copy')) {
            document.body.removeChild(ta);
            if (selected) {
                document.getSelection().removeAllRanges();
                document.getSelection().addRange(selected);
            }
            resolve();
        } else {
            document.body.removeChild(ta);
            reject(new Error('execCommand copy failed'));
        }
    } catch (e) {
        reject(e);
    }
}

// Convert markdown to plain text by rendering to HTML and extracting textContent
export function markdownToPlain(md) {
    try {
        const html = marked.parse(md || '');
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        // Use textContent to preserve spacing and punctuation
        return (tmp.textContent || tmp.innerText || '').trim();
    } catch (e) {
        // Fallback: naive regex stripping (best-effort)
        try {
            return (md || '')
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
                .replace(/\|/g, '')
                .trim();
        } catch (e2) {
            return (md || '').trim();
        }
    }
}

export function markdownTableToHtml(md) {
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

export function extractSources(md) {
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

export function linkifyReferences(md, sources) {
    // Replace [1], [2], ... with links if mapping exists
    return md.replace(/\[(\d+)\]/g, (m, n) => {
        if (sources[n]) return `<a href="${sources[n]}" target="_blank">[${n}]</a>`;
        return m;
    });
}
