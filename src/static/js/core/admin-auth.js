import { configureAdminAuthentication, requestJson, errorMessage } from './api.js';
import * as modal from './modal.js';
import { required } from './dom.js';

/** @typedef {{resolve: (token: string) => void; reject: (error: Error) => void; cleanup: () => void}} Waiter */

export function create() {
    let token = '';
    /** @type {import('../types').ModalController | null} */
    let dialog = null;
    /** @type {Set<Waiter>} */
    const waiters = new Set();
    /** @type {HTMLButtonElement | null} */
    let lockButton = null;

    function clearToken() {
        token = '';
        if (lockButton) lockButton.hidden = true;
    }

    function cancelled() {
        return new DOMException('Management action cancelled.', 'AbortError');
    }

    function lock() {
        clearToken();
        dialog?.close();
    }

    function openPrompt() {
        if (dialog) return;
        const returnFocus = document.activeElement;
        const current = modal.open({
            id: 'admin-token-modal', title: 'Unlock management', maxWidth: 440,
            initialFocusSelector: '#admin-token-input',
            initialHtml: '<form id="admin-token-form"><p>Enter the admin token to allow management actions in this tab.</p><label for="admin-token-input">Admin token</label><input id="admin-token-input" class="connect-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="256"><div id="admin-token-error" class="connect-result err" role="alert"></div><div class="admin-token-actions"><button type="button" class="dialog-btn dialog-btn-cancel" id="admin-token-cancel">Cancel</button><button type="submit" class="connect-btn" id="admin-token-submit">Unlock</button></div></form>',
            onClose: () => {
                dialog = null;
                for (const waiter of waiters) { waiter.cleanup(); waiter.reject(cancelled()); }
                waiters.clear();
                // Source controls are re-enabled by their cancelled request handlers.
                requestAnimationFrame(() => {
                    if (document.activeElement === document.body && returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
                });
            },
        });
        dialog = current;
        /** @type {HTMLInputElement} */
        const input = required('#admin-token-input', current.body);
        /** @type {HTMLButtonElement} */
        const submit = required('#admin-token-submit', current.body);
        const error = required('#admin-token-error', current.body);
        required('#admin-token-cancel', current.body).addEventListener('click', () => current.close());
        required('#admin-token-form', current.body).addEventListener('submit', async event => {
            event.preventDefault();
            if (submit.disabled) return;
            submit.disabled = true;
            error.textContent = '';
            const supplied = input.value;
            try {
                await requestJson('/api/admin/verify', { method: 'POST', headers: { Authorization: `Bearer ${supplied}` }, signal: current.signal });
                if (!current.isOpen()) return;
                token = supplied;
                input.value = '';
                if (lockButton) lockButton.hidden = false;
                for (const waiter of waiters) { waiter.cleanup(); waiter.resolve(token); }
                waiters.clear();
                current.close();
            } catch (failure) {
                if (!current.isOpen()) return;
                error.textContent = errorMessage(failure);
                input.value = '';
                input.focus();
            } finally {
                submit.disabled = false;
            }
        });
    }

    /** @param {AbortSignal} [signal] @returns {Promise<string>} */
    function requestToken(signal) {
        if (signal?.aborted) return Promise.reject(cancelled());
        if (token) return Promise.resolve(token);
        return new Promise((resolve, reject) => {
            /** @type {Waiter} */
            const waiter = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
            function abort() {
                waiters.delete(waiter);
                waiter.cleanup();
                reject(cancelled());
                if (!waiters.size) dialog?.close();
            }
            waiters.add(waiter);
            signal?.addEventListener('abort', abort, { once: true });
            openPrompt();
        });
    }

    function init() {
        lockButton = required('#admin-lock');
        lockButton.addEventListener('click', lock);
        globalThis.addEventListener('pagehide', lock);
        configureAdminAuthentication({ getToken: () => token, clearToken, requestToken });
    }

    return Object.freeze({ init, lock });
}
