import { getAdminJson, postAdminJson, errorMessage, HttpError } from '../core/api.js';
import * as modal from '../core/modal.js';
import { fmtDuration } from '../core/format.js';

/** @typedef {import('../../../shared/api.generated').PeerPolicySnapshot} Snapshot */
/** @typedef {import('../../../shared/api.generated').PeerPolicyConfig} Config */
/** @typedef {import('../types').ManagementController} Management */

const escape = modal.escapeHtml;
const POLL_MS = 10_000;
const MAX_DISPLAYED_PEERS = 100;

/**
 * Policy data belongs to the open dialog and one management generation. Polling
 * this panel only reads status; the server owns observation and automatic work.
 * @param {{management: Management; document?: Document}} options
 */
export function create({ management, document = globalThis.document }) {
    const clock = document.defaultView || globalThis;
    let initialized = false;
    let generation = 0;
    let requests = new AbortController();
    let state = management.getState();
    let opening = false;
    let reading = false;
    let readRevision = 0;
    let saving = false;
    let allowanceEdited = false;
    let message = '';
    /** @type {number | null} */
    let timer = null;
    /** @type {Snapshot | null} */
    let snapshot = null;
    /** @type {HTMLButtonElement | null} */
    let button = null;
    /** @type {import('../types').ModalController | null} */
    let dialog = null;
    /** @type {import('../types').ModalController | null} */
    let confirmation = null;
    /** @type {(() => void) | null} */
    let unsubscribe = null;

    /** @param {number} current */
    function isCurrent(current) {
        return initialized && current === generation && !requests.signal.aborted &&
            state.authenticated && !state.signal.aborted && Boolean(dialog?.isOpen()) && !document.hidden;
    }

    function clearTimer() {
        if (timer !== null) clock.clearTimeout(timer);
        timer = null;
    }

    function wipe() {
        generation++;
        requests.abort();
        clearTimer();
        confirmation?.close(false);
        confirmation = null;
        dialog = null;
        snapshot = null;
        opening = false;
        reading = false;
        saving = false;
        allowanceEdited = false;
        message = '';
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-busy');
            button.disabled = !state.available;
        }
    }

    /** @param {boolean} [restoreFocus] */
    function close(restoreFocus = true) {
        confirmation?.close(false);
        confirmation = null;
        if (dialog) dialog.close(restoreFocus);
        else wipe();
    }

    /** @param {string} id */
    function element(id) {
        return /** @type {HTMLElement | null} */ (dialog?.body.querySelector(`#${id}`) || null);
    }

    function build() {
        return '<p class="peer-policy-intro">Reclaim slots from persistent inbound listeners, including while spare slots are available.</p>' +
            '<div class="peer-policy-modes" role="group" aria-label="Inbound policy mode">' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-off" data-policy-mode="off" aria-pressed="true">Off</button>' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-preview" data-policy-mode="preview" aria-pressed="false">Preview</button>' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-automatic" data-policy-mode="automatic" aria-pressed="false">Automatic</button>' +
            '</div><p id="peer-policy-status" class="peer-policy-status" role="status" aria-live="polite">Loading policy status…</p>' +
            '<p id="peer-policy-readiness" class="peer-policy-note"></p>' +
            '<div id="peer-policy-counts" class="peer-policy-counts"></div>' +
            '<form id="peer-policy-allowance-form" class="peer-policy-form">' +
            '<label for="peer-policy-allowance">Allowed listener candidates</label>' +
            '<input id="peer-policy-allowance" type="number" min="0" max="20" step="1" value="0" required>' +
            '<button type="submit" class="dialog-btn" id="peer-policy-allowance-save">Save allowance</button></form>' +
            '<p class="peer-policy-note">Zero means gradually remove every eligible listener candidate. Keep exceptions and safety protections still apply.</p>' +
            '<p id="peer-policy-limits" class="peer-policy-note"></p><p id="peer-policy-next-action" class="peer-policy-note"></p>' +
            '<div class="peer-policy-result" id="peer-policy-result" role="alert"></div>' +
            '<div class="peer-policy-section-heading"><h2>Observed connections</h2><button type="button" class="dialog-btn" id="peer-policy-refresh">Refresh status</button></div>' +
            '<p class="peer-policy-note">Listener behaviour cannot prove tracking. Quiet wallets may qualify; use Keep for an address you want to retain.</p>' +
            '<div id="peer-policy-peers" class="peer-policy-peers"></div>' +
            '<h2 class="peer-policy-heading">Keep exceptions</h2><p class="peer-policy-note">An exception applies to that address across connections, including other devices sharing the address.</p>' +
            '<form id="peer-policy-keep-form" class="peer-policy-form"><label for="peer-policy-keep-address">Address to keep</label>' +
            '<input id="peer-policy-keep-address" type="text" maxlength="512" autocomplete="off" spellcheck="false" placeholder="IPv4, IPv6, onion or I2P" required>' +
            '<button type="submit" class="dialog-btn" id="peer-policy-keep-add">Add exception</button></form>' +
            '<div id="peer-policy-kept"></div><h2 class="peer-policy-heading">Recent decisions</h2><div id="peer-policy-events"></div>' +
            '<p class="peer-policy-note">Automatic mode runs on the server with the browser closed. Disconnecting a peer allows it to reconnect and cannot prevent observation of a public node.</p>';
    }

    /** @param {HTMLElement | null} target @param {string} value */
    function setText(target, value) {
        if (target && target.textContent !== value) target.textContent = value;
    }

    function render() {
        if (!dialog?.isOpen()) return;
        const data = snapshot;
        const disabled = saving || !data?.available;
        for (const control of dialog.body.querySelectorAll('button, input')) {
            if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) control.disabled = disabled;
        }
        const refreshButton = /** @type {HTMLButtonElement | null} */ (element('peer-policy-refresh'));
        if (refreshButton) refreshButton.disabled = saving || reading;
        setText(element('peer-policy-result'), message);
        if (!data) {
            setText(element('peer-policy-status'), reading ? 'Loading policy status…' : 'Policy status is unavailable. Refresh before changing settings.');
            setText(element('peer-policy-readiness'), '');
            setText(element('peer-policy-counts'), '');
            setText(element('peer-policy-peers'), 'No current policy evidence available.');
            setText(element('peer-policy-kept'), '');
            setText(element('peer-policy-events'), '');
            return;
        }
        const modeNames = { off: 'Off', preview: 'Preview', automatic: 'Automatic' };
        for (const control of dialog.body.querySelectorAll('[data-policy-mode]')) {
            if (!(control instanceof HTMLButtonElement)) continue;
            control.setAttribute('aria-pressed', String(control.dataset.policyMode === data.config.mode));
            if (control.dataset.policyMode === 'automatic') {
                control.disabled = disabled || data.config.mode === 'off' || data.preview_remaining_seconds > 0;
                control.title = data.config.mode === 'off' ? 'Start Preview before enabling Automatic.' : data.preview_remaining_seconds > 0
                    ? 'Complete a fresh 30-minute Preview observation period first.' : 'Review and enable automatic disconnection.';
            }
        }
        setText(element('peer-policy-status'), `${modeNames[data.config.mode]} — ${data.reason}`);
        const trial = data.preview_remaining_seconds > 0 ? `Automatic requires ${fmtDuration(data.preview_remaining_seconds)} more fresh observation.` : 'Fresh observation trial complete.';
        setText(element('peer-policy-readiness'), data.config.mode === 'off' ? 'Off: policy observation and automatic actions are disabled. Start Preview to collect evidence.'
            : data.config.mode === 'preview' ? `Preview makes no changes to your node. ${trial}` : `Automatic continues while this browser is closed. ${trial}`);
        const counts = element('peer-policy-counts');
        if (counts) counts.innerHTML = `<span>Inbound <strong>${escape(data.counts.inbound)}</strong></span><span>Candidates <strong>${escape(data.counts.candidates)}</strong></span><span>Exempt <strong>${escape(data.counts.exempt)}</strong></span>`;
        const allowance = /** @type {HTMLInputElement | null} */ (element('peer-policy-allowance'));
        if (allowance && !allowanceEdited && document.activeElement !== allowance) allowance.value = String(data.config.listener_allowance);
        setText(element('peer-policy-limits'), `Grace ${fmtDuration(data.limits.grace_seconds)}; continuous observation ${fmtDuration(data.limits.observation_seconds)}; at most one attempt per ${fmtDuration(data.limits.attempt_interval_seconds)} and ${data.limits.max_attempts_per_hour} per hour.`);
        setText(element('peer-policy-next-action'), data.next_action_at === null ? `State: ${data.effective_state}. AS diversity ${data.as_diversity_available ? 'assessed' : 'unavailable; network and connection protections still apply'}.`
            : `State: ${data.effective_state}. Next permitted attempt: ${new Date(data.next_action_at * 1000).toLocaleTimeString()}.`);

        const active = /** @type {HTMLElement | null} */ (document.activeElement);
        const focusAction = active?.dataset.policyAction, focusAddress = active?.dataset.address;
        const statuses = { candidate: 'Listener candidate', protected: 'Protected', observing: 'Observing', unknown: 'Insufficient evidence' };
        const order = { candidate: 0, observing: 1, unknown: 2, protected: 3 };
        const peers = [...data.peers].sort((a, b) => order[a.status] - order[b.status]);
        const peerContainer = element('peer-policy-peers');
        if (peerContainer) peerContainer.innerHTML = peers.length ? peers.slice(0, MAX_DISPLAYED_PEERS).map(peer => {
            const kept = data.config.keep_addresses.includes(peer.host);
            return `<article class="peer-policy-card" data-status="${escape(peer.status)}"><div class="peer-policy-card-heading"><strong>${escape(peer.address)}</strong><span>${escape(statuses[peer.status])}</span></div>` +
                `<p>${escape(peer.reason)}</p><p class="peer-policy-note">Connection age ${peer.connection_age_seconds === null ? 'unknown' : escape(fmtDuration(peer.connection_age_seconds))}; observed ${escape(fmtDuration(peer.observed_seconds))}${peer.remaining_seconds > 0 ? `; needs ${escape(fmtDuration(peer.remaining_seconds))} more` : ''}.</p>` +
                `<button type="button" class="dialog-btn" data-policy-action="keep" data-address="${escape(peer.host)}"${disabled || kept || !peer.host || data.config.keep_addresses.length >= 128 ? ' disabled' : ''}>${kept ? 'Kept' : 'Keep address'}</button></article>`;
        }).join('') + (peers.length > MAX_DISPLAYED_PEERS ? `<p class="peer-policy-note">Showing ${MAX_DISPLAYED_PEERS} of ${escape(peers.length)} observed connections, with candidates first.</p>` : '')
            : '<p class="peer-policy-note">No connection evidence yet. Off collects no policy history.</p>';
        const keptContainer = element('peer-policy-kept');
        if (keptContainer) keptContainer.innerHTML = data.config.keep_addresses.length ? data.config.keep_addresses.map(address =>
            `<div class="peer-policy-kept-row"><code>${escape(address)}</code><button type="button" class="dialog-btn" data-policy-action="remove" data-address="${escape(address)}"${disabled ? ' disabled' : ''}>Remove exception</button></div>`).join('')
            : '<p class="peer-policy-note">No Keep exceptions.</p>';
        const events = element('peer-policy-events');
        const eventNames = { would_disconnect: 'Would disconnect', requested: 'Disconnect requested', succeeded: 'RPC accepted request', failed: 'Request failed', uncertain: 'Outcome uncertain', departure_observed: 'Departure observed after request', skipped: 'Skipped' };
        if (events) events.innerHTML = data.events.length ? data.events.map(event =>
            `<div class="peer-policy-event"><time>${escape(new Date(event.time * 1000).toLocaleString())}</time><strong>${escape(eventNames[event.kind])}</strong>${event.address ? `<code>${escape(event.address)}</code>` : ''}<span>${escape(event.reason)}</span></div>`).join('')
            : '<p class="peer-policy-note">No recent decisions.</p>';
        if (focusAction && focusAddress) {
            const replacement = [...dialog.body.querySelectorAll('button[data-policy-action]')].find(control =>
                control instanceof HTMLButtonElement && control.dataset.policyAction === focusAction && control.dataset.address === focusAddress && !control.disabled);
            if (replacement instanceof HTMLButtonElement) replacement.focus({ preventScroll: true });
        }
    }

    /** @param {number} current */
    async function fetchSnapshot(current) {
        const data = await /** @type {Promise<Snapshot>} */ (getAdminJson('/api/peer-policy', { signal: requests.signal }, 15_000));
        if (!isCurrent(current)) return null;
        return data;
    }

    function schedule() {
        clearTimer();
        if (isCurrent(generation)) timer = clock.setTimeout(() => { timer = null; void refresh(); }, POLL_MS);
    }

    async function refresh() {
        const current = generation;
        if (!isCurrent(current) || reading || saving) return;
        const operation = ++readRevision;
        clearTimer();
        reading = true;
        render();
        try {
            const data = await fetchSnapshot(current);
            if (data && operation === readRevision && !saving) snapshot = data;
        } catch (error) {
            if (isCurrent(current) && operation === readRevision) { snapshot = null; message = errorMessage(error); }
        } finally {
            if (isCurrent(current)) { reading = false; render(); schedule(); }
        }
    }

    /** @param {Config} config */
    async function save(config) {
        const current = generation;
        if (!isCurrent(current) || saving || !snapshot?.available) return;
        const revision = snapshot.revision;
        // A polling response started before this save must not restore old
        // settings or readiness after the mutation response has arrived.
        readRevision++;
        saving = true;
        clearTimer();
        message = '';
        render();
        try {
            const data = await /** @type {Promise<Snapshot>} */ (postAdminJson('/api/peer-policy', { expected_revision: revision, config }, { signal: requests.signal }, 15_000));
            if (!isCurrent(current)) return;
            snapshot = data;
            allowanceEdited = false;
            message = 'Policy settings saved.';
        } catch (error) {
            if (!isCurrent(current)) return;
            const code = error instanceof HttpError && error.data && typeof error.data === 'object' && 'code' in error.data ? error.data.code : null;
            const conflict = error instanceof HttpError && error.status === 409 && code === 'peer_policy_conflict';
            message = conflict ? 'Settings changed in another browser. Latest settings loaded; review before saving again.'
                : error instanceof HttpError && error.status === 409 ? `${errorMessage(error)} Latest status loaded; review before saving again.`
                    : `Save could not be confirmed: ${errorMessage(error)}. Review the latest status before trying again.`;
            // Read after a failed/uncertain save, never replay the mutation.
            try {
                const data = await fetchSnapshot(current);
                if (data) { snapshot = data; allowanceEdited = false; }
            } catch { if (isCurrent(current)) snapshot = null; }
        } finally {
            if (isCurrent(current)) { saving = false; render(); schedule(); }
        }
    }

    function confirmAutomatic() {
        if (!snapshot || snapshot.config.mode === 'off' || snapshot.preview_remaining_seconds > 0 || saving) return;
        confirmation?.close();
        confirmation = modal.open({
            document, id: 'peer-policy-confirm', title: 'Enable automatic disconnection', maxWidth: 540,
            initialHtml: '<p>Automatic mode may disconnect quiet wallets as well as passive listeners. Use Keep exceptions for addresses you want to retain.</p>' +
                '<p>Disconnecting a peer allows reconnection and cannot prevent tracking or observation of a public node.</p>' +
                '<p>The policy runs on the server while the browser is closed or management is locked. Off stops new actions; an already transmitted RPC can still complete.</p>' +
                '<label class="peer-policy-ack"><input type="checkbox" id="peer-policy-confirm-ack">I understand and authorize these automatic disconnections.</label>' +
                '<div class="peer-policy-confirm-actions"><button type="button" class="dialog-btn" id="peer-policy-confirm-cancel">Cancel</button><button type="button" class="dialog-btn" id="peer-policy-confirm-enable" disabled>Enable Automatic</button></div>',
            onClose() { confirmation = null; },
        });
        const current = confirmation;
        const acknowledgment = /** @type {HTMLInputElement} */ (current.body.querySelector('#peer-policy-confirm-ack'));
        const enable = /** @type {HTMLButtonElement} */ (current.body.querySelector('#peer-policy-confirm-enable'));
        acknowledgment.addEventListener('change', () => { enable.disabled = !acknowledgment.checked; });
        current.body.querySelector('#peer-policy-confirm-cancel')?.addEventListener('click', () => current.close());
        enable.addEventListener('click', () => {
            if (!acknowledgment.checked || !snapshot || snapshot.preview_remaining_seconds > 0) return;
            const config = { ...snapshot.config, keep_addresses: [...snapshot.config.keep_addresses], mode: /** @type {Config['mode']} */ ('automatic') };
            current.close();
            void save(config);
        });
    }

    function bind() {
        if (!dialog) return;
        dialog.body.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element) || saving || !snapshot) return;
            const control = target.closest('button');
            if (!(control instanceof HTMLButtonElement) || control.disabled) return;
            const mode = control.dataset.policyMode;
            if (mode === 'automatic') { confirmAutomatic(); return; }
            if (mode === 'off' || mode === 'preview') {
                void save({ ...snapshot.config, mode, keep_addresses: [...snapshot.config.keep_addresses] });
                return;
            }
            const action = control.dataset.policyAction, address = control.dataset.address;
            if (action && address) {
                const keep = snapshot.config.keep_addresses;
                void save({ ...snapshot.config, keep_addresses: action === 'keep' ? [...new Set([...keep, address])] : keep.filter(value => value !== address) });
            }
        });
        element('peer-policy-refresh')?.addEventListener('click', () => { void refresh(); });
        element('peer-policy-allowance')?.addEventListener('input', () => { allowanceEdited = true; });
        element('peer-policy-allowance-form')?.addEventListener('submit', event => {
            event.preventDefault();
            const input = /** @type {HTMLInputElement | null} */ (element('peer-policy-allowance'));
            if (!input || !input.reportValidity() || !snapshot) return;
            void save({ ...snapshot.config, listener_allowance: Number(input.value), keep_addresses: [...snapshot.config.keep_addresses] });
        });
        element('peer-policy-keep-form')?.addEventListener('submit', event => {
            event.preventDefault();
            const input = /** @type {HTMLInputElement | null} */ (element('peer-policy-keep-address'));
            if (!input || !input.reportValidity() || !snapshot) return;
            const address = input.value.trim();
            if (address && snapshot.config.keep_addresses.length < 128) void save({ ...snapshot.config, keep_addresses: [...new Set([...snapshot.config.keep_addresses, address])] });
        });
    }

    async function open() {
        if (!initialized || opening || dialog?.isOpen()) return;
        requests.abort();
        requests = new AbortController();
        const current = ++generation;
        opening = true;
        button?.setAttribute('aria-busy', 'true');
        try {
            await management.unlock(requests.signal);
            if (current !== generation || requests.signal.aborted || !state.authenticated || document.hidden) return;
            dialog = modal.open({ document, id: 'peer-policy-modal', title: 'Inbound policy', maxWidth: 760,
                bodyClass: 'modal-body peer-policy-body', initialHtml: build(), onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
            bind();
            await refresh();
        } catch (error) {
            if (current !== generation || requests.signal.aborted) return;
            dialog = modal.open({ document, id: 'peer-policy-modal', title: 'Inbound policy', maxWidth: 540,
                initialHtml: `<p role="alert">${escape(errorMessage(error))}</p>`, onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
        } finally {
            if (current === generation) { opening = false; button?.removeAttribute('aria-busy'); if (button) button.disabled = !state.available; }
        }
    }

    function onClick() { void open(); }
    function onVisibility() { if (document.hidden) close(false); }
    function onPageHide() { close(false); }

    function init() {
        if (initialized) return;
        initialized = true;
        button = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-inbound-policy'));
        button?.addEventListener('click', onClick);
        document.addEventListener('visibilitychange', onVisibility);
        document.defaultView?.addEventListener('pagehide', onPageHide);
        unsubscribe = management.subscribe(next => {
            const previous = state;
            state = next;
            if ((!next.authenticated || next.revision !== previous.revision) && dialog) close(false);
            if (!next.authenticated && opening) close(false);
            if (button) {
                button.disabled = !next.available;
                button.title = next.available ? 'Preview and configure inbound listener cleanup' : 'Configure an administrator token to use inbound policy';
            }
        });
    }

    function dispose() {
        close(false);
        initialized = false;
        unsubscribe?.();
        unsubscribe = null;
        button?.removeEventListener('click', onClick);
        document.removeEventListener('visibilitychange', onVisibility);
        document.defaultView?.removeEventListener('pagehide', onPageHide);
    }

    return Object.freeze({ init, close, dispose });
}
