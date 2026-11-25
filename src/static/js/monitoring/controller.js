import { getAdminJson, postAdminJson, errorMessage, HttpError } from '../core/api.js';
import * as modal from '../core/modal.js';
import { coverage, date, chart, diagnosticRows, eventRows } from './presentation.js';

/** @typedef {'history'|'trends'|'health'|'alerts'} Tab */
/** @typedef {import('../../../shared/api.generated').HistorySettings} HistorySettings */
/** @typedef {import('../../../shared/api.generated').AlertInbox} AlertInbox */
/** @typedef {import('../../../shared/api.generated').AlertSettings} AlertSettings */
/** @typedef {import('../../../shared/api.generated').MonitoringDiagnostics} Diagnostics */
const escape = modal.escapeHtml;
const tabs = ['history', 'trends', 'health', 'alerts'];
const ruleLabels = {
    peer_data: 'Peer data unavailable for 60 seconds',
    low_outbound: 'Fewer than four outbound peers for two minutes',
    policy_failure: 'Inbound policy paused by an RPC failure or storage fault',
    recording_failure: 'Enabled history recording loses data or cannot save',
};

/** Administrator monitoring has its own request generation; background reads
 * never unlock management and no private response survives a revoked session.
 * @param {{management:import('../types').ManagementController;document?:Document}} options */
