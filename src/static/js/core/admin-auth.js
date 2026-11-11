import { configureAdminAuthentication, requestJson, errorMessage, HttpError } from './api.js';
import * as modal from './modal.js';
import { required } from './dom.js';

/** @typedef {{resolve: (token: string) => void; reject: (error: Error) => void; cleanup: () => void}} Waiter */

export function create() {
    let token = '';
    let authenticated = false, available = false, revision = 0;
    let suspended = false;
    let access = new AbortController();
    access.abort();
    /** @type {Set<(state: import('../types').ManagementState) => void>} */
    const listeners = new Set();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let expiryTimer = null;
    /** @type {Promise<boolean> | null} */
    let validating = null;
    let validatingRevision = -1;
    /** @type {BroadcastChannel | null} */
    let channel = null;
    let remoteLockPending = false;
    const eventKey = 'bpm.management-event';
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

    /** @returns {import('../types').ManagementState} */
    function getState() {
        return Object.freeze({ authenticated, suspended, available, revision, signal: access.signal });
    }

    function publish() {
        const state = getState();
        for (const listener of [...listeners]) {
            try { listener(state); } catch { console.error('Management state listener failed.'); }
        }
    }

    /** @param {(state: import('../types').ManagementState) => void} listener */
    function subscribe(listener) {
        listeners.add(listener);
        listener(getState());
        return () => { listeners.delete(listener); };
    }

    function endGeneration(preserveExpiry = false) {
        if (!preserveExpiry) {
            if (expiryTimer !== null) clearTimeout(expiryTimer);
            expiryTimer = null;
        }
        access.abort(cancelled());
        access = new AbortController();
        revision++;
    }

    /** @param {'management-disabled' | 'blur' | 'hidden'} [reason] */
    function clearToken(reason) {
        suspended = reason === 'blur' || reason === 'hidden';
        endGeneration(suspended);
        token = '';
        authenticated = false;
        if (reason === 'management-disabled') available = false;
        access.abort(cancelled());
        if (lockButton) lockButton.hidden = true;
        publish();
    }

    function cancelled() {
        return new DOMException('Management action cancelled.', 'AbortError');
    }

    function reset() {
        clearToken();
        dialog?.close();
    }

    /** @param {'lock'|'locked'|'lock-failed'|'unlock'} type */
    function broadcast(type) {
        const event = { type, nonce: `${Date.now()}-${Math.random()}` };
        if (channel) channel.postMessage(event);
        else {
            try { localStorage.setItem(eventKey, JSON.stringify(event)); } catch { /* Other tabs revalidate when focused. */ }
        }
    }

    /** Called only for an explicit viewing sign-out, never for pagehide/reset.
     * @param {'start'|'complete'|'failed'} [phase] */
    function signOutViewing(phase = 'start') {
        remoteLockPending = phase === 'start';
        if (phase === 'failed') lockFailure = new Error('Viewing could not be locked. Retry locking before using management actions.');
        else lockFailure = null;
        reset();
        broadcast(phase === 'start' ? 'lock' : phase === 'complete' ? 'locked' : 'lock-failed');
    }

    /** @param {unknown} event */
    function receive(event) {
        if (!event || typeof event !== 'object' || !('type' in event)) return;
        if (event.type === 'unlock') {
            if (!locking && !lockFailure) { remoteLockPending = false; void revalidate(); }
            return;
        }
        if (!['lock', 'locked', 'lock-failed'].includes(String(event.type))) return;
        remoteLockPending = event.type === 'lock';
        reset();
        if (event.type === 'lock' && lockButton) {
            lockButton.hidden = false;
            lockButton.textContent = 'Lock';
            lockButton.title = 'Finish locking management in this browser';
        } else if (event.type === 'lock-failed') {
            lockFailure = new Error('Management could not be locked. Retry locking before using management actions.');
            if (lockButton) { lockButton.hidden = false; lockButton.textContent = 'Retry lock'; }
        } else if (event.type === 'locked') lockFailure = null;
    }

    async function lock() {
        if (locking) return locking;
        reset();
        broadcast('lock');
        remoteLockPending = false;
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
                broadcast('locked');
            } catch (failure) {
                lockFailure = new Error('Management could not be locked. Retry locking before using management actions.');
                broadcast('lock-failed');
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
        if (validating) await validating;
        if (lockFailure) throw lockFailure;
        if (remoteLockPending) throw new Error('Management is being locked in another tab. Retry locking before using management actions.');
    }

    /** @param {number | null | undefined} seconds @param {number} elapsedMs */
    function armExpiry(seconds, elapsedMs) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
        const deadline = Date.now() + Math.max(0, seconds * 1000 - elapsedMs);
        function check() {
            expiryTimer = null;
            const remaining = deadline - Date.now();
            if (remaining <= 0) { reset(); return; }
            expiryTimer = setTimeout(check, Math.min(2 ** 31 - 1, remaining));
        }
        check();
    }

    /** @param {boolean | import('../types').ManagementAccess} restored @param {number} [elapsedMs] */
    function restore(restored, elapsedMs = 0) {
        if (locking || lockFailure || remoteLockPending) return;
        endGeneration();
        suspended = false;
        token = '';
        authenticated = typeof restored === 'boolean' ? restored : Boolean(restored.management_authenticated);
        available = typeof restored === 'boolean' ? true : restored.management_available !== false;
        if (!available) authenticated = false;
        if (!authenticated) access.abort(cancelled());
        if (lockButton) lockButton.hidden = !authenticated;
        if (authenticated && typeof restored !== 'boolean') armExpiry(restored.management_expires_in_seconds, elapsedMs);
        publish();
    }

    /** @returns {Promise<boolean>} */
    async function revalidate() {
        if (locking || lockFailure || remoteLockPending) return false;
        if (validating) {
            const current = revision;
            const belongsToCurrentGeneration = validatingRevision === current;
            const result = await validating;
            if (belongsToCurrentGeneration) return result;
            if (current !== revision || globalThis.document?.hidden) return false;
            return revalidate();
        }
        clearToken(suspended ? 'blur' : undefined);
        const current = revision, started = Date.now();
        validatingRevision = current;
        validating = (async () => {
            try {
                /** @type {import('../types').ManagementAccess} */
                const result = await requestJson('/api/access', { cache: 'no-store' }, 10000);
                if (revision !== current || locking || lockFailure || remoteLockPending) return false;
                restore(result, Date.now() - started);
                return authenticated;
            } catch { if (revision === current) clearToken(); return false; }
            finally { validating = null; }
        })();
        return validating;
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
            const started = Date.now();
            try {
                /** @type {{success: boolean, remembered?: boolean, management_expires_in_seconds?: number | null}} */
                const verified = await requestJson('/api/admin/verify', { method: 'POST', headers: { Authorization: `Bearer ${supplied}`, 'X-BPM-Remember': '1' }, signal: current.signal });
                if (!current.isOpen()) return;
                endGeneration();
                token = verified.remembered ? '' : supplied;
                authenticated = available = true;
                if (verified.remembered) armExpiry(verified.management_expires_in_seconds, Date.now() - started);
                if (!authenticated) return;
                input.value = '';
                if (lockButton) lockButton.hidden = false;
                publish();
                broadcast('unlock');
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

    /** @param {AbortSignal} [signal] */
    async function unlock(signal) {
        await beforeRequest();
        if (!available) throw new HttpError('Management is not configured.', 403, { code: 'management_disabled' });
        await requestToken(signal);
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
            void revalidate();
        });
        globalThis.addEventListener('blur', () => { if (authenticated || suspended || validating) clearToken('blur'); });
        globalThis.addEventListener('focus', () => { if (!document.hidden && available) void revalidate(); });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { if (authenticated || suspended || validating) clearToken('hidden'); }
            else if (available) void revalidate();
        });
        if (typeof BroadcastChannel === 'function') {
            try { channel = new BroadcastChannel('bpm-management'); channel.onmessage = event => receive(event.data); } catch { /* Storage events remain available. */ }
        }
        globalThis.addEventListener('storage', event => {
            if (event.key !== eventKey || !event.newValue) return;
            try { receive(JSON.parse(event.newValue)); } catch { /* Ignore unrelated invalid data. */ }
        });
        configureAdminAuthentication({ getToken: () => token, isAuthenticated: () => authenticated, getRevision: () => revision,
            getSignal: () => access.signal, beforeRequest, clearToken, requestToken });
    }

    return Object.freeze({ init, lock, reset, restore, getState, subscribe, unlock, revalidate, signOutViewing });
}
