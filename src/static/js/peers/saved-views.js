import { getAdminJson, postAdminJson, errorMessage, HttpError } from '../core/api.js';
import * as modal from '../core/modal.js';

/** @typedef {import('../../../shared/api.generated').SavedViewsResponse} Collection */
/** @typedef {import('../../../shared/api.generated').SavedView} SavedView */
/** @typedef {import('../../../shared/api.generated').PeerViewState} PeerView */
/** @typedef {import('../../../shared/api.generated').PolicyViewState} PolicyView */

/** Shared administrator views contain intent, never snapshots or policy actions.
 * @param {{management:import('../types').ManagementController,capturePeers:()=>PeerView|null|undefined,applyPeers:(view:PeerView)=>unknown,capturePolicy:()=>PolicyView,applyPolicy:(view:PolicyView)=>unknown,document?:Document}} options */
export function create(options) {
    const document = options.document || globalThis.document;
    const management = options.management;
    let state = management.getState(), initialized = false, generation = 0, busy = false;
    let requests = new AbortController();
    /** @type {Collection | null} */ let collection = null;
    /** @type {import('../types').ModalController | null} */ let dialog = null;
    /** @type {import('../types').ModalController | null} */ let renameDialog = null;
    /** @type {HTMLButtonElement | null} */ let button = null;
    /** @type {(() => void) | null} */ let unsubscribe = null;
    /** @type {'peers'|'policy'} */ let kind = 'peers';
    let message = '';
    const escape = modal.escapeHtml;
    /** @param {string} id */ const element = id => dialog?.body.querySelector(`#${id}`) || null;
    /** @param {number} current */ const current = current => current === generation && state.authenticated && !state.signal.aborted && !requests.signal.aborted && Boolean(dialog?.isOpen()) && !document.hidden;
    function wipe() {
        generation++; requests.abort(); collection = null; busy = false; message = ''; dialog = null;
        renameDialog?.close(false); renameDialog = null;
        if (button) button.setAttribute('aria-expanded', 'false');
    }
    /** @param {boolean} [restoreFocus] */ function close(restoreFocus = true) { if (dialog) dialog.close(restoreFocus); else wipe(); }
    function render() {
        if (!dialog?.isOpen()) return;
        const result = element('saved-view-result'); if (result) result.textContent = message;
        const renameResult = renameDialog?.body.querySelector('#saved-view-rename-result'); if (renameResult) renameResult.textContent = message;
        const list = element('saved-view-list');
        if (list) list.innerHTML = collection?.views.filter(v => v.kind === kind).map(view => `<article class="saved-view-row"><strong>${escape(view.name)}</strong><div><button type="button" class="dialog-btn" data-view-action="apply" data-view-id="${escape(view.id)}">Apply</button><button type="button" class="dialog-btn" data-view-action="update" data-view-id="${escape(view.id)}">Update from current</button><button type="button" class="dialog-btn" data-view-action="rename" data-view-id="${escape(view.id)}">Rename</button><button type="button" class="dialog-btn" data-view-action="delete" data-view-id="${escape(view.id)}">Delete</button></div></article>`).join('') || '<p class="peer-policy-note">No saved views for this list.</p>';
        for (const control of dialog.body.querySelectorAll('button,input,select')) if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.disabled = busy || !state.authenticated || !collection;
        for (const control of renameDialog?.body.querySelectorAll('button,input') || []) if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) control.disabled = busy || !state.authenticated;
    }
    async function read() {
        const operation = generation;
        const data = await /** @type {Promise<Collection>} */ (getAdminJson('/api/saved-views', { signal: requests.signal }));
        if (current(operation)) collection = data;
    }
    /** @param {Record<string,unknown>} payload */
    async function write(payload) {
        if (!collection || busy || !current(generation)) return;
        const operation = generation; busy = true; message = ''; render();
        try {
            const data = await /** @type {Promise<Collection>} */ (postAdminJson('/api/saved-views', { ...payload, expected_revision: collection.revision }, { signal: requests.signal }));
            if (!current(operation)) return;
            collection = data; message = 'Saved views updated.'; renameDialog?.close(); renameDialog = null;
        } catch (error) {
            if (!current(operation)) return;
            message = error instanceof HttpError && error.status === 409 ? 'Saved views changed in another browser. Latest views loaded; review before saving again.' : `Save could not be confirmed: ${errorMessage(error)}`;
            try { await read(); } catch { if (current(operation)) collection = null; }
        } finally { if (current(operation)) { busy = false; render(); } }
    }
    /** @param {'peers'|'policy'} selected */
    function capture(selected) {
        const value = selected === 'peers' ? options.capturePeers() : options.capturePolicy();
        if (!value) throw new Error('The peer dashboard is unavailable. Unlock viewing before saving or applying a view.');
        return value;
    }
    /** @param {SavedView} view */
    function rename(view) {
        renameDialog?.close(false);
        renameDialog = modal.open({ document, id: 'saved-view-rename', title: 'Rename saved view', maxWidth: 420,
            initialHtml: `<form id="saved-view-rename-form" class="saved-view-form"><label>Name<input id="saved-view-rename-input" maxlength="80" required value="${escape(view.name)}"></label><button type="submit" class="dialog-btn">Save name</button><p id="saved-view-rename-result" role="alert"></p></form>`, initialFocusSelector: '#saved-view-rename-input', onClose() { renameDialog = null; } });
        renameDialog.body.querySelector('form')?.addEventListener('submit', event => {
            event.preventDefault(); const input = /** @type {HTMLInputElement | null} */ (renameDialog?.body.querySelector('input'));
            if (input?.reportValidity() && input.value.trim()) void write({ operation: 'rename', id: view.id, name: input.value.trim() });
        });
    }
    /** @param {'peers'|'policy'} [selected] */
    async function open(selected = 'peers') {
        if (!initialized || dialog?.isOpen()) return;
        requests.abort(); requests = new AbortController(); const operation = ++generation; kind = selected;
        try {
            await management.unlock(requests.signal);
            if (operation !== generation || !state.authenticated || requests.signal.aborted || document.hidden) return;
            dialog = modal.open({ document, id: 'saved-views-modal', title: 'Shared saved views', maxWidth: 760,
                bodyClass: 'modal-body saved-views-body', initialHtml: '<p class="peer-policy-note">These views are shared across administrator devices. Applying a view changes display filters only.</p><form id="saved-view-form" class="saved-view-form"><label>List<select id="saved-view-kind"><option value="peers">Peer list</option><option value="policy">Policy connections</option></select></label><label>Name<input id="saved-view-name" maxlength="80" required placeholder="For example, Outbound Tor"></label><button type="submit" class="dialog-btn" id="saved-view-create">Save current view</button></form><p id="saved-view-result" role="status" aria-live="polite"></p><div id="saved-view-list"></div>', onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
            const select = /** @type {HTMLSelectElement | null} */ (element('saved-view-kind')); if (select) select.value = kind;
            dialog.body.addEventListener('change', event => {
                const control = event.target;
                if (control instanceof HTMLSelectElement && control.id === 'saved-view-kind') { kind = control.value === 'policy' ? 'policy' : 'peers'; render(); }
            });
            dialog.body.addEventListener('submit', event => {
                event.preventDefault(); if (!(event.target instanceof HTMLFormElement) || event.target.id !== 'saved-view-form') return;
                const input = /** @type {HTMLInputElement | null} */ (element('saved-view-name'));
                if (!input?.reportValidity() || !input.value.trim()) return;
                try { void write({ operation: 'create', name: input.value.trim(), kind, state: capture(kind) }); }
                catch (error) { message = errorMessage(error); render(); }
            });
            dialog.body.addEventListener('click', event => {
                const target = event.target;
                if (!(target instanceof Element) || busy) return;
                const control = target.closest('button[data-view-action]');
                if (!(control instanceof HTMLButtonElement) || control.disabled) return;
                const view = collection?.views.find(v => v.id === control.dataset.viewId); if (!view) return;
                if (control.dataset.viewAction === 'rename') { rename(view); return; }
                if (control.dataset.viewAction === 'delete') { void write({ operation: 'delete', id: view.id }); return; }
                if (control.dataset.viewAction === 'update') {
                    try { void write({ operation: 'update', id: view.id, state: capture(view.kind) }); }
                    catch (error) { message = errorMessage(error); render(); } return;
                }
                const apply = async () => {
                    try {
                        capture(view.kind);
                        const notice = view.kind === 'peers' ? await options.applyPeers(/** @type {PeerView} */ (view.state)) : await options.applyPolicy(/** @type {PolicyView} */ (view.state));
                        if (typeof notice === 'string' && notice) { message = `View applied. ${notice}`; render(); }
                        else close(false);
                    } catch (error) { if (current(operation)) { message = errorMessage(error); render(); } }
                };
                void apply();
            });
            busy = true; render(); await read();
            if (current(operation)) { busy = false; render(); }
        } catch (error) { if (operation === generation && dialog?.isOpen()) { busy = false; message = errorMessage(error); render(); } }
    }
    /** @param {Event} event */ function onClick(event) { event.stopPropagation(); void open(); }
    /** @param {Event} event */ function onOpen(event) { const detail = /** @type {CustomEvent<{kind?:string}>} */ (event).detail; void open(detail?.kind === 'policy' ? 'policy' : 'peers'); }
    function onVisibility() { if (document.hidden) close(false); }
    function init() {
        if (initialized) return; initialized = true;
        button = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-saved-views'));
        button?.addEventListener('click', onClick); document.addEventListener('bpm:open-saved-views', onOpen); document.addEventListener('visibilitychange', onVisibility);
        unsubscribe = management.subscribe(next => {
            state = next; if (button) button.hidden = !next.authenticated || document.hidden;
            if (!next.authenticated || next.signal.aborted) close(false);
        });
    }
    function dispose() {
        initialized = false; close(false); unsubscribe?.(); unsubscribe = null; if (button) button.hidden = true;
        button?.removeEventListener('click', onClick); document.removeEventListener('bpm:open-saved-views', onOpen); document.removeEventListener('visibilitychange', onVisibility);
    }
    return Object.freeze({ init, close, dispose });
}