export function create({ management, document = globalThis.document }) {
    const clock = document.defaultView || window;
    let state = management.getState(), initialized = false, opening = false, saving = false;
    let generation = 0, readVersion = 0, tabVersion = 0, pollVersion = 0;
    let requests = new AbortController(), reads = new AbortController();
    /** @type {ReturnType<typeof modal.open> | null} */
    let dialog = null;
    /** @type {HTMLButtonElement | null} */
    let button = null;
    /** @type {HTMLElement | null} */
    let badge = null;
    /** @type {number | null} */
    let timer = null;
    /** @type {(() => void) | null} */
    let unsubscribe = null;
    /** @type {Tab} */
    let tab = 'history';
    let period = '24h', source = '', kind = '', search = '', cursor = '', transport = 'ipv4';
    let polling = false;
    /** @type {string[]} */
    let previousCursors = [];
    /** @type {string | null} */
    let nextCursor = null;
    /** @type {HistorySettings | null} */
    let settings = null;
    /** @type {AlertSettings | null} */
    let alertSettings = null;
    /** @type {AlertInbox | null} */
    let inbox = null;
    /** @type {Diagnostics | null} */
    let diagnostics = null;
    let message = '';

    function stopTimer() { if (timer !== null) clock.clearTimeout(timer); timer = null; }
    function authorized() { return initialized && state.authenticated && !state.signal.aborted && !document.hidden; }
    /** @param {number} current */
    function current(current) { return authorized() && current === generation && !requests.signal.aborted && Boolean(dialog?.isOpen()); }
    /** @param {string} id */
    function element(id) { return dialog?.body.querySelector(`#${id}`) || null; }
    function renderMessage() { const target = element('monitoring-message'); if (target) target.textContent = message; }
    function renderBadge() {
        if (!button || !badge) return;
        button.hidden = !state.authenticated;
        const count = inbox?.incidents.filter(item => item.state === 'active' && item.acknowledged_at === null).length ?? null;
        badge.hidden = count === 0 || !state.authenticated;
        badge.textContent = count === null ? '?' : String(count);
        button.title = count === null ? 'Monitoring; alert status is unavailable' : `History, trends, health, and alerts${count ? ` — ${count} active unacknowledged alert(s)` : ''}`;
    }
    function schedule() {
        stopTimer();
        if (authorized()) timer = clock.setTimeout(() => { timer = null; void poll(); }, 10000);
    }
    async function poll() {
        if (!authorized() || polling) return;
        const operation = ++pollVersion;
        polling = true;
        const signal = state.signal;
        try {
            const data = await /** @type {Promise<AlertInbox>} */ (getAdminJson('/api/alerts', { signal }, 15000));
            if (operation === pollVersion && authorized()) inbox = data;
        } catch { if (!signal.aborted && authorized()) inbox = null; }
        finally { if (operation === pollVersion) polling = false; }
        if (signal.aborted || !authorized()) return;
        renderBadge();
        if (dialog?.isOpen() && tab === 'alerts') renderInbox();
        schedule();
    }
    function wipe() {
        generation++; readVersion++; tabVersion++;
        requests.abort(); reads.abort();
        dialog = null; opening = false; saving = false; settings = null; alertSettings = null; diagnostics = null;
        message = ''; tab = 'history'; period = '24h'; source = kind = search = cursor = ''; transport = 'ipv4';
        previousCursors = []; nextCursor = null;
        button?.setAttribute('aria-expanded', 'false');
    }
    /** @param {boolean} [restoreFocus] */
    function close(restoreFocus = true) { if (dialog) dialog.close(restoreFocus); else wipe(); }
    function clearPrivate() { pollVersion++; polling = false; close(false); inbox = null; renderBadge(); stopTimer(); }
    function build() {
        return `<div class="monitoring-tabs" role="tablist" aria-label="Monitoring sections">${tabs.map(name =>
            `<button type="button" class="dialog-btn" role="tab" id="monitoring-tab-${name}" data-monitoring-tab="${name}" aria-controls="monitoring-${name}" aria-selected="${name === tab}" tabindex="${name === tab ? 0 : -1}">${name[0].toUpperCase() + name.slice(1)}</button>`).join('')}</div>` +
            '<p id="monitoring-message" class="monitoring-message" role="alert"></p>' +
            tabs.map(name => `<div id="monitoring-${name}" class="monitoring-panel" role="tabpanel" aria-labelledby="monitoring-tab-${name}"${name === tab ? '' : ' hidden'}></div>`).join('');
    }
    function periods() {
        return `<label>Period<select id="monitoring-window">${[['1h', 'Last hour'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([value, label]) =>
            `<option value="${value}"${value === period ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
    }
    function renderRecording() {
        if (!settings) return '';
        return `<div class="monitoring-recording"><strong>History recording: ${settings.enabled ? 'On' : 'Off'}</strong>` +
            `<button type="button" class="dialog-btn" id="monitoring-recording-toggle"${saving ? ' disabled' : ''}>${settings.enabled ? 'Disable recording' : 'Enable recording'}</button></div>` +
            '<p class="monitoring-note">Recording continues with the browser closed. Disabling it keeps existing records until their 30-day expiry. New recordings start from a fresh baseline.</p>';
    }
    function historyShell() {
        return renderRecording() + `<form id="monitoring-history-filters" class="monitoring-form">${periods()}` +
            `<label>Source<select id="monitoring-source"><option value="">All sources</option>${['peer', 'manual', 'policy'].map(name => `<option value="${name}"${name === source ? ' selected' : ''}>${name}</option>`).join('')}</select></label>` +
            `<label>Event kind<input id="monitoring-kind" maxlength="64" placeholder="All event kinds" value="${escape(kind)}"></label>` +
            `<label>Address or reason<input id="monitoring-search" type="search" maxlength="256" value="${escape(search)}"></label>` +
            '<button class="dialog-btn" type="submit">Apply filters</button></form><div id="monitoring-history-results" aria-live="polite"></div>' +
            '<div class="monitoring-pagination"><button type="button" class="dialog-btn" id="monitoring-previous">Previous</button><span id="monitoring-page-label"></span><button type="button" class="dialog-btn" id="monitoring-next">Next</button><button type="button" class="dialog-btn" id="monitoring-history-refresh">Refresh</button></div>';
    }
    function bindRecording() {
        element('monitoring-recording-toggle')?.addEventListener('click', () => {
            if (!settings) return;
            const payload = { expected_revision: settings.revision, enabled: !settings.enabled };
            void mutate('/api/history/settings', payload, async () => {
                settings = await /** @type {Promise<HistorySettings>} */ (getAdminJson('/api/history/settings', { signal: requests.signal }, 15000));
                await refreshTab();
            });
        });
    }
    function resetPage() { cursor = ''; previousCursors = []; nextCursor = null; }
    function bindHistory() {
        bindRecording();
        element('monitoring-history-filters')?.addEventListener('submit', event => {
            event.preventDefault();
            period = /** @type {HTMLSelectElement} */ (element('monitoring-window')).value;
            source = /** @type {HTMLSelectElement} */ (element('monitoring-source')).value;
            kind = /** @type {HTMLInputElement} */ (element('monitoring-kind')).value.trim();
            search = /** @type {HTMLInputElement} */ (element('monitoring-search')).value.trim();
            resetPage(); void loadHistory();
        });
        element('monitoring-next')?.addEventListener('click', () => { if (nextCursor) { previousCursors.push(cursor); cursor = nextCursor; void loadHistory(); } });
        element('monitoring-previous')?.addEventListener('click', () => { if (previousCursors.length) { cursor = previousCursors.pop() || ''; void loadHistory(); } });
        element('monitoring-history-refresh')?.addEventListener('click', () => { resetPage(); void loadHistory(); });
    }
    async function loadHistory() {
        const version = ++readVersion, active = generation;
        reads.abort(); reads = new AbortController();
        const signal = AbortSignal.any([reads.signal, requests.signal]);
        const target = element('monitoring-history-results');
        if (target) target.setAttribute('aria-busy', 'true');
        try {
            const query = new URLSearchParams({ window: period, limit: '50' });
            if (cursor) query.set('cursor', cursor);
            if (source) query.set('source', source);
            if (kind) query.set('kind', kind);
            if (search) query.set('search', search);
            const data = await /** @type {Promise<import('../../../shared/api.generated').HistoryPage>} */ (getAdminJson(`/api/history/events?${query}`, { signal }, 15000));
            if (!current(active) || signal.aborted || version !== readVersion || tab !== 'history') return;
            nextCursor = data.next_cursor;
            if (target) target.innerHTML = coverage(data.coverage) + eventRows(data.events);
            const previous = /** @type {HTMLButtonElement | null} */ (element('monitoring-previous'));
            const next = /** @type {HTMLButtonElement | null} */ (element('monitoring-next'));
            if (previous) previous.disabled = !previousCursors.length;
            if (next) next.disabled = !nextCursor;
            const label = element('monitoring-page-label');
            if (label) label.textContent = `Page ${previousCursors.length + 1} · ${data.events.length} event(s)`;
        } catch (error) { if (current(active) && !signal.aborted && version === readVersion) { message = errorMessage(error); renderMessage(); } }
        finally { if (version === readVersion) target?.removeAttribute('aria-busy'); }
    }
    async function renderTrends() {
        const active = generation, operation = tabVersion;
        const query = new URLSearchParams({ window: period });
        const [data, summary] = await Promise.all([
            /** @type {Promise<import('../../../shared/api.generated').HistoryTrends>} */ (getAdminJson(`/api/history/trends?${query}`, { signal: requests.signal }, 15000)),
            /** @type {Promise<import('../../../shared/api.generated').HistorySummary>} */ (getAdminJson(`/api/history/summary?${query}`, { signal: requests.signal }, 15000)),
        ]);
        if (!current(active) || tab !== 'trends' || operation !== tabVersion) return;
        const transportNames = { ipv4: 'Public IPv4', ipv6: 'Public IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
        const target = element('monitoring-trend-results');
        if (target) target.innerHTML = coverage(data.coverage) +
            chart(data.buckets.map(bucket => ({ time: bucket.time, first: bucket.inbound, second: bucket.outbound })), { title: 'Observed peer counts', first: 'Inbound', second: 'Outbound' }) +
            chart(data.buckets.map(bucket => ({ time: bucket.time, first: bucket.networks[transport] ?? 0, second: bucket.inbound + bucket.outbound })), { title: 'Observed transport counts', first: transportNames[/** @type {keyof typeof transportNames} */ (transport)], second: 'All peers' }) +
            chart(data.buckets.map(bucket => ({ time: bucket.time, first: bucket.rx_bps, second: bucket.tx_bps })), { title: 'Bitcoin P2P traffic', first: 'Download', second: 'Upload', traffic: true }) +
            '<h3>Recorded policy outcomes</h3>' +
            `<div class="monitoring-summary"><span>RPC accepted: <strong>${escape(summary.accepted_requests)}</strong></span><span>Observed departures: <strong>${escape(summary.observed_departures)}</strong></span><span>Same-address returns: <strong>${escape(summary.same_host_returns)}</strong></span></div>` +
            coverage(summary.coverage) + '<p class="monitoring-note">Accepted requests are not proof of disconnection. Later departures do not prove their cause, and the same address can represent another client.</p>';
    }
    async function copyDiagnostics() {
        if (!diagnostics || !dialog?.isOpen()) return;
        const active = generation;
        const text = JSON.stringify(diagnostics, null, 2);
        try {
            if (!clock.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await clock.navigator.clipboard.writeText(text);
            if (!current(active)) return;
            message = 'Redacted diagnostics copied.'; renderMessage();
        } catch {
            if (!current(active)) return;
            const area = /** @type {HTMLTextAreaElement | null} */ (element('monitoring-report'));
            if (area) { area.hidden = false; area.value = text; area.focus(); area.select(); }
            message = 'Select and copy the redacted report below.'; renderMessage();
        }
    }
    function renderInbox() {
        const target = element('monitoring-incidents');
        if (!target) return;
        if (!inbox) { target.textContent = 'Alert status is unavailable. Refresh before relying on the inbox.'; return; }
        const html = `<p class="monitoring-note">${inbox.persistence_degraded ? 'Persistence is degraded; active alerts are held in memory.' : 'Acknowledgments are shared across administrator devices.'}</p>` +
            (inbox.incidents.length ? inbox.incidents.map(incident => `<article class="monitoring-alert" data-state="${escape(incident.state)}"><h3>${escape(incident.rule.replaceAll('_', ' '))} · ${escape(incident.state)}</h3>` +
                `<p>${escape(incident.message)}</p><p>Raised ${escape(date(incident.raised_at))}${incident.resolved_at === null ? '' : ` · Resolved ${escape(date(incident.resolved_at))}`}</p>` +
                (incident.acknowledged_at === null ? `<button type="button" class="dialog-btn" data-alert-ack="${escape(incident.id)}"${saving ? ' disabled' : ''}>Acknowledge</button>` : `<p>Acknowledged ${escape(date(incident.acknowledged_at))}</p>`) + '</article>').join('') : '<p class="monitoring-empty">No alert incidents have been recorded.</p>');
        if (target.innerHTML !== html) target.innerHTML = html;
    }
    function renderRules() {
        const target = element('monitoring-alert-rules');
        if (!target || !alertSettings) return;
        target.innerHTML = `<h3>Preset alert rules</h3><div class="monitoring-rules">${Object.entries(ruleLabels).map(([key, label]) =>
            `<label><input type="checkbox" data-alert-rule="${key}"${alertSettings?.rules[/** @type {keyof typeof ruleLabels} */ (key)] ? ' checked' : ''}>${escape(label)}</label>`).join('')}</div><button class="dialog-btn" type="submit">Save rules</button>`;
    }
    /** @param {string} url @param {unknown} payload @param {() => Promise<void>} reload */
    async function mutate(url, payload, reload) {
        if (saving || !current(generation)) return;
        const active = generation;
        saving = true; message = ''; renderMessage();
        const signal = requests.signal;
        try {
            await postAdminJson(url, payload, { signal }, 15000);
            if (!current(active)) return;
            message = 'Settings saved.';
        } catch (error) {
            if (!current(active)) return;
            message = error instanceof HttpError && error.status === 409 ? 'Settings changed elsewhere. Latest values loaded; review before saving again.' : `Save could not be confirmed: ${errorMessage(error)}. Latest values are being reloaded.`;
        } finally {
            if (current(active)) {
                saving = false;
                try { await reload(); } catch (error) { if (current(active)) message += ` ${errorMessage(error)}`; }
                if (current(active)) renderMessage();
            }
        }
    }
    async function refreshTab() {
        if (!current(generation)) return;
        const active = generation, requestedTab = tab, operation = ++tabVersion;
        reads.abort(); readVersion++;
        for (const name of tabs) {
            const panel = element(`monitoring-${name}`);
            if (panel instanceof HTMLElement) { panel.hidden = name !== tab; panel.innerHTML = ''; }
            const control = element(`monitoring-tab-${name}`);
            control?.setAttribute('aria-selected', String(name === tab));
            control?.setAttribute('tabindex', name === tab ? '0' : '-1');
        }
        const panel = element(`monitoring-${tab}`);
        if (!panel) return;
        panel.innerHTML = '<p class="monitoring-note" role="status">Loading…</p>';
        try {
            if (tab === 'history') {
                settings = await /** @type {Promise<HistorySettings>} */ (getAdminJson('/api/history/settings', { signal: requests.signal }, 15000));
                if (!current(active) || tab !== requestedTab || operation !== tabVersion) return;
                panel.innerHTML = historyShell(); bindHistory(); await loadHistory();
            } else if (tab === 'trends') {
                panel.innerHTML = `<form id="monitoring-trend-filters" class="monitoring-form">${periods()}<label>Transport<select id="monitoring-transport">${[['ipv4', 'Public IPv4'], ['ipv6', 'Public IPv6'], ['onion', 'Tor'], ['i2p', 'I2P'], ['cjdns', 'CJDNS']].map(([value, label]) => `<option value="${value}"${value === transport ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button class="dialog-btn" type="submit">Show trends</button></form><div id="monitoring-trend-results"></div>`;
                element('monitoring-trend-filters')?.addEventListener('submit', event => { event.preventDefault(); period = /** @type {HTMLSelectElement} */ (element('monitoring-window')).value; transport = /** @type {HTMLSelectElement} */ (element('monitoring-transport')).value; void refreshTab(); });
                await renderTrends();
            } else if (tab === 'health') {
                const data = await /** @type {Promise<Diagnostics>} */ (getAdminJson('/api/diagnostics', { signal: requests.signal }, 15000));
                if (!current(active) || tab !== requestedTab || operation !== tabVersion) return;
                diagnostics = data;
                panel.innerHTML = '<button type="button" class="dialog-btn" id="monitoring-copy-diagnostics">Copy diagnostics</button><button type="button" class="dialog-btn" id="monitoring-health-refresh">Refresh</button><p class="monitoring-note">Cached component status. Disabled optional services are not outages.</p>' +
                    diagnosticRows(/** @type {Record<string,unknown>} */ (data)) + '<textarea id="monitoring-report" class="monitoring-report" aria-label="Redacted diagnostic report" readonly hidden></textarea>';
                element('monitoring-copy-diagnostics')?.addEventListener('click', () => { void copyDiagnostics(); });
                element('monitoring-health-refresh')?.addEventListener('click', () => { void refreshTab(); });
            } else {
                const [rules, alerts] = await Promise.all([
                    /** @type {Promise<AlertSettings>} */ (getAdminJson('/api/alerts/settings', { signal: requests.signal }, 15000)),
                    /** @type {Promise<AlertInbox>} */ (getAdminJson('/api/alerts', { signal: requests.signal }, 15000)),
                ]);
                if (!current(active) || tab !== requestedTab || operation !== tabVersion) return;
                alertSettings = rules; inbox = alerts; renderBadge();
                panel.innerHTML = '<form id="monitoring-alert-rules"></form><div id="monitoring-incidents"></div>';
                renderRules(); renderInbox();
                element('monitoring-alert-rules')?.addEventListener('submit', event => {
                    event.preventDefault(); if (!alertSettings) return;
                    const next = { ...alertSettings.rules };
                    for (const input of panel.querySelectorAll('[data-alert-rule]')) if (input instanceof HTMLInputElement) next[/** @type {keyof typeof ruleLabels} */ (input.dataset.alertRule)] = input.checked;
                    void mutate('/api/alerts/settings', { expected_revision: alertSettings.revision, rules: next }, async () => { await refreshTab(); });
                });
            }
        } catch (error) {
            if (current(active) && tab === requestedTab && operation === tabVersion) { message = errorMessage(error); panel.innerHTML = '<p class="monitoring-note">This section is unavailable. Close and reopen Monitoring to retry.</p>'; renderMessage(); }
        }
    }
    /** @param {Tab} [initialTab] @param {{source?:string}} [filter] */
    async function open(initialTab = 'history', filter = {}) {
        if (!initialized || opening) return;
        if (dialog?.isOpen()) { tab = initialTab; source = filter.source || ''; resetPage(); await refreshTab(); return; }
        requests = new AbortController();
        const active = ++generation; opening = true;
        try {
            await management.unlock(requests.signal);
            if (active !== generation || requests.signal.aborted || !authorized()) return;
            tab = initialTab; source = filter.source || '';
            dialog = modal.open({ document, id: 'monitoring-modal', title: 'Monitoring', maxWidth: 980, bodyClass: 'modal-body monitoring-body', initialHtml: build(), onClose: wipe });
            button?.setAttribute('aria-expanded', 'true');
            dialog.body.addEventListener('click', event => {
                if (!(event.target instanceof Element)) return;
                const selected = event.target.closest('[data-monitoring-tab]')?.getAttribute('data-monitoring-tab');
                if (selected && tabs.includes(selected)) { tab = /** @type {Tab} */ (selected); message = ''; renderMessage(); void refreshTab(); }
                const id = event.target.closest('[data-alert-ack]')?.getAttribute('data-alert-ack');
                if (id) void mutate('/api/alerts', { id }, async () => {
                    inbox = await /** @type {Promise<AlertInbox>} */ (getAdminJson('/api/alerts', { signal: requests.signal }, 15000));
                    renderBadge(); renderInbox();
                });
            });
            dialog.body.addEventListener('keydown', event => {
                if (!(event.target instanceof Element) || event.target.getAttribute('role') !== 'tab' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const index = tabs.indexOf(tab);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tab = /** @type {Tab} */ (tabs[next]);
                /** @type {HTMLElement | null} */ (element(`monitoring-tab-${tab}`))?.focus();
                void refreshTab();
            });
            await refreshTab();
        } catch (error) { if (active === generation && !requests.signal.aborted) { message = errorMessage(error); renderMessage(); } }
        finally { if (active === generation) opening = false; }
    }
    function onButton() { void open(); }
    /** @param {Event} event */
    function onRequest(event) {
        const detail = /** @type {CustomEvent<{tab?:Tab;kind?:string}>} */ (event).detail;
        if (!detail || !tabs.includes(detail.tab || '')) return;
        void open(detail.tab, { source: detail.kind === 'policy' ? 'policy' : '' });
    }
    function onVisibility() { stopTimer(); if (document.hidden) close(false); else if (authorized()) void poll(); }
    function onPageHide() { clearPrivate(); }
    function init() {
        if (initialized) return;
        initialized = true;
        button = /** @type {HTMLButtonElement | null} */ (document.getElementById('btn-monitoring'));
        badge = document.getElementById('monitoring-alert-count');
        button?.addEventListener('click', onButton);
        unsubscribe = management.subscribe(next => { state = next; stopTimer(); if (!state.authenticated || state.signal.aborted) clearPrivate(); else { renderBadge(); if (authorized()) void poll(); } });
        document.addEventListener('visibilitychange', onVisibility);
        document.addEventListener('bpm:open-monitoring', onRequest);
        clock.addEventListener('pagehide', onPageHide);
        renderBadge(); if (authorized()) void poll();
    }
    function dispose() {
        clearPrivate(); initialized = false;
        unsubscribe?.(); unsubscribe = null;
        button?.removeEventListener('click', onButton);
        document.removeEventListener('visibilitychange', onVisibility); clock.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('bpm:open-monitoring', onRequest);
    }
    return Object.freeze({ init, open, close, dispose });
}
