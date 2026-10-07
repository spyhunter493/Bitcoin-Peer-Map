import { errorMessage, postJson } from '../core/api.js';
import { required } from '../core/dom.js';
import * as modal from '../core/modal.js';
import { formatGeoAge } from '../core/geo.js';

/** @param {number} seconds */
function formatAge(seconds) {
    return formatGeoAge(seconds);
}

/** @param {import('../types').GeoStats} stats */
function renderStats(stats) {
    const status = stats.status || 'unknown';
    const statusClass = status === 'ok' ? 'ok' : status === 'disabled' ? 'disabled' : 'error';
    let html = `<div class="modal-row"><span class="modal-label" title="Database health status">Status</span><span class="geodb-status-badge ${statusClass}">${modal.escapeHtml(status.toUpperCase())}</span></div>`;
    if (stats.entries != null) html += modal.row('Entries', stats.entries.toLocaleString(), 'Total number of IP geolocation records in the database');
    if (stats.size_bytes != null) html += modal.row('Size', `${(stats.size_bytes / 1e6).toFixed(1)} MB`, 'Database file size on disk');
    if (stats.newest_age_seconds != null) {
        const age = formatAge(stats.newest_age_seconds);
        html += modal.row('Newest Entry', age, 'Age of the newest geolocation record', `${age} old`);
    } else if (stats.newest_age_days != null) {
        html += modal.row('Newest Entry', `${stats.newest_age_days} days`, 'Age of the newest geolocation record');
    }
    if (stats.oldest_age_days != null) html += modal.row('Oldest Entry', `${stats.oldest_age_days} days`, 'Age of the oldest geolocation record');
    if (stats.db_path) html += modal.row('Path', stats.db_path, 'File system path to the database');
    html += modal.row('Local database', stats.auto_lookup ? 'On' : 'Off', 'Use the persistent GeoIP database. External API lookups are controlled separately.', undefined, stats.auto_lookup ? 'modal-val-ok' : 'modal-val-warn');
    html += toggleRow('Auto-update', 'geodb-autoupdate-toggle', stats.auto_update, 'Update the geolocation database at startup and hourly, even when the dashboard is closed');
    html += toggleRow('API Lookup', 'geodb-dbonly-toggle', !stats.db_only_mode, 'Look up missing, stale, or unknown-age public IPs through ip-api.com');
    html += '<p style="color:var(--text-secondary);font-size:11px;line-height:1.5">Locations become stale after 30 days from their record timestamp. Cached locations stay visible during refresh. API Lookup sends missing, stale, or unknown-age public peer IPs to ip-api.com over unencrypted HTTP. Turn it off to keep peer lookups local. This choice survives restarts.</p>';
    html += '<div id="geodb-provider-health"></div>';
    html += '<button class="geodb-update-btn" id="geodb-update-btn">Update Database</button><div class="geodb-result" id="geodb-result" role="status"></div>';
    return html;
}

