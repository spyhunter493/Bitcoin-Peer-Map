import { configureAdminAuthentication, requestJson, errorMessage, HttpError } from './api.js';
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
        let cooldownDeadline = 0;
        let rejectedToken = '';
        let verificationInFlight = false;
        /** @type {ReturnType<typeof setInterval> | null} */
        let countdown = null;
        const current = modal.open({
            id: 'admin-token-modal', title: 'Unlock management', maxWidth: 440,
            initialFocusSelector: '#admin-token-input',
            initialHtml: '<form id="admin-token-form"><p>Enter the admin token to allow management actions in this tab.</p><label for="admin-token-input">Admin token</label><input id="admin-token-input" class="connect-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="256"><div id="admin-token-error" class="connect-result err" role="alert"></div><div class="admin-token-actions"><button type="button" class="dialog-btn dialog-btn-cancel" id="admin-token-cancel">Cancel</button><button type="submit" class="connect-btn" id="admin-token-submit">Unlock</button></div></form>',
            onClose: () => {
                if (countdown !== null) clearInterval(countdown);
                rejectedToken = '';
                input.value = '';
                dialog = null;
                for (const waiter of waiters) { waiter.cleanup(); waiter.reject(cancelled()); }
                waiters.clear();
            },
        });
        dialog = current;
        /** @type {HTMLInputElement} */
        const input = required('#admin-token-input', current.body);
        /** @type {HTMLButtonElement} */
        const submit = required('#admin-token-submit', current.body);
        const error = required('#admin-token-error', current.body);
        function updateSubmission() {
            submit.disabled = verificationInFlight || !input.value || (Date.now() < cooldownDeadline && input.value === rejectedToken);
        }
        function updateCooldown() {
            const remaining = Math.max(0, Math.ceil((cooldownDeadline - Date.now()) / 1000));
            updateSubmission();
            error.textContent = remaining > 0 ? `Authentication cooldown. Try a different token now, or retry this token in ${remaining} seconds.` : 'Cooldown ended. You can verify your token now.';
            if (!remaining && countdown !== null) { clearInterval(countdown); countdown = null; }
        }
        input.addEventListener('input', updateSubmission);
        updateSubmission();
        required('#admin-token-cancel', current.body).addEventListener('click', () => current.close());
        required('#admin-token-form', current.body).addEventListener('submit', async event => {
            event.preventDefault();
            if (submit.disabled) return;
            verificationInFlight = true;
            updateSubmission();
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
                input.value = '';
                if (failure instanceof HttpError && failure.status === 429 && failure.data !== null && typeof failure.data === 'object' && 'code' in failure.data && failure.data.code === 'admin_rate_limited') {
                    cooldownDeadline = Date.now() + (failure.retryAfterSeconds ?? 60) * 1000;
                    rejectedToken = supplied;
                    updateCooldown();
                    if (countdown !== null) clearInterval(countdown);
                    if (Date.now() < cooldownDeadline) countdown = setInterval(updateCooldown, 1000);
                    else countdown = null;
                } else error.textContent = errorMessage(failure);
                input.focus();
            } finally {
                verificationInFlight = false;
                updateSubmission();
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
