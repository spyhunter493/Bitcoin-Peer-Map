import * as BPMApi from './api.js';
import { query, queryAll, required } from './dom.js';
/** @type {import('../types').ModalController[]} */
const modalStack = [];
const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** @param {HTMLElement} element */
function canFocus(element) {
    return !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
        element.getAttribute('aria-disabled') !== 'true' &&
        !element.matches(':disabled') && element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden';
}

function updateStack() {
    modalStack.forEach((modal, index) => {
        const top = index === modalStack.length - 1;
        modal.overlay.style.zIndex = String(10000 + index);
        modal.overlay.inert = !top;
        if (top) modal.overlay.removeAttribute('aria-hidden');
        else modal.overlay.setAttribute('aria-hidden', 'true');
    });
}

/** @param {HTMLElement} dialog */
function focusDialog(dialog) {
    const first = queryAll(FOCUSABLE_SELECTOR, dialog).find(canFocus);
    if (first) first.focus({ preventScroll: true });
    else {
        dialog.setAttribute('tabindex', '-1');
        dialog.focus({ preventScroll: true });
    }
}

/**
 * @param {unknown} value
 */
function escapeHtml(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character] || character
    );
}

/**
 * @param {unknown} value
 */
function safeClassNames(value) {
    return String(value || '')
        .replace(/[^a-z0-9 _-]/gi, '')
        .trim();
}

/**
 * @param {unknown} label
 * @param {unknown} value
 * @param {unknown} [labelTip]
 * @param {unknown} [valueTip]
 * @param {string} [valueClass]
 */
function row(label, value, labelTip, valueTip, valueClass) {
    const labelTitle = labelTip ? ` title="${escapeHtml(labelTip)}"` : '';
    const resolvedValueTip = valueTip == null || valueTip === '' ? value : valueTip;
    const valueTitle = ` title="${escapeHtml(resolvedValueTip)}"`;
    const extraClass = safeClassNames(valueClass);
    const className = extraClass ? ` ${extraClass}` : '';
    return `<div class="modal-row"><span class="modal-label"${labelTitle}>${escapeHtml(label)}</span><span class="modal-val${className}"${valueTitle}>${escapeHtml(value)}</span></div>`;
}

/**
 * @param {unknown} label
 * @param {unknown} value
 * @param {unknown} [title]
 */
function summaryItem(label, value, title) {
    const resolvedTitle = title == null || title === '' ? value : title;
    return `<div class="modal-summary-item" title="${escapeHtml(resolvedTitle)}"><span class="modal-summary-label">${escapeHtml(label)}</span><span class="modal-summary-val">${escapeHtml(value)}</span></div>`;
}

/**
 * @param {import('../types').ModalOptions} options
 */