/** @param {string} label @param {string} id @param {boolean} enabled @param {string} title */
function toggleRow(label, id, enabled, title) {
    return `<div class="modal-row"><span class="modal-label" title="${modal.escapeHtml(title)}">${modal.escapeHtml(label)}</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle"><input type="checkbox" id="${id}" aria-label="${modal.escapeHtml(label)}" ${enabled ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
}

/**
 * @param {{getNodeInfo: () => import('../types').NodeDisplayInfo | null; refreshInfo: () => Promise<void>; document?: Document; clock?: Pick<Window, 'setInterval' | 'clearInterval'>; nowSeconds?: () => number}} options
 */
export function create({ getNodeInfo, refreshInfo, document = globalThis.document, clock = document.defaultView || globalThis, nowSeconds = () => Date.now() / 1000 }) {
    /** @type {import('../types').ModalController | null} */
    let currentDialog = null;
    function dispose() { currentDialog?.close(false); currentDialog = null; }
    function open() {
        const dialog = modal.open({ id: 'geodb-modal', title: 'GeoIP DB', maxWidth: 480, document, onClose: () => { currentDialog = null; } });
        currentDialog = dialog;
        const stats = getNodeInfo()?.geo_db_stats;
        if (!stats) {
            dialog.body.textContent = 'No GeoDB data available';
            return;
        }
        dialog.body.innerHTML = renderStats(stats);
        const providerHealth = required('#geodb-provider-health', dialog.body);
        function renderProviderHealth() {
            const info = getNodeInfo();
            const provider = info?.providers?.geoip;
            const now = nowSeconds();
            let html = modal.row('GeoIP provider', provider?.state || 'Unknown', 'Health of ip-api.com, independent of the Google reachability probe');
            if (info?.geo_db_only_mode) html += modal.row('External lookups', 'Off', 'Cached locations are used without contacting ip-api.com');
            if (provider?.last_success_at != null) html += modal.row('Last success', formatGeoAge(Math.max(0, now - provider.last_success_at)) + ' ago');
            if (provider?.retry_at != null && provider.retry_at > now) html += modal.row('Retry in', formatGeoAge(provider.retry_at - now));
            if (provider?.last_error) html += modal.row('Last error', provider.last_error);
            if (providerHealth.innerHTML !== html) providerHealth.innerHTML = html;
        }
        renderProviderHealth();
        const healthTimer = clock.setInterval(renderProviderHealth, 1000);
        dialog.signal?.addEventListener('abort', () => clock.clearInterval(healthTimer), { once: true });
        const result = required('#geodb-result', dialog.body);

        /** @param {string} message @param {boolean} success */
        function showResult(message, success) {
            if (!dialog.isOpen()) return;
            result.textContent = message;
            result.style.color = success ? 'var(--ok)' : 'var(--err)';
        }

        /** @param {'auto-update' | 'db-only'} setting @param {string} selector @param {boolean} previous */
        function bindToggle(setting, selector, previous) {
            /** @type {HTMLInputElement} */
            const input = required(selector, dialog.body);
            let saved = previous;
            input.addEventListener('change', async () => {
                input.disabled = true;
                result.textContent = '';
                try {
                    const enabled = setting === 'auto-update' ? input.checked : !input.checked;
                    /** @type {{success: boolean; auto_update?: boolean; geo_db_only_mode?: boolean}} */
                    const data = await postJson(`/api/geodb/${setting}`, { enabled }, { signal: dialog.signal });
                    const value = setting === 'auto-update' ? data.auto_update : data.geo_db_only_mode;
                    if (!data.success || typeof value !== 'boolean') throw new Error('Could not save setting');
                    saved = setting === 'auto-update' ? value : !value;
                    input.checked = saved;
                    await refreshInfo();
                    const info = getNodeInfo();
                    if (info) {
                        if (setting === 'auto-update') info.geo_db_stats.auto_update = value;
                        else {
                            info.geo_db_only_mode = value;
                            info.geo_db_stats.db_only_mode = value;
                        }
                    }
                } catch (error) {
                    input.checked = saved;
                    showResult(`Setting was not saved: ${errorMessage(error)}`, false);
                } finally {
                    input.disabled = false;
                    if (dialog.isOpen() && document.activeElement === document.body) input.focus({ preventScroll: true });
                }
            });
        }
        bindToggle('auto-update', '#geodb-autoupdate-toggle', stats.auto_update);
        bindToggle('db-only', '#geodb-dbonly-toggle', !stats.db_only_mode);

        /** @type {HTMLButtonElement} */
        const update = required('#geodb-update-btn', dialog.body);
        update.addEventListener('click', async () => {
            update.disabled = true;
            result.textContent = 'Updating...';
            result.style.color = 'var(--text-secondary)';
            try {
                /** @type {{success: boolean; message?: string}} */
                const data = await postJson('/api/geodb/update', undefined, { signal: dialog.signal });
                showResult(data.message || (data.success ? 'Done' : 'Failed'), data.success);
                if (data.success) await refreshInfo();
            } catch (error) {
                showResult(`Error: ${errorMessage(error)}`, false);
            } finally {
                update.disabled = false;
                if (dialog.isOpen() && document.activeElement === document.body) update.focus({ preventScroll: true });
            }
        });
    }
    return Object.freeze({ open, dispose });
}
