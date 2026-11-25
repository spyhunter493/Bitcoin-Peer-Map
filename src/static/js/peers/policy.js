import { getAdminJson, postAdminJson, errorMessage, HttpError } from '../core/api.js';
import * as modal from '../core/modal.js';
import { fmtDuration } from '../core/format.js';

/** @typedef {import('../../../shared/api.generated').PeerPolicySnapshot} Snapshot */
/** @typedef {import('../../../shared/api.generated').PeerPolicyConfig} Config */
/** @typedef {import('../types').ManagementController} Management */
/** @typedef {import('../../../shared/api.generated').PeerPolicyStatus} Status */

const escape = modal.escapeHtml;
const POLL_MS = 10_000;
const modeNames = { off: 'Off', preview: 'Preview', automatic: 'Automatic' };
const eventNames = { would_disconnect: 'Would disconnect', requested: 'Disconnect requested', succeeded: 'RPC accepted request', failed: 'Request failed', uncertain: 'Outcome uncertain', departure_observed: 'Departure observed after request', skipped: 'Skipped', same_host_return: 'Same-address return observed', paused: 'Automatic paused' };
const tabNames = { overview: 'Overview', connections: 'Connections', activity: 'Activity', settings: 'Settings' };
/** @typedef {{address:string,label:string,note:string}} Annotation */
/** @typedef {{revision:number,annotations:Annotation[]}} Annotations */
/** @typedef {{query:string,status:''|'candidate'|'protected'|'observing'|'unknown',network:string,page_size:0|10|20|30|40|50}} PolicyView */

/**
 * Policy data belongs to the open dialog and one management generation. Polling
 * this panel only reads status; the server owns observation and automatic work.
 * @param {{management: Management; document?: Document}} options
 */
