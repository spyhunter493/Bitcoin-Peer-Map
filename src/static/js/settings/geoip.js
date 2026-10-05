import { errorMessage, postJson } from '../core/api.js';
import { required } from '../core/dom.js';
import * as modal from '../core/modal.js';

/** @param {number} seconds */
function formatAge(seconds) {
    if (seconds >= 86400) return `${Math.floor(seconds / 86400)} days`;
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${seconds}s`;
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
    html += toggleRow('API Lookup', 'geodb-dbonly-toggle', !stats.db_only_mode, 'Look up public IPs missing from the local database through ip-api.com');
    html += '<p style="color:var(--text-secondary);font-size:11px;line-height:1.5">API Lookup sends public peer IPs missing from this database to ip-api.com over unencrypted HTTP. Turn it off to keep peer lookups local. This choice survives restarts.</p>';
    html += '<button class="geodb-update-btn" id="geodb-update-btn">Update Database</button><div class="geodb-result" id="geodb-result" role="status"></div>';
    return html;
}

/** @param {string} label @param {string} id @param {boolean} enabled @param {string} title */
function toggleRow(label, id, enabled, title) {
    return `<div class="modal-row"><span class="modal-label" title="${modal.escapeHtml(title)}">${modal.escapeHtml(label)}</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle"><input type="checkbox" id="${id}" aria-label="${modal.escapeHtml(label)}" ${enabled ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
}

/**
 * @param {{getNodeInfo: () => import('../types').NodeInfo | null; refreshInfo: () => Promise<void>}} options
 */
export function create({ getNodeInfo, refreshInfo }) {
    function open() {
        const dialog = modal.open({ id: 'geodb-modal', title: 'GeoIP DB', maxWidth: 480 });
        const stats = getNodeInfo()?.geo_db_stats;
        if (!stats) {
            dialog.body.textContent = 'No GeoDB data available';
            return;
        }
        dialog.body.innerHTML = renderStats(stats);
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
                    /** @type {{success: boolean; auto_update?: boolean; geo_db_only_mode?: boolean}} */
                    const data = await postJson(`/api/geodb/toggle-${setting}`, undefined, { signal: dialog.signal });
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
    return Object.freeze({ open });
}
