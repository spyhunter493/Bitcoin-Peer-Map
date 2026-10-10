import { configureAdminAuthentication, requestJson, errorMessage, HttpError } from './api.js';
import * as modal from './modal.js';
import { required } from './dom.js';

/** @typedef {{resolve: (token: string) => void; reject: (error: Error) => void; cleanup: () => void}} Waiter */

export function create() {
    let token = '';
    let authenticated = false, revision = 0;
    /** @type {Promise<void> | null} */
    let locking = null;
    /** @type {Error | null} */
    let lockFailure = null;
    /** @type {import('../types').ModalController | null} */
    let dialog = null;
    /** @type {((deadline: number) => void) | null} */
    let updatePromptCooldown = null;
    /** @type {Set<Waiter>} */
    const waiters = new Set();
    /** @type {HTMLButtonElement | null} */
    let lockButton = null;

    function clearToken() {
        token = '';
        authenticated = false;
        revision++;
        if (lockButton) lockButton.hidden = true;
    }

    function cancelled() {
        return new DOMException('Management action cancelled.', 'AbortError');
    }

    function reset() {
        clearToken();
        dialog?.close();
    }

    async function lock() {
        if (locking) return locking;
        reset();
        lockFailure = null;
        if (lockButton) {
            lockButton.hidden = false;
            lockButton.disabled = true;
            lockButton.textContent = 'Locking…';
        }
        locking = (async () => {
            try {
                await requestJson('/api/admin/logout', { method: 'POST' }, 10000);
                if (lockButton) lockButton.hidden = true;
            } catch (failure) {
                lockFailure = new Error('Management could not be locked. Retry locking before using management actions.');
                if (lockButton) {
                    lockButton.hidden = false;
                    lockButton.title = errorMessage(failure);
                    lockButton.textContent = 'Retry lock';
                }
            } finally {
                if (lockButton) {
                    lockButton.disabled = false;
                    if (!lockFailure) { lockButton.textContent = 'Lock'; lockButton.title = 'Sign out of management in this browser'; }
                }
                locking = null;
            }
        })();
        return locking;
    }

    async function beforeRequest() {
        if (locking) await locking;
        if (lockFailure) throw lockFailure;
    }

    /** @param {boolean} restored */
    function restore(restored) {
        if (locking || lockFailure) return;
        token = '';
        authenticated = restored;
        revision++;
        if (lockButton) lockButton.hidden = !restored;
    }

    function openPrompt(initialCooldownDeadline = 0) {
        if (dialog) {
            if (initialCooldownDeadline > Date.now()) updatePromptCooldown?.(initialCooldownDeadline);
            return;
        }
        let cooldownDeadline = 0;
        let rejectedToken = '';
        let verificationInFlight = false;
        /** @type {ReturnType<typeof setInterval> | null} */
        let countdown = null;
        const current = modal.open({
            id: 'admin-token-modal', title: 'Unlock management', maxWidth: 440,
            initialFocusSelector: '#admin-token-input',
            initialHtml: '<form id="admin-token-form"><p>Enter the admin token to allow management actions. This browser remembers access for 30 days, or until you lock management.</p><label for="admin-token-input">Admin token</label><input id="admin-token-input" class="connect-input" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="256"><div id="admin-token-error" class="connect-result err" role="alert"></div><div class="admin-token-actions"><button type="button" class="dialog-btn dialog-btn-cancel" id="admin-token-cancel">Cancel</button><button type="submit" class="connect-btn" id="admin-token-submit">Unlock</button></div></form>',
            onClose: () => {
                if (countdown !== null) clearInterval(countdown);
                rejectedToken = '';
                input.value = '';
                updatePromptCooldown = null;
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
            error.textContent = remaining > 0 ? rejectedToken
                ? `Authentication cooldown. Try a different token now, or retry this token in ${remaining} seconds.`
                : `Authentication cooldown. You can verify a token now (${remaining} seconds remaining).`
                : 'Cooldown ended. You can verify your token now.';
            if (!remaining && countdown !== null) { clearInterval(countdown); countdown = null; }
        }
        /** @param {number} deadline */
        function setCooldown(deadline) {
            cooldownDeadline = deadline;
            updateCooldown();
            if (Date.now() < cooldownDeadline && countdown === null) countdown = setInterval(updateCooldown, 1000);
        }
        // Merge pending-action hints; verification responses supply the current deadline.
        updatePromptCooldown = deadline => setCooldown(Math.max(cooldownDeadline, deadline));
        input.addEventListener('input', updateSubmission);
        updateSubmission();
        if (initialCooldownDeadline > Date.now()) setCooldown(initialCooldownDeadline);
        required('#admin-token-cancel', current.body).addEventListener('click', () => current.close());
        required('#admin-token-form', current.body).addEventListener('submit', async event => {
            event.preventDefault();
            if (submit.disabled) return;
            verificationInFlight = true;
            updateSubmission();
            error.textContent = '';
            const supplied = input.value;
            try {
                /** @type {{success: boolean, remembered?: boolean}} */
                const verified = await requestJson('/api/admin/verify', { method: 'POST', headers: { Authorization: `Bearer ${supplied}`, 'X-BPM-Remember': '1' }, signal: current.signal });
                if (!current.isOpen()) return;
                token = verified.remembered ? '' : supplied;
                authenticated = true;
                revision++;
                input.value = '';
                if (lockButton) lockButton.hidden = false;
                for (const waiter of waiters) { waiter.cleanup(); waiter.resolve(token); }
                waiters.clear();
                current.close();
            } catch (failure) {
                if (!current.isOpen()) return;
                input.value = '';
                if (failure instanceof HttpError && failure.status === 429 && failure.data !== null && typeof failure.data === 'object' && 'code' in failure.data && failure.data.code === 'admin_rate_limited') {
                    rejectedToken = supplied;
                    setCooldown(Date.now() + (failure.retryAfterSeconds ?? 60) * 1000);
                } else error.textContent = errorMessage(failure);
                input.focus();
            } finally {
                verificationInFlight = false;
                updateSubmission();
            }
        });
    }

    /** @param {AbortSignal} [signal] @param {number} [cooldownDeadline] @returns {Promise<string>} */
    function requestToken(signal, cooldownDeadline) {
        if (signal?.aborted) return Promise.reject(cancelled());
        if (lockFailure) return Promise.reject(lockFailure);
        if (authenticated) return Promise.resolve(token);
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
            openPrompt(cooldownDeadline);
        });
    }

    function init() {
        lockButton = required('#admin-lock');
        lockButton.addEventListener('click', () => { void lock(); });
        globalThis.addEventListener('pagehide', reset);
        globalThis.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            const current = revision;
            void requestJson('/api/access', { cache: 'no-store' }).then(access => {
                if (revision === current && access && typeof access.management_authenticated === 'boolean') restore(access.management_authenticated);
            }).catch(() => {});
        });
        configureAdminAuthentication({ getToken: () => token, isAuthenticated: () => authenticated, getRevision: () => revision,
            beforeRequest, clearToken, requestToken });
    }

    return Object.freeze({ init, lock, reset, restore });
}