function open(options) {
    const {
        id,
        title,
        maxWidth,
        closeId = `${id}-close`,
        bodyId = `${id}-body`,
        initialHtml = '<div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div>',
        overlayClass = 'modal-overlay',
        boxClass = 'modal-box',
        headerClass = 'modal-header',
        titleClass = 'modal-title',
        closeClass = 'modal-close',
        bodyClass = 'modal-body',
        showHeader = true,
        contentHtml = '',
        ariaLabel,
        initialFocusSelector,
        onClose,
    } = options;

    const existing = document.getElementById(id);
    if (existing) {
        const previous = modalStack.find((modal) => modal.overlay === existing);
        if (previous) previous.close(false);
        else existing.remove();
    }

    const returnFocus = document.activeElement;
    const overlay = document.createElement('div');
    const titleId = `${id}-title`;
    const widthStyle = ` style="width:calc(100vw - 32px)${maxWidth ? `;max-width:${Number(maxWidth)}px` : ''}"`;
    overlay.id = id;
    overlay.className = overlayClass;

    if (showHeader) {
        overlay.innerHTML = `<div class="${safeClassNames(boxClass)}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"${widthStyle}><div class="${safeClassNames(headerClass)}"><span class="${safeClassNames(titleClass)}" id="${titleId}">${escapeHtml(title)}</span><button type="button" class="${safeClassNames(closeClass)}" id="${closeId}" aria-label="Close ${escapeHtml(title)}">&times;</button></div><div class="${safeClassNames(bodyClass)}" id="${bodyId}">${initialHtml}</div></div>`;
    } else {
        overlay.innerHTML = `<div class="${safeClassNames(boxClass)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(ariaLabel || title)}"${widthStyle}>${contentHtml}</div>`;
    }

    document.body.appendChild(overlay);
    const dialogBox = required(':scope > :first-child', overlay);
    const body = showHeader ? required(`#${bodyId}`, overlay) : dialogBox;
    const abortController = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null;
    let closed = false;
    /** @type {import('../types').ModalController} */
    let controller;

    function close(restoreFocus = true) {
        if (closed) return;
        closed = true;
        if (abortController) abortController.abort();
        const stackIndex = modalStack.indexOf(controller);
        const wasTop = stackIndex === modalStack.length - 1;
        if (stackIndex !== -1) modalStack.splice(stackIndex, 1);
        document.removeEventListener('keydown', handleKeydown, true);
        document.removeEventListener('focusin', handleFocusin);
        overlay.remove();
        updateStack();
        if (typeof onClose === 'function') onClose();
        const top = modalStack[modalStack.length - 1];
        if (restoreFocus && wasTop && returnFocus instanceof HTMLElement && returnFocus.isConnected && canFocus(returnFocus) &&
            (!top || top.overlay.contains(returnFocus))) {
            returnFocus.focus({ preventScroll: true });
        } else if (wasTop && top) {
            focusDialog(required(':scope > :first-child', top.overlay));
        }
        // A cancelled request may re-enable its source button in a microtask.
        // Restore it after that cleanup, provided focus and the stack still agree.
        if (restoreFocus && wasTop && returnFocus instanceof HTMLElement && returnFocus.isConnected &&
            (!top || top.overlay.contains(returnFocus)) && !canFocus(returnFocus)) {
            const fallbackFocus = document.activeElement;
            requestAnimationFrame(() => {
                if (modalStack[modalStack.length - 1] === top && document.activeElement === fallbackFocus && canFocus(returnFocus)) {
                    returnFocus.focus({ preventScroll: true });
                }
            });
        }
    }

    /** @param {FocusEvent} event */
    function handleFocusin(event) {
        if (modalStack[modalStack.length - 1] !== controller || dialogBox.contains(/** @type {Node} */ (event.target))) return;
        focusDialog(dialogBox);
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleKeydown(event) {
        if (modalStack[modalStack.length - 1] !== controller) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = queryAll(FOCUSABLE_SELECTOR, dialogBox).filter(canFocus);
        if (!focusable.length) {
            event.preventDefault();
            dialogBox.setAttribute('tabindex', '-1');
            dialogBox.focus({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogBox.contains(document.activeElement))) {
            event.preventDefault();
            last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (document.activeElement === last || !dialogBox.contains(document.activeElement))) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    }

    controller = {
        overlay,
        body,
        signal: abortController ? abortController.signal : undefined,
        close,
        isOpen: () => !closed && overlay.isConnected,
    };
    modalStack.push(controller);
    updateStack();
    document.addEventListener('keydown', handleKeydown, true);
    document.addEventListener('focusin', handleFocusin);
    overlay.addEventListener('click', (event) => {
        if (modalStack[modalStack.length - 1] === controller && event.target === overlay) close();
    });

    const closeButton = showHeader ? query(`#${closeId}`, overlay) : null;
    if (closeButton) closeButton.addEventListener('click', () => close());
    const initialFocus = initialFocusSelector ? query(initialFocusSelector, overlay) : closeButton;
    if (initialFocus && canFocus(initialFocus)) {
        initialFocus.focus({ preventScroll: true });
    } else focusDialog(dialogBox);
    return controller;
}

/**
 * @template T
 * @param {import('../types').ModalOptions & {url: string; render: (data: T) => string; api?: {getJson(url: string, options: RequestInit): Promise<T>}}} options
 */
function openFetched(options) {
    const modal = open(options);
    const api = options.api || BPMApi;
    /** @type {Promise<T>} */
    const request = api.getJson(options.url, { signal: modal.signal });
    request
        .then((data) => {
            if (modal.isOpen()) modal.body.innerHTML = options.render(data);
        })
        .catch((error) => {
            if (error && error.name === 'AbortError') return;
            if (modal.isOpen()) {
                modal.body.innerHTML = `<div style="color:var(--err)">Error: ${escapeHtml(error.message)}</div>`;
            }
        });
    return modal;
}

export { escapeHtml };
export { row };
export { summaryItem };
export { open };
export { openFetched };