export function create({ management, document = globalThis.document }) {
    const clock = document.defaultView || globalThis;
    let initialized = false;
    let pageActive = true;
    let generation = 0;
    let requests = new AbortController();
    let state = management.getState();
    let opening = false;
    let reading = false;
    let readRevision = 0;
    let saving = false;
    let allowanceEdited = false;
    let allowanceDraft = '';
    let message = '';
    let suspended = false;
    let page = 0;
    let pageSize = 10;
    let search = '', statusFilter = '', networkFilter = '';
    let peersHtml = '', keptHtml = '', eventsHtml = '';
    /** @type {keyof typeof tabNames} */
    let activeTab = 'overview';
    /** @type {Map<string, HTMLElement>} */
    const tabPanels = new Map();
    /** @type {Map<string,number>} */ const tabScroll = new Map();
    /** @type {Annotations | null} */
    let annotations = null;
    let annotationReading = false, annotationSaving = false, annotationRevision = 0, annotationError = '';
    let annotationAddress = '';
    let activityPage = 0, activityQuery = '', activityKind = '';
    /** @type {Snapshot['events']} */
    let activitySnapshot = [];
    let activityNew = 0;
    const evidenceOpen = new Set();
    /** @type {Snapshot | null} */
    let sortedSnapshot = null;
    /** @type {Snapshot['peers']} */
    let sortedPeers = [];
    let filteredKey = '';
    /** @type {Snapshot['peers']} */
    let filteredPeers = [];
    let statusGeneration = 0;
    let statusReadRevision = 0;
    let statusRequests = new AbortController();
    /** @type {number | null} */
    let statusTimer = null;
    let statusReading = false, stopping = false;
    /** @type {Status | null} */
    let toolbarStatus = null;
    /** @type {{action: string; address: string} | null} */
    let focusAfterSave = null;
    /** @type {HTMLElement | null} */
    let toolbar = null;
    /** @type {HTMLElement | null} */
    let badge = null;
    /** @type {HTMLButtonElement | null} */
    let quickOff = null;
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
        allowanceDraft = '';
        message = '';
        suspended = false;
        focusAfterSave = null; evidenceOpen.clear();
        page = 0; pageSize = 10; search = ''; statusFilter = ''; networkFilter = '';
        peersHtml = ''; keptHtml = ''; eventsHtml = '';
        activeTab = 'overview'; tabPanels.clear(); tabScroll.clear();
        annotations = null; annotationReading = false; annotationSaving = false; annotationRevision++; annotationError = ''; annotationAddress = '';
        activityPage = 0; activityQuery = ''; activityKind = ''; activitySnapshot = []; activityNew = 0;
        sortedSnapshot = null; sortedPeers = []; filteredKey = ''; filteredPeers = [];
        if (button) {
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-busy');
            button.disabled = !state.available;
        }
        resumeStatus();
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
        return '<div class="peer-policy-sticky"><div class="peer-policy-modes" role="group" aria-label="Inbound policy mode">' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-off" data-policy-mode="off" aria-pressed="true">Off</button>' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-preview" data-policy-mode="preview" aria-pressed="false">Preview</button>' +
            '<button type="button" class="dialog-btn" id="peer-policy-mode-automatic" data-policy-mode="automatic" aria-pressed="false">Automatic</button>' +
            '</div><div class="peer-policy-section-heading"><p id="peer-policy-status" class="peer-policy-status" role="status" aria-live="polite">Loading policy status…</p><button type="button" class="dialog-btn" id="peer-policy-refresh">Refresh status</button></div>' +
            '<div class="peer-policy-result" id="peer-policy-result" role="alert"></div>' +
            '<div class="peer-policy-tabs" role="tablist" aria-label="Inbound policy sections">' + Object.entries(tabNames).map(([key, name]) =>
                `<button type="button" role="tab" class="dialog-btn" id="peer-policy-tab-${key}" data-policy-tab="${key}" aria-selected="${key === activeTab}" aria-controls="peer-policy-panel-${key}" tabindex="${key === activeTab ? 0 : -1}">${name}</button>`).join('') +
            '</div></div><div id="peer-policy-content" class="peer-policy-content"></div>';
    }

    /** @param {keyof typeof tabNames} tab */
    function buildTab(tab) {
        if (tab === 'overview') return '<p id="peer-policy-readiness" class="peer-policy-note"></p><div id="peer-policy-counts" class="peer-policy-counts"></div>' +
            '<p id="peer-policy-limits" class="peer-policy-note"></p><p id="peer-policy-next-action" class="peer-policy-note"></p><p id="peer-policy-proposal" class="peer-policy-note"></p>' +
            '<h2 class="peer-policy-heading">Recent results</h2><p id="peer-policy-results" class="peer-policy-note"></p>' +
            '<p class="peer-policy-note">The current policy state retains up to seven days. Recorded outcome reports show their actual coverage and gaps.</p>' +
            '<button type="button" class="dialog-btn" data-policy-monitoring="trends">Open outcome reports</button>' +
            '<p class="peer-policy-note">Accepted requests are not proof of disconnection. Departures observed after a request do not prove its cause. A return from the same address may be a different client.</p>' +
            '<p class="peer-policy-note">Automatic mode runs on the server with the browser closed. Disconnecting a peer allows reconnection and cannot prevent observation of a public node.</p>';
        if (tab === 'connections') return '<button type="button" class="dialog-btn" id="peer-policy-saved-views">Saved views</button>' +
            '<div class="peer-policy-section-heading"><h2>Observed connections</h2></div>' +
            '<p class="peer-policy-note">Listener behaviour cannot prove tracking. Quiet wallets may qualify; use Keep for an address you want to retain.</p>' +
            '<div class="peer-policy-filters"><label>Search<input id="peer-policy-search" type="search" placeholder="Address or software" autocomplete="off"></label>' +
            '<label>Status<select id="peer-policy-filter-status"><option value="">All statuses</option><option value="candidate">Listener candidates</option><option value="protected">Protected</option><option value="observing">Observing</option><option value="unknown">Insufficient evidence</option></select></label>' +
            '<label>Network<select id="peer-policy-filter-network"><option value="">All networks</option></select></label>' +
            '<label>Per page<select id="peer-policy-page-size"><option value="10">10</option><option value="20">20</option><option value="30">30</option><option value="40">40</option><option value="50">50</option><option value="all">All</option></select></label></div>' +
            '<div class="peer-policy-pagination"><span id="peer-policy-page-count" role="status" aria-live="polite"></span><button type="button" class="dialog-btn" id="peer-policy-page-previous">Previous</button><button type="button" class="dialog-btn" id="peer-policy-page-next">Next</button></div>' +
            '<div id="peer-policy-peers" class="peer-policy-peers"></div>';
        if (tab === 'activity') return '<div class="peer-policy-filters"><label>Address<input id="peer-policy-activity-search" type="search" autocomplete="off"></label>' +
            '<label>Decision<select id="peer-policy-activity-kind"><option value="">All decisions</option>' + Object.entries(eventNames).map(([kind, name]) => `<option value="${kind}">${name}</option>`).join('') + '</select></label></div>' +
            '<p id="peer-policy-activity-coverage" class="peer-policy-note"></p><button type="button" class="dialog-btn" id="peer-policy-activity-new" hidden>New activity</button>' +
            '<div class="peer-policy-pagination"><span id="peer-policy-activity-count" role="status" aria-live="polite"></span><button type="button" class="dialog-btn" id="peer-policy-activity-previous">Previous</button><button type="button" class="dialog-btn" id="peer-policy-activity-next">Next</button></div>' +
            '<div id="peer-policy-events"></div><button type="button" class="dialog-btn" data-policy-monitoring="history">Open recorded history</button>';
        return '<form id="peer-policy-allowance-form" class="peer-policy-form"><label for="peer-policy-allowance">Allowed listener candidates</label>' +
            '<input id="peer-policy-allowance" type="number" min="0" max="20" step="1" value="0" required><button type="submit" class="dialog-btn" id="peer-policy-allowance-save">Save allowance</button></form>' +
            '<p class="peer-policy-note">Zero means gradually remove every eligible listener candidate. Keep exceptions and safety protections still apply.</p>' +
            '<h2 class="peer-policy-heading">Keep exceptions</h2><p class="peer-policy-note">An exception applies to that address across connections, including other devices sharing the address. Names and notes are administrator metadata; changing them never changes the policy.</p>' +
            '<form id="peer-policy-keep-form" class="peer-policy-form"><label for="peer-policy-keep-address">Address to keep</label>' +
            '<input id="peer-policy-keep-address" type="text" maxlength="512" autocomplete="off" spellcheck="false" placeholder="IPv4, IPv6, onion or I2P" required>' +
            '<button type="submit" class="dialog-btn" id="peer-policy-keep-add">Add exception</button></form>' +
            '<div id="peer-policy-kept"></div><p id="peer-policy-annotation-result" class="peer-policy-note" role="status"></p><div id="peer-policy-annotation-editor"></div>';
    }

    /** @param {keyof typeof tabNames} tab */
    function selectTab(tab) {
        if (!dialog || !Object.hasOwn(tabNames, tab)) return;
        const content = element('peer-policy-content');
        if (content) tabScroll.set(activeTab, content.scrollTop);
        activeTab = tab;
        let panel = tabPanels.get(tab);
        if (!panel) {
            panel = document.createElement('section'); panel.className = 'peer-policy-tab-panel';
            panel.id = `peer-policy-panel-${tab}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `peer-policy-tab-${tab}`);
            panel.innerHTML = buildTab(tab); tabPanels.set(tab, panel);
        }
        element('peer-policy-content')?.replaceChildren(panel);
        const allowance = /** @type {HTMLInputElement | null} */ (element('peer-policy-allowance')); if (allowance && allowanceEdited) allowance.value = allowanceDraft;
        const query = /** @type {HTMLInputElement | null} */ (element('peer-policy-search')); if (query) query.value = search;
        const status = /** @type {HTMLSelectElement | null} */ (element('peer-policy-filter-status')); if (status) status.value = statusFilter;
        const size = /** @type {HTMLSelectElement | null} */ (element('peer-policy-page-size')); if (size) size.value = pageSize ? String(pageSize) : 'all';
        const activitySearch = /** @type {HTMLInputElement | null} */ (element('peer-policy-activity-search')); if (activitySearch) activitySearch.value = activityQuery;
        const kind = /** @type {HTMLSelectElement | null} */ (element('peer-policy-activity-kind')); if (kind) kind.value = activityKind;
        for (const control of dialog.body.querySelectorAll('[data-policy-tab]')) {
            const selected = control.getAttribute('data-policy-tab') === tab;
            control.setAttribute('aria-selected', String(selected)); control.setAttribute('tabindex', selected ? '0' : '-1');
        }
        if (tab === 'activity' && !activitySnapshot.length) activitySnapshot = snapshot?.events.slice() || [];
        render();
        if (content) content.scrollTop = tabScroll.get(tab) || 0;
        if (tab === 'settings' && !annotations && !annotationReading) void loadAnnotations();
    }

    /** @param {HTMLElement | null} target @param {string} value */
    function setText(target, value) {
        if (target && target.textContent !== value) target.textContent = value;
    }

    function render() {
        if (!dialog?.isOpen()) return;
        const data = snapshot;
        const focused = /** @type {HTMLElement | null} */ (document.activeElement);
        if (focused?.dataset.policyAction && focused.dataset.address) focusAfterSave = { action: focused.dataset.policyAction, address: focused.dataset.address };
        const disabled = saving || suspended || !state.authenticated || !data?.available;
        for (const control of dialog.body.querySelectorAll('button, input, select')) {
            if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.disabled = control.hasAttribute('data-policy-tab') ? suspended || !state.authenticated : disabled;
        }
        const refreshButton = /** @type {HTMLButtonElement | null} */ (element('peer-policy-refresh'));
        if (refreshButton) refreshButton.disabled = saving || reading || suspended || !state.authenticated;
        setText(element('peer-policy-result'), message);
        if (!data) {
            setText(element('peer-policy-status'), suspended ? 'Management paused. Return to this window to revalidate access and refresh status.' : reading ? 'Loading policy status…' : 'Policy status is unavailable. Refresh before changing settings.');
            setText(element('peer-policy-readiness'), '');
            setText(element('peer-policy-counts'), '');
            setText(element('peer-policy-peers'), 'No current policy evidence available.');
            setText(element('peer-policy-kept'), '');
            setText(element('peer-policy-events'), '');
            setText(element('peer-policy-page-count'), '');
            setText(element('peer-policy-proposal'), '');
            setText(element('peer-policy-results'), '');
            peersHtml = ''; keptHtml = ''; eventsHtml = '';
            return;
        }
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
        if (allowance && document.activeElement !== allowance) allowance.value = allowanceEdited ? allowanceDraft : String(data.config.listener_allowance);
        setText(element('peer-policy-limits'), `Grace ${fmtDuration(data.limits.grace_seconds)}; continuous observation ${fmtDuration(data.limits.observation_seconds)}; at most one attempt per ${fmtDuration(data.limits.attempt_interval_seconds)} and ${data.limits.max_attempts_per_hour} per hour.`);
        setText(element('peer-policy-next-action'), data.next_action_at === null ? `State: ${data.effective_state}. AS diversity ${data.as_diversity_available ? 'assessed' : 'unavailable; network and connection protections still apply'}.`
            : `State: ${data.effective_state}. Next permitted attempt: ${new Date(data.next_action_at * 1000).toLocaleTimeString()}.`);

        if (activeTab === 'connections') renderPeers(data, disabled);
        const keptContainer = element('peer-policy-kept');
        if (annotationAddress && !data.config.keep_addresses.includes(annotationAddress)) {
            annotationAddress = ''; element('peer-policy-annotation-editor')?.replaceChildren();
            annotationError = 'The Keep exception was removed. Its note editor has been closed.';
        }
        const nextKept = data.config.keep_addresses.length ? data.config.keep_addresses.map(address => {
            const annotation = annotations?.annotations.find(item => item.address === address);
            return `<div class="peer-policy-kept-row"><div><code>${escape(address)}</code>${annotation?.label ? `<strong class="peer-policy-keep-label">${escape(annotation.label)}</strong>` : ''}${annotation?.note ? `<p class="peer-policy-note">${escape(annotation.note)}</p>` : ''}</div><div><button type="button" class="dialog-btn" data-policy-action="annotation" data-address="${escape(address)}"${disabled || !annotations || annotationSaving ? ' disabled' : ''}>Edit name / note</button> <button type="button" class="dialog-btn" data-policy-action="remove" data-address="${escape(address)}"${disabled ? ' disabled' : ''}>Remove exception</button></div></div>`;
        }).join('')
            : '<p class="peer-policy-note">No Keep exceptions.</p>';
        if (keptContainer && nextKept !== keptHtml) { keptContainer.innerHTML = nextKept; keptHtml = nextKept; }
        setText(element('peer-policy-annotation-result'), annotationReading ? 'Loading names and notes…' : annotationSaving ? 'Saving name and note…' : annotationError);
        for (const control of dialog.body.querySelectorAll('#peer-policy-annotation-editor input, #peer-policy-annotation-editor textarea, #peer-policy-annotation-editor button')) {
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLButtonElement) control.disabled = disabled || annotationSaving || !annotations;
        }
        if (activeTab === 'activity') renderActivity(data, disabled);
        const proposal = data.proposal;
        setText(element('peer-policy-proposal'), proposal ? `Conditional plan: ${proposal.planned} planned, ${proposal.retained} retained, ${proposal.blocked} blocked. Every proposed action requires fresh revalidation; conditions and timing can change.` : '');
        if (!saving && focusAfterSave) {
            const anchor = focusAfterSave;
            const candidates = [...dialog.body.querySelectorAll('button[data-policy-action]')];
            const target = candidates.find(control => control instanceof HTMLButtonElement && !control.disabled && control.dataset.address === anchor.address && control.dataset.policyAction === anchor.action) ||
                candidates.find(control => control instanceof HTMLButtonElement && !control.disabled && control.dataset.address === anchor.address);
            if (target instanceof HTMLButtonElement) target.focus({ preventScroll: true });
            else (element('peer-policy-keep-address') || element('peer-policy-tab-settings'))?.focus({ preventScroll: true });
            focusAfterSave = null;
        }
        const results = data.results;
        setText(element('peer-policy-results'), results ? `Last ${fmtDuration(results.window_seconds)}: ${results.accepted_requests} accepted requests; ${results.observed_departures} observed departures; ${results.same_host_returns} same-address returns.` : '');
    }

    /** @param {Snapshot} data @param {boolean} disabled */
    function renderActivity(data, disabled) {
        if (activityPage === 0) { activitySnapshot = data.events.slice(); activityNew = 0; }
        else {
            const ids = new Set(activitySnapshot.map(item => item.id));
            activityNew = data.events.filter(item => !ids.has(item.id)).length;
        }
        const needle = activityQuery.trim().toLocaleLowerCase();
        const filtered = activitySnapshot.filter(item => (!activityKind || item.kind === activityKind) && (!needle || item.address?.toLocaleLowerCase().includes(needle)));
        const pages = Math.max(1, Math.ceil(filtered.length / 20)); activityPage = Math.min(Math.max(0, activityPage), pages - 1);
        const start = activityPage * 20;
        const next = filtered.slice(start, start + 20).map(event => `<div class="peer-policy-event"><time>${escape(new Date(event.time * 1000).toLocaleString())}</time><strong>${escape(eventNames[event.kind])}</strong>${event.address ? `<code>${escape(event.address)}</code>` : ''}<span>${escape(event.reason)}</span></div>`).join('') || '<p class="peer-policy-note">No decisions match these filters.</p>';
        const container = element('peer-policy-events'); if (container && next !== eventsHtml) { container.innerHTML = next; eventsHtml = next; }
        setText(element('peer-policy-activity-count'), `${filtered.length ? start + 1 : 0}–${Math.min(start + 20, filtered.length)} of ${filtered.length} decisions`);
        const previous = /** @type {HTMLButtonElement | null} */ (element('peer-policy-activity-previous'));
        const nextButton = /** @type {HTMLButtonElement | null} */ (element('peer-policy-activity-next'));
        if (previous) previous.disabled = disabled || activityPage === 0;
        if (nextButton) nextButton.disabled = disabled || activityPage >= pages - 1;
        const newest = element('peer-policy-activity-new');
        if (newest) { newest.hidden = !activityNew; newest.textContent = `${activityNew} new decisions — show latest`; }
        const oldest = activitySnapshot.at(-1);
        setText(element('peer-policy-activity-coverage'), oldest ? `Oldest retained decision: ${new Date(oldest.time * 1000).toLocaleString()}. This log retains at most 200 decisions for up to seven days and may be incomplete. Older pages stay fixed until you show latest.` : 'No retained decisions. Recorded history starts only when an administrator enables recording.');
    }

    async function loadAnnotations() {
        const current = generation;
        if (!isCurrent(current) || annotationReading || annotationSaving) return;
        const operation = ++annotationRevision;
        annotationReading = true;
        try {
            const data = await /** @type {Promise<Annotations>} */ (getAdminJson('/api/peer-policy/annotations', { signal: requests.signal }));
            if (isCurrent(current) && operation === annotationRevision) { annotations = data; annotationError = ''; }
        } catch (error) { if (isCurrent(current) && operation === annotationRevision) annotationError = `Names and notes unavailable: ${errorMessage(error)}`; }
        finally { if (isCurrent(current)) { annotationReading = false; render(); } }
    }

    /** @param {string} address */
    function editAnnotation(address) {
        if (!annotations) return;
        annotationAddress = address;
        const item = annotations.annotations.find(value => value.address === address);
        const editor = element('peer-policy-annotation-editor');
        if (editor) editor.innerHTML = `<form id="peer-policy-annotation-form" class="peer-policy-annotation-form"><strong>${escape(address)}</strong><label>Name<input id="peer-policy-annotation-label" maxlength="80" value="${escape(item?.label || '')}"></label><label>Note<textarea id="peer-policy-annotation-note" maxlength="512" rows="3">${escape(item?.note || '')}</textarea></label><div><button type="submit" class="dialog-btn">Save name / note</button> <button type="button" class="dialog-btn" id="peer-policy-annotation-cancel">Cancel</button></div></form>`;
        element('peer-policy-annotation-label')?.focus({ preventScroll: true });
    }

    async function saveAnnotation() {
        if (!annotations || annotationSaving || !snapshot?.config.keep_addresses.includes(annotationAddress)) return;
        const label = /** @type {HTMLInputElement | null} */ (element('peer-policy-annotation-label'));
        const note = /** @type {HTMLTextAreaElement | null} */ (element('peer-policy-annotation-note'));
        if (!label || !note || !label.reportValidity() || !note.reportValidity()) return;
        const current = generation, expected = annotations.revision;
        annotationRevision++; annotationSaving = true; annotationError = ''; render();
        try {
            const data = await /** @type {Promise<Annotations>} */ (postAdminJson('/api/peer-policy/annotations', { expected_revision: expected, address: annotationAddress, label: label.value, note: note.value }, { signal: requests.signal }));
            if (!isCurrent(current)) return;
            annotations = data; annotationError = 'Name and note saved. Policy settings are unchanged.';
            element('peer-policy-annotation-editor')?.replaceChildren(); annotationAddress = '';
        } catch (error) {
            if (isCurrent(current)) {
                annotationError = error instanceof HttpError && error.status === 409 ? 'Names and notes changed in another browser. Latest values loaded; review before saving again.' : errorMessage(error);
                if (error instanceof HttpError && error.status === 409) {
                    try {
                        const data = await /** @type {Promise<Annotations>} */ (getAdminJson('/api/peer-policy/annotations', { signal: requests.signal }));
                        if (isCurrent(current)) annotations = data;
                    } catch { if (isCurrent(current)) annotations = null; }
                }
            }
        } finally { if (isCurrent(current)) { annotationSaving = false; render(); } }
    }

    /** @param {Snapshot} data @param {boolean} disabled */
    function renderPeers(data, disabled) {
        const active = /** @type {HTMLElement | null} */ (document.activeElement);
        const focusAction = active?.dataset.policyAction, focusAddress = active?.dataset.address;
        const focusEvidence = active?.closest('details[data-peer-key]')?.getAttribute('data-peer-key');
        const proposals = new Map((data.proposal?.entries || []).map(entry => [`${entry.peer_id}|${entry.address}`, entry]));
        if (sortedSnapshot !== data) {
            const order = { candidate: 0, observing: 1, unknown: 2, protected: 3 };
            sortedPeers = [...data.peers].sort((a, b) => {
                const first = proposals.get(`${a.peer_id}|${a.address}`), second = proposals.get(`${b.peer_id}|${b.address}`);
                const firstOrder = first?.action === 'planned' ? first.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
                const secondOrder = second?.action === 'planned' ? second.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
                return firstOrder - secondOrder || order[a.status] - order[b.status];
            });
            sortedSnapshot = data;
            const currentKeys = new Set(data.peers.map(peer => `${peer.peer_id}|${peer.address}`));
            for (const key of evidenceOpen) if (!currentKeys.has(key)) evidenceOpen.delete(key);
            filteredKey = '';
        }
        const networks = [...new Set([...data.peers.map(peer => peer.network), ...(networkFilter ? [networkFilter] : [])])].sort();
        const networkSelect = /** @type {HTMLSelectElement | null} */ (element('peer-policy-filter-network'));
        const options = '<option value="">All networks</option>' + networks.map(network => `<option value="${escape(network)}">${escape(network)}</option>`).join('');
        if (networkSelect && networkSelect.innerHTML !== options) { networkSelect.innerHTML = options; networkSelect.value = networkFilter; }
        const key = JSON.stringify([search, statusFilter, networkFilter]);
        if (filteredKey !== key) {
            const needle = search.trim().toLocaleLowerCase();
            filteredPeers = sortedPeers.filter(peer => (!statusFilter || peer.status === statusFilter) && (!networkFilter || peer.network === networkFilter) &&
                (!needle || `${peer.address} ${peer.subver || ''}`.toLocaleLowerCase().includes(needle)));
            filteredKey = key;
        }
        const size = pageSize || Math.max(1, filteredPeers.length);
        const pages = Math.max(1, Math.ceil(filteredPeers.length / size));
        page = Math.max(0, Math.min(page, pages - 1));
        const start = page * size;
        setText(element('peer-policy-page-count'), filteredPeers.length ? `${start + 1}–${Math.min(start + size, filteredPeers.length)} of ${filteredPeers.length} matching connections (${data.peers.length} total)` : `0 matching connections (${data.peers.length} total)`);
        const previous = /** @type {HTMLButtonElement | null} */ (element('peer-policy-page-previous'));
        const next = /** @type {HTMLButtonElement | null} */ (element('peer-policy-page-next'));
        if (previous) previous.disabled = disabled || page === 0;
        if (next) next.disabled = disabled || page >= pages - 1;
        const statuses = { candidate: 'Listener candidate', protected: 'Protected', observing: 'Observing', unknown: 'Insufficient evidence' };
        const nextPeers = filteredPeers.length ? filteredPeers.slice(start, start + size).map(peer => {
            const kept = data.config.keep_addresses.includes(peer.host);
            const peerKey = `${peer.peer_id}|${peer.address}`;
            const proposal = proposals.get(`${peer.peer_id}|${peer.address}`);
            const plan = proposal ? `<p class="peer-policy-proposed"><strong>${proposal.action === 'planned' ? `Planned #${escape(proposal.order)}` : proposal.action === 'retained' ? 'Retained' : 'Blocked'}</strong>${proposal.proposed_at === null ? '' : ` · ${escape(new Date(proposal.proposed_at * 1000).toLocaleString())}`}: ${escape(proposal.reason)}</p>` : '';
            return `<article class="peer-policy-card" data-status="${escape(peer.status)}"><div class="peer-policy-card-heading"><strong>${escape(peer.address)}</strong><span>${escape(statuses[peer.status])}</span></div>` +
                `<p class="peer-policy-software">Software: ${escape(peer.subver?.trim() || 'Unknown')}</p>${plan}` +
                `<p>${escape(peer.reason)}</p><details class="peer-policy-evidence" data-peer-key="${escape(peerKey)}"${evidenceOpen.has(peerKey) ? ' open' : ''}><summary>Decision evidence</summary>` +
                `<dl><dt>Current evidence</dt><dd>${escape(peer.reason)}</dd><dt>Connection age / grace</dt><dd>${peer.connection_age_seconds === null ? 'Unknown' : escape(fmtDuration(peer.connection_age_seconds))} / ${escape(fmtDuration(data.limits.grace_seconds))}</dd>` +
                `<dt>Quiet observation / required</dt><dd>${escape(fmtDuration(peer.observed_seconds))} / ${escape(fmtDuration(data.limits.observation_seconds))}</dd><dt>Additional time required</dt><dd>${escape(fmtDuration(peer.remaining_seconds))}</dd>` +
                `<dt>Network</dt><dd>${escape(peer.network)}</dd><dt>Policy revision / listener allowance</dt><dd>${escape(data.revision)} / ${escape(data.config.listener_allowance)}</dd><dt>AS diversity information</dt><dd>${data.as_diversity_available ? 'Assessed for this evaluation' : 'Unavailable; network and connection protections still apply'}</dd></dl></details>` +
                `<button type="button" class="dialog-btn" data-policy-action="keep" data-address="${escape(peer.host)}"${disabled || kept || !peer.host || data.config.keep_addresses.length >= 128 ? ' disabled' : ''}>${kept ? 'Kept' : 'Keep address'}</button></article>`;
        }).join('') : `<p class="peer-policy-note">${data.peers.length ? 'No connections match these filters.' : 'No connection evidence yet. Off collects no policy history.'}</p>`;
        const container = element('peer-policy-peers');
        if (container && nextPeers !== peersHtml) {
            container.innerHTML = nextPeers; peersHtml = nextPeers;
            if (focusAction && focusAddress) {
                const replacement = [...dialog?.body.querySelectorAll('button[data-policy-action]') || []].find(control =>
                    control instanceof HTMLButtonElement && control.dataset.address === focusAddress && !control.disabled &&
                    (control.dataset.policyAction === focusAction || control.dataset.policyAction === 'remove'));
                if (replacement instanceof HTMLButtonElement) replacement.focus({ preventScroll: true });
            } else if (focusEvidence) {
                const details = [...container.querySelectorAll('details[data-peer-key]')].find(node => node.getAttribute('data-peer-key') === focusEvidence);
                /** @type {HTMLElement | null} */ (details?.querySelector('summary') || null)?.focus({ preventScroll: true });
            }
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
            if (data && operation === readRevision && !saving) { snapshot = data; adoptStatus(data); }
        } catch (error) {
            if (isCurrent(current) && operation === readRevision) { snapshot = null; toolbarStatus = null; renderToolbar(); message = errorMessage(error); }
        } finally {
            if (isCurrent(current)) { reading = false; render(); schedule(); if (activeTab === 'settings') void loadAnnotations(); }
        }
    }

    /** @param {Config} config @param {boolean} [savesAllowance] */
    async function save(config, savesAllowance = false) {
        const current = generation;
        if (!isCurrent(current) || saving || !snapshot?.available) return;
        const active = /** @type {HTMLElement | null} */ (document.activeElement);
        if (active?.dataset.policyAction && active.dataset.address) focusAfterSave = { action: active.dataset.policyAction, address: active.dataset.address };
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
            if (savesAllowance) { allowanceEdited = false; allowanceDraft = ''; }
            adoptStatus(data);
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
                if (data) { snapshot = data; adoptStatus(data); }
            } catch { if (isCurrent(current)) { snapshot = null; toolbarStatus = null; renderToolbar(); } }
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
        dialog.body.addEventListener('toggle', event => {
            const target = event.target;
            if (!(target instanceof HTMLDetailsElement) || !target.dataset.peerKey) return;
            if (target.open) evidenceOpen.add(target.dataset.peerKey);
            else evidenceOpen.delete(target.dataset.peerKey);
        }, true);
        dialog.body.addEventListener('keydown', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.dataset.policyTab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const keys = /** @type {(keyof typeof tabNames)[]} */ (Object.keys(tabNames));
            const index = keys.indexOf(activeTab);
            const key = event.key === 'Home' ? keys[0] : event.key === 'End' ? keys.at(-1) : keys[(index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length];
            if (key) { selectTab(key); element(`peer-policy-tab-${key}`)?.focus(); }
        });
        dialog.body.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const control = target.closest('button');
            if (!(control instanceof HTMLButtonElement) || control.disabled) return;
            const tab = control.dataset.policyTab;
            if (tab && Object.hasOwn(tabNames, tab)) { selectTab(/** @type {keyof typeof tabNames} */ (tab)); return; }
            if (control.dataset.policyMonitoring) { document.dispatchEvent(new CustomEvent('bpm:open-monitoring', { detail: { tab: control.dataset.policyMonitoring, kind: 'policy' } })); return; }
            if (control.id === 'peer-policy-saved-views') { document.dispatchEvent(new CustomEvent('bpm:open-saved-views', { detail: { kind: 'policy' } })); return; }
            if (saving || !snapshot) return;
            if (control.id === 'peer-policy-refresh') { void refresh(); return; }
            if (control.id === 'peer-policy-page-previous') { page--; render(); return; }
            if (control.id === 'peer-policy-page-next') { page++; render(); return; }
            if (control.id === 'peer-policy-activity-previous') { activityPage--; render(); return; }
            if (control.id === 'peer-policy-activity-next') { activityPage++; render(); return; }
            if (control.id === 'peer-policy-activity-new') { activityPage = 0; render(); return; }
            if (control.id === 'peer-policy-annotation-cancel') { annotationAddress = ''; element('peer-policy-annotation-editor')?.replaceChildren(); return; }
            const mode = control.dataset.policyMode;
            if (mode === 'automatic') { confirmAutomatic(); return; }
            if (mode === 'off' || mode === 'preview') {
                void save({ ...snapshot.config, mode, keep_addresses: [...snapshot.config.keep_addresses] }); return;
            }
            const action = control.dataset.policyAction, address = control.dataset.address;
            if (action === 'annotation' && address) { editAnnotation(address); return; }
            if (action && address) {
                const keep = snapshot.config.keep_addresses;
                void save({ ...snapshot.config, keep_addresses: action === 'keep' ? [...new Set([...keep, address])] : keep.filter(value => value !== address) });
            }
        });
        /** @param {Event} event */
        const change = event => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
            if (input.id === 'peer-policy-allowance') { allowanceEdited = true; allowanceDraft = input.value; return; }
            if (input.id === 'peer-policy-search') search = input.value;
            else if (input.id === 'peer-policy-filter-status') statusFilter = input.value;
            else if (input.id === 'peer-policy-filter-network') networkFilter = input.value;
            else if (input.id === 'peer-policy-page-size') pageSize = input.value === 'all' ? 0 : Number(input.value);
            else if (input.id === 'peer-policy-activity-search') { activityQuery = input.value; activityPage = 0; render(); return; }
            else if (input.id === 'peer-policy-activity-kind') { activityKind = input.value; activityPage = 0; render(); return; }
            else return;
            page = 0; render();
        };
        dialog.body.addEventListener('input', change);
        dialog.body.addEventListener('change', change);
        dialog.body.addEventListener('submit', event => {
            event.preventDefault();
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || !snapshot) return;
            if (form.id === 'peer-policy-annotation-form') { void saveAnnotation(); return; }
            if (form.id === 'peer-policy-allowance-form') {
                const input = /** @type {HTMLInputElement | null} */ (element('peer-policy-allowance'));
                if (input?.reportValidity()) void save({ ...snapshot.config, listener_allowance: Number(input.value), keep_addresses: [...snapshot.config.keep_addresses] }, true);
            } else if (form.id === 'peer-policy-keep-form') {
                const input = /** @type {HTMLInputElement | null} */ (element('peer-policy-keep-address'));
                const address = input?.value.trim();
                if (input?.reportValidity() && address && snapshot.config.keep_addresses.length < 128) void save({ ...snapshot.config, keep_addresses: [...new Set([...snapshot.config.keep_addresses, address])] });
            }
        });
    }

    async function open() {
        if (!initialized || opening || dialog?.isOpen()) return;
        requests.abort();
        requests = new AbortController();
        const current = ++generation;
        opening = true;
        stopStatus(false);
        button?.setAttribute('aria-busy', 'true');
        try {
            await management.unlock(requests.signal);
            if (current !== generation || requests.signal.aborted || !state.authenticated || document.hidden) return;
            dialog = modal.open({ document, id: 'peer-policy-modal', title: 'Inbound policy', maxWidth: 760,
                bodyClass: 'modal-body peer-policy-body', initialHtml: build(), onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
            bind();
            selectTab(activeTab);
            await refresh();
        } catch (error) {
            if (current !== generation || requests.signal.aborted) return;
            dialog = modal.open({ document, id: 'peer-policy-modal', title: 'Inbound policy', maxWidth: 540,
                initialHtml: `<p role="alert">${escape(errorMessage(error))}</p>`, onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
        } finally {
            if (current === generation) { opening = false; button?.removeAttribute('aria-busy'); if (button) button.disabled = !state.available; renderToolbar(); if (!dialog) resumeStatus(); }
        }
    }

    /** @param {number} current */
    function statusIsCurrent(current) {
        return initialized && pageActive && !opening && !dialog?.isOpen() && current === statusGeneration && !statusRequests.signal.aborted && state.authenticated && !state.signal.aborted && !document.hidden;
    }

    function renderToolbar() {
        if (toolbar) toolbar.hidden = !initialized || !state.authenticated || document.hidden;
        if (badge) {
            const data = toolbarStatus;
            setText(badge, data ? `${modeNames[data.mode]} · ${data.effective_state}` : 'Policy status unknown');
            badge.title = data?.reason || 'Refresh policy status before relying on the displayed mode.';
            badge.dataset.state = data?.effective_state || 'unknown';
        }
        if (quickOff) {
            quickOff.disabled = stopping || opening || Boolean(dialog?.isOpen()) || !state.authenticated || !state.available || toolbarStatus?.mode === 'off';
            setText(quickOff, stopping ? 'Turning Off…' : 'Turn policy Off');
        }
    }

    /** @param {boolean} [clear] */
    function stopStatus(clear = true) {
        statusGeneration++; statusReadRevision++;
        statusRequests.abort();
        if (statusTimer !== null) clock.clearTimeout(statusTimer);
        statusTimer = null;
        statusReading = false; stopping = false;
        if (clear) toolbarStatus = null;
        renderToolbar();
    }

    function resumeStatus() {
        if (!initialized || !pageActive || !state.authenticated || state.signal.aborted || document.hidden || opening || dialog?.isOpen()) return;
        stopStatus(false);
        statusRequests = new AbortController();
        void refreshStatus();
    }

    /** @param {Snapshot} data */
    function adoptStatus(data) {
        statusReadRevision++;
        if (toolbarStatus && data.revision < toolbarStatus.revision) return;
        toolbarStatus = { available: data.available, revision: data.revision, mode: data.config.mode, effective_state: data.effective_state, reason: data.reason };
        renderToolbar();
    }

    function scheduleStatus() {
        if (statusTimer !== null) clock.clearTimeout(statusTimer);
        statusTimer = null;
        if (statusIsCurrent(statusGeneration)) statusTimer = clock.setTimeout(() => { statusTimer = null; void refreshStatus(); }, POLL_MS);
    }

    async function refreshStatus() {
        const current = statusGeneration;
        if (!statusIsCurrent(current) || statusReading || stopping) return;
        statusReading = true;
        const operation = ++statusReadRevision;
        try {
            const data = await /** @type {Promise<Status>} */ (getAdminJson('/api/peer-policy/status', { signal: statusRequests.signal }, 15_000));
            if (statusIsCurrent(current) && operation === statusReadRevision && (!toolbarStatus || data.revision >= toolbarStatus.revision)) toolbarStatus = data;
        } catch {
            if (statusIsCurrent(current) && operation === statusReadRevision) toolbarStatus = null;
        } finally {
            if (statusIsCurrent(current)) { statusReading = false; renderToolbar(); scheduleStatus(); }
        }
    }

    async function turnOff() {
        const current = statusGeneration;
        if (!statusIsCurrent(current) || stopping) return;
        statusReadRevision++;
        stopping = true; renderToolbar();
        try {
            const latest = await /** @type {Promise<Snapshot>} */ (getAdminJson('/api/peer-policy', { signal: statusRequests.signal }, 15_000));
            if (!statusIsCurrent(current)) return;
            const data = latest.config.mode === 'off' ? latest : await /** @type {Promise<Snapshot>} */ (postAdminJson('/api/peer-policy', {
                expected_revision: latest.revision, config: { ...latest.config, mode: 'off', keep_addresses: [...latest.config.keep_addresses] },
            }, { signal: statusRequests.signal }, 15_000));
            if (!statusIsCurrent(current)) return;
            adoptStatus(data);

        } catch {
            if (statusIsCurrent(current)) {
                toolbarStatus = null;

            }
        } finally {
            if (statusIsCurrent(current)) { stopping = false; renderToolbar(); scheduleStatus(); }
        }
    }

    function suspendPanel() {
        if (!dialog) return;
        confirmation?.close(false);
        confirmation = null;
        generation++;
        requests.abort();
        clearTimer();
        suspended = true;
        reading = false; saving = false;
        snapshot = null; sortedSnapshot = null; sortedPeers = []; filteredPeers = [];
        message = '';
        annotations = null; annotationRevision++; annotationReading = false; annotationSaving = false; annotationAddress = ''; annotationError = '';
        activitySnapshot = []; activityNew = 0; tabPanels.clear(); peersHtml = ''; keptHtml = ''; eventsHtml = '';
        selectTab(activeTab);
        render();
    }

    function resumePanel() {
        if (!dialog?.isOpen() || !state.authenticated || document.hidden) return;
        suspended = false;
        requests = new AbortController();
        void refresh();
    }

    /** @param {Event} event */
    function onClick(event) { event.stopPropagation(); void open(); }
    /** @param {Event} event */
    function onToolbarClick(event) { event.stopPropagation(); }
    function onVisibility() {
        if (document.hidden) { stopStatus(); suspendPanel(); }
        else if (state.authenticated) {
            if (dialog?.isOpen()) resumePanel();
            else resumeStatus();
        }
    }
    function onPageHide() { pageActive = false; stopStatus(); close(false); }
    function onPageShow() { pageActive = true; resumeStatus(); }
    function onQuickOff() { void turnOff(); }

    function init() {
        if (initialized) return;
        initialized = true; pageActive = true;
        button = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-inbound-policy'));
        toolbar = document.getElementById('peer-policy-toolbar');
        badge = document.getElementById('peer-policy-badge');
        quickOff = /** @type {HTMLButtonElement | null} */ (document.getElementById('peer-policy-quick-off'));
        button?.addEventListener('click', onClick);
        toolbar?.addEventListener('click', onToolbarClick);
        quickOff?.addEventListener('click', onQuickOff);
        document.addEventListener('visibilitychange', onVisibility);
        document.defaultView?.addEventListener('pagehide', onPageHide);
        document.defaultView?.addEventListener('pageshow', onPageShow);
        unsubscribe = management.subscribe(next => {
            const previous = state;
            state = next;
            if (!next.authenticated) {
                stopStatus();
                if (next.suspended && dialog) suspendPanel();
                else if (dialog || opening) close(false);
            } else if (next.revision !== previous.revision || !previous.authenticated) {
                stopStatus();
                if (dialog && suspended) resumePanel();
                else if (dialog && next.revision !== previous.revision) close(false);
                else resumeStatus();
            }
            renderToolbar();
            if (button) {
                button.disabled = !next.available;
                button.title = next.available ? 'Preview and configure inbound listener cleanup' : 'Configure an administrator token to use inbound policy';
            }
        });
    }

    function dispose() {
        initialized = false;
        stopStatus();
        close(false);
        renderToolbar();
        unsubscribe?.();
        unsubscribe = null;
        button?.removeEventListener('click', onClick);
        toolbar?.removeEventListener('click', onToolbarClick);
        quickOff?.removeEventListener('click', onQuickOff);
        document.removeEventListener('visibilitychange', onVisibility);
        document.defaultView?.removeEventListener('pagehide', onPageHide);
        document.defaultView?.removeEventListener('pageshow', onPageShow);
    }

    /** @returns {PolicyView} */
    function captureView() {
        return { query: search, status: /** @type {PolicyView['status']} */ (statusFilter), network: networkFilter, page_size: /** @type {PolicyView['page_size']} */ (pageSize) };
    }
    /** @param {PolicyView} view */
    async function applyView(view) {
        if (!view || typeof view.query !== 'string' || !['', 'candidate', 'protected', 'observing', 'unknown'].includes(view.status) || !['', 'ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'].includes(view.network) || ![0, 10, 20, 30, 40, 50].includes(view.page_size)) throw new Error('This policy view is unsupported.');
        if (!dialog?.isOpen()) await open();
        if (!dialog?.isOpen() || !state.authenticated) throw new Error('Unlock management before applying a view.');
        search = view.query; statusFilter = view.status; networkFilter = view.network; pageSize = view.page_size; page = 0; filteredKey = '';
        selectTab('connections');
        const input = /** @type {HTMLInputElement | null} */ (element('peer-policy-search')); if (input) input.value = search;
        const status = /** @type {HTMLSelectElement | null} */ (element('peer-policy-filter-status')); if (status) status.value = statusFilter;
        const network = /** @type {HTMLSelectElement | null} */ (element('peer-policy-filter-network')); if (network) network.value = networkFilter;
        const size = /** @type {HTMLSelectElement | null} */ (element('peer-policy-page-size')); if (size) size.value = pageSize ? String(pageSize) : 'all';
        render();
    }
    return Object.freeze({ init, close, dispose, captureView, applyView });
}
