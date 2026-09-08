/* Shared modal lifecycle, focus management, and HTML helpers. */
(function (global) {
    'use strict';

    const modalStack = [];
    const FOCUSABLE_SELECTOR = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[character]));
    }

    function safeClassNames(value) {
        return String(value || '').replace(/[^a-z0-9 _-]/gi, '').trim();
    }

    function row(label, value, labelTip, valueTip, valueClass) {
        const labelTitle = labelTip ? ` title="${escapeHtml(labelTip)}"` : '';
        const resolvedValueTip = valueTip == null || valueTip === '' ? value : valueTip;
        const valueTitle = ` title="${escapeHtml(resolvedValueTip)}"`;
        const extraClass = safeClassNames(valueClass);
        const className = extraClass ? ` ${extraClass}` : '';
        return `<div class="modal-row"><span class="modal-label"${labelTitle}>${escapeHtml(label)}</span><span class="modal-val${className}"${valueTitle}>${escapeHtml(value)}</span></div>`;
    }

    function summaryItem(label, value, title) {
        const resolvedTitle = title == null || title === '' ? value : title;
        return `<div class="modal-summary-item" title="${escapeHtml(resolvedTitle)}"><span class="modal-summary-label">${escapeHtml(label)}</span><span class="modal-summary-val">${escapeHtml(value)}</span></div>`;
    }

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
            if (typeof existing.__bpmClose === 'function') existing.__bpmClose(false);
            else existing.remove();
        }

        const returnFocus = document.activeElement;
        const overlay = document.createElement('div');
        const titleId = `${id}-title`;
        const widthStyle = maxWidth
            ? ` style="width:calc(100vw - 32px);max-width:${Number(maxWidth)}px"`
            : '';
        overlay.id = id;
        overlay.className = overlayClass;

        if (showHeader) {
            overlay.innerHTML = `<div class="${safeClassNames(boxClass)}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"${widthStyle}><div class="${safeClassNames(headerClass)}"><span class="${safeClassNames(titleClass)}" id="${titleId}">${escapeHtml(title)}</span><button type="button" class="${safeClassNames(closeClass)}" id="${closeId}" aria-label="Close ${escapeHtml(title)}">&times;</button></div><div class="${safeClassNames(bodyClass)}" id="${bodyId}">${initialHtml}</div></div>`;
        } else {
            overlay.innerHTML = `<div class="${safeClassNames(boxClass)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(ariaLabel || title)}"${widthStyle}>${contentHtml}</div>`;
        }

        document.body.appendChild(overlay);
        const dialogBox = overlay.firstElementChild;
        const body = showHeader ? overlay.querySelector(`#${bodyId}`) : overlay.firstElementChild;
        const abortController = typeof global.AbortController === 'function'
            ? new global.AbortController()
            : null;
        let closed = false;
        let controller;

        function close(restoreFocus = true) {
            if (closed) return;
            closed = true;
            if (abortController) abortController.abort();
            const stackIndex = modalStack.indexOf(controller);
            if (stackIndex !== -1) modalStack.splice(stackIndex, 1);
            document.removeEventListener('keydown', handleKeydown);
            overlay.remove();
            if (typeof onClose === 'function') onClose();
            if (
                restoreFocus &&
                returnFocus &&
                returnFocus.isConnected &&
                typeof returnFocus.focus === 'function'
            ) {
                returnFocus.focus({ preventScroll: true });
            }
        }

        function handleKeydown(event) {
            if (modalStack[modalStack.length - 1] !== controller) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(dialogBox.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
                element => element.getAttribute('aria-hidden') !== 'true'
            );
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
        overlay.__bpmClose = close;
        modalStack.push(controller);
        document.addEventListener('keydown', handleKeydown);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) close();
        });

        const closeButton = showHeader ? overlay.querySelector(`#${closeId}`) : null;
        if (closeButton) closeButton.addEventListener('click', () => close());
        const initialFocus = initialFocusSelector
            ? overlay.querySelector(initialFocusSelector)
            : closeButton;
        if (initialFocus && typeof initialFocus.focus === 'function') {
            initialFocus.focus({ preventScroll: true });
        }
        return controller;
    }

    function openFetched(options) {
        const modal = open(options);
        const api = options.api || global.BPMApi;
        api.getJson(options.url, { signal: modal.signal }).then(data => {
            if (modal.isOpen()) modal.body.innerHTML = options.render(data);
        }).catch(error => {
            if (error && error.name === 'AbortError') return;
            if (modal.isOpen()) {
                modal.body.innerHTML = `<div style="color:var(--err)">Error: ${escapeHtml(error.message)}</div>`;
            }
        });
        return modal;
    }

    global.BPMModal = Object.freeze({
        escapeHtml,
        row,
        summaryItem,
        open,
        openFetched,
    });
})(window);
