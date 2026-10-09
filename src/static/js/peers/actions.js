import { queryAll, query, closest } from '../core/dom.js';
import * as BPMApi from '../core/api.js';
import * as BPMModal from '../core/modal.js';
import { create as createLifecycle } from '../core/lifecycle.js';
const modal = BPMModal;

/**
 * @param {{refreshPeers: () => void | Promise<void>; document?: Document;
 * clock?: Parameters<typeof createLifecycle>[0]}} options
 */
function create(options) {
    const document = options.document || globalThis.document;
    const lifecycle = createLifecycle(options.clock || document.defaultView || globalThis);
    const requests = new AbortController();
    const api = BPMApi;
    const refreshPeers = options.refreshPeers;
    /** @type {HTMLElement | null} */
    let bansButton = null;
    /** @type {import('../types').ModalController | null} */
    let banDialog = null;
    /** @type {Set<import('../types').ModalController>} */
    const dialogs = new Set();
    /** @type {HTMLElement | null} */
    let notification = null;
    let banContents = lifecycle.replace('ban-contents');

    /** @param {import('../types').ModalController} dialog */
    const dialogSignal = dialog => dialog.signal
        ? AbortSignal.any([requests.signal, dialog.signal]) : requests.signal;
    /** @param {import('../types').ModalController} dialog */
    const isCurrentBanDialog = dialog => lifecycle.isActive() && dialog.isOpen() && dialog === banDialog;

    /**
     * @param {HTMLElement | null} button
     */
    function init(button) {
        if (!lifecycle.isActive() || bansButton || !button || button.dataset.bpmPeerActionsBound === 'true') return;
        bansButton = button;
        bansButton.dataset.bpmPeerActionsBound = 'true';
        lifecycle.listen(bansButton, 'click', (event) => {
            event.stopPropagation();
            if (banDialog && banDialog.isOpen()) closeBanModal();
            else openBanModal();
        });
    }

    function openBanModal() {
        if (!lifecycle.isActive()) return;
        if (bansButton) bansButton.classList.add('active');
        const dialog = modal.open({
            document,
            id: 'ban-modal',
            closeId: 'ban-modal-close',
            bodyId: 'ban-modal-body',
            title: 'Banned IPs',
            overlayClass: 'ban-modal-overlay',
            boxClass: 'ban-modal-box',
            headerClass: 'ban-modal-header',
            titleClass: 'ban-modal-title',
            closeClass: 'ban-modal-close',
            bodyClass: 'ban-modal-body',
            initialHtml: '<div class="ban-list-loading">Loading ban list...</div>',
            onClose: () => {
                dialogs.delete(dialog);
                banContents.dispose();
                if (bansButton) bansButton.classList.remove('active');
                if (banDialog === dialog) banDialog = null;
            },
        });
        banDialog = dialog;
        dialogs.add(dialog);
        fetchBanList(dialog);
        return dialog;
    }

    function closeBanModal() {
        if (banDialog) banDialog.close();
    }

    /**
     * @param {import('../types').ModalController | null} dialog
     */
    async function fetchBanList(dialog) {
        if (!dialog || !isCurrentBanDialog(dialog)) return;
        try {
            /** @type {{success: boolean; bans: import('../types').BanEntry[]; error?: string; detail?: string}} */
            const data = await api.getJson('/api/bans', { signal: dialogSignal(dialog) });
            if (!isCurrentBanDialog(dialog)) return;
            if (!data || data.success !== true || !Array.isArray(data.bans)) throw new Error(data?.error || data?.detail || 'Invalid ban list response');
            if (isCurrentBanDialog(dialog)) {
                renderBanList(dialog, data.bans);
            }
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return;
            if (isCurrentBanDialog(dialog)) {
                dialog.body.innerHTML = `<div class="ban-list-loading" style="color:var(--err)">Failed to load bans: ${modal.escapeHtml(api.errorMessage(error))}</div>`;
            }
        }
    }

    /**
     * @param {import('../types').ModalController} dialog
     * @param {import('../types').BanEntry[]} bans
     */
    function renderBanList(dialog, bans) {
        if (!isCurrentBanDialog(dialog)) return;
        banContents = lifecycle.replace('ban-contents');
        let html = '<div class="ban-list-header">';
        html += `<span class="ban-list-title">Banned IPs (${bans.length})</span>`;
        if (bans.length) {
            html += '<button type="button" class="toolbar-btn ban-clear-all" id="ban-clear-all">Clear All Bans</button>';
        }
        html += '</div>';

        if (!bans.length) {
            html += '<div class="ban-list-empty">No banned IPs</div>';
        } else {
            html += '<div class="ban-modal-table-wrap"><table class="peer-table ban-table"><thead><tr>';
            html += '<th>Address</th><th>Ban Created</th><th>Ban Until</th><th>Actions</th>';
            html += '</tr></thead><tbody>';
            for (const ban of bans) {
                const address = ban.address || '\u2014';
                const safeAddress = modal.escapeHtml(address);
                const created = ban.ban_created ? new Date(ban.ban_created * 1000).toLocaleString() : '\u2014';
                const until = ban.banned_until ? new Date(ban.banned_until * 1000).toLocaleString() : '\u2014';
                html += '<tr>';
                html += `<td title="${safeAddress}">${safeAddress}</td>`;
                html += `<td>${modal.escapeHtml(created)}</td>`;
                html += `<td>${modal.escapeHtml(until)}</td>`;
                html += `<td><button type="button" class="peer-action-btn ban-unban" data-addr="${safeAddress}">Unban</button></td>`;
                html += '</tr>';
            }
            html += '</tbody></table></div>';
        }
        dialog.body.innerHTML = html;

        queryAll('.ban-unban', dialog.body).forEach((button) => {
            banContents.listen(button, 'click', async () => {
                if (!isCurrentBanDialog(dialog)) return;
                const address = button.dataset.addr;
                try {
                    /** @type {import('../types').ActionResponse} */
                    const data = await api.postJson('/api/peer/unban', { address }, { signal: dialogSignal(dialog) });
                    if (!isCurrentBanDialog(dialog)) return;
                    if (data.success) {
                        showResult(`Unbanned ${address}`, true);
                        fetchBanList(dialog);
                    } else {
                        showResult(`Unban failed: ${data.error}`, false);
                    }
                } catch (error) {
                    if (!isCurrentBanDialog(dialog)) return;
                    if (error instanceof Error && error.name === 'AbortError') return;
                    showResult(`Error: ${api.errorMessage(error)}`, false);
                }
            });
        });

        const clearButton = query('#ban-clear-all', dialog.overlay);
        if (clearButton) {
            banContents.listen(clearButton, 'click', async () => {
                if (!isCurrentBanDialog(dialog)) return;
                if (!globalThis.confirm('Clear ALL bans? This cannot be undone.')) return;
                try {
                    /** @type {import('../types').ActionResponse} */
                    const data = await api.postJson('/api/bans/clear', undefined, { signal: dialogSignal(dialog) });
                    if (!isCurrentBanDialog(dialog)) return;
                    if (data.success) {
                        showResult('All bans cleared', true);
                        fetchBanList(dialog);
                    } else {
                        showResult(`Clear failed: ${data.error}`, false);
                    }
                } catch (error) {
                    if (!isCurrentBanDialog(dialog)) return;
                    if (error instanceof Error && error.name === 'AbortError') return;
                    showResult(`Error: ${api.errorMessage(error)}`, false);
                }
            });
        }
    }

    /** @param {number} peerId
     * @param {string} network */
    function showDisconnectDialog(peerId, network) {
        if (!lifecycle.isActive()) return;
        const listeners = lifecycle.replace('disconnect-dialog');
        const canBan = network === 'ipv4' || network === 'ipv6';
        const safePeerId = modal.escapeHtml(peerId);
        const dialog = modal.open({
            document,
            id: 'disconnect-dialog',
            title: `Disconnect Peer ${peerId}`,
            ariaLabel: `Disconnect peer ${peerId}`,
            overlayClass: 'dialog-overlay',
            boxClass: 'dialog-box',
            showHeader: false,
            initialFocusSelector: '[data-choice="disconnect"]',
            onClose: () => { dialogs.delete(dialog); listeners.dispose(); },
            contentHtml: `
                <div class="dialog-title">Disconnect Peer ${safePeerId}</div>
                <div class="dialog-text">Choose an action for this peer:</div>
                <div class="dialog-actions">
                    <button type="button" class="dialog-btn dialog-btn-disconnect" data-choice="disconnect">Disconnect Only</button>
                    ${canBan ? '<button type="button" class="dialog-btn dialog-btn-ban" data-choice="ban">Disconnect + Ban 24h</button>' : ''}
                    <button type="button" class="dialog-btn dialog-btn-cancel" data-choice="cancel">Cancel</button>
                </div>`,
        });
        dialogs.add(dialog);

        listeners.listen(dialog.overlay, 'click', async (event) => {
            const button = closest('.dialog-btn', event.target);
            if (!button) return;
            const choice = button.dataset.choice;
            dialog.close();
            if (!lifecycle.isActive() || (choice !== 'ban' && choice !== 'disconnect')) return;

            try {
                if (choice === 'ban') {
                    /** @type {import('../types').ActionResponse} */
                    // Confirmation closes before dispatch; the action belongs to the dashboard.
                    const banData = await api.postJson('/api/peer/ban', { peer_id: peerId }, { signal: requests.signal });
                    if (!lifecycle.isActive()) return;
                    if (!banData.success) {
                        showResult(`Ban failed: ${banData.error}`, false);
                        return;
                    }
                    showResult(`Banned ${banData.banned_ip} for 24 hours; disconnection requested`, true);
                } else {
                    /** @type {import('../types').ActionResponse} */
                    const data = await api.postJson('/api/peer/disconnect', { peer_id: peerId }, { signal: requests.signal });
                    if (!lifecycle.isActive()) return;
                    showResult(data.success ? `Disconnected peer ${peerId}` : `Failed: ${data.error}`, data.success);
                }
                lifecycle.timeout(() => { void refreshPeers(); }, 1000);
            } catch (error) {
                if (!lifecycle.isActive() || (error instanceof Error && error.name === 'AbortError')) return;
                showResult(`Error: ${api.errorMessage(error)}`, false);
            }
        });
        return dialog;
    }

    /**
     * @param {string} message
     * @param {boolean} success
     */
    function showResult(message, success) {
        if (!lifecycle.isActive()) return;
        const existing = document.getElementById('action-notification');
        if (existing) existing.remove();
        const current = document.createElement('div');
        notification = current;
        current.id = 'action-notification';
        current.setAttribute('role', success ? 'status' : 'alert');
        current.setAttribute('aria-live', success ? 'polite' : 'assertive');
        current.style.cssText =
            'position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:400;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;pointer-events:none;backdrop-filter:blur(12px);border:1px solid;';
        current.style.color = success ? 'var(--ok)' : 'var(--err)';
        current.style.borderColor = success ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)';
        current.style.background = 'rgba(10,14,20,0.92)';
        current.textContent = message;
        document.body.appendChild(current);
        lifecycle.replace('notification').timeout(() => {
            current.remove();
            if (notification === current) notification = null;
        }, 5000);
    }

    function dispose() {
        if (!lifecycle.isActive()) return;
        lifecycle.dispose();
        requests.abort();
        for (const dialog of dialogs) dialog.close(false);
        dialogs.clear();
        notification?.remove();
        notification = null;
        if (bansButton) {
            delete bansButton.dataset.bpmPeerActionsBound;
            bansButton.classList.remove('active');
        }
        bansButton = null;
        banDialog = null;
    }

    return Object.freeze({
        init,
        openBanModal,
        closeBanModal,
        showDisconnectDialog,
        showResult,
        dispose,
    });
}

export { create };
