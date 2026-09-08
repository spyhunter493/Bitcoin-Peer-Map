/* Peer management UI: ban list, disconnect confirmation, and action feedback. */
(function (global) {
    'use strict';

    const api = global.BPMApi;
    const modal = global.BPMModal;

    function create(options) {
        const refreshPeers = options.refreshPeers;
        let bansButton = null;
        let banDialog = null;

        function init(button) {
            bansButton = button;
            if (!bansButton || bansButton.dataset.bpmPeerActionsBound === 'true') return;
            bansButton.dataset.bpmPeerActionsBound = 'true';
            bansButton.addEventListener('click', event => {
                event.stopPropagation();
                if (banDialog && banDialog.isOpen()) closeBanModal();
                else openBanModal();
            });
        }

        function openBanModal() {
            if (bansButton) bansButton.classList.add('active');
            banDialog = modal.open({
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
                    if (bansButton) bansButton.classList.remove('active');
                    banDialog = null;
                },
            });
            fetchBanList(banDialog);
            return banDialog;
        }

        function closeBanModal() {
            if (banDialog) banDialog.close();
        }

        async function fetchBanList(dialog) {
            if (!dialog || !dialog.isOpen()) return;
            try {
                const data = await api.getJson('/api/bans', { signal: dialog.signal });
                if (dialog.isOpen() && dialog === banDialog) {
                    renderBanList(dialog, Array.isArray(data.bans) ? data.bans : []);
                }
            } catch (error) {
                if (error && error.name === 'AbortError') return;
                if (dialog.isOpen() && dialog === banDialog) {
                    dialog.body.innerHTML = `<div class="ban-list-loading" style="color:var(--err)">Failed to load bans: ${modal.escapeHtml(error.message)}</div>`;
                }
            }
        }

        function renderBanList(dialog, bans) {
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

            dialog.body.querySelectorAll('.ban-unban').forEach(button => {
                button.addEventListener('click', async () => {
                    const address = button.dataset.addr;
                    try {
                        const data = await api.postJson(
                            '/api/peer/unban',
                            { address },
                            { signal: dialog.signal }
                        );
                        if (data.success) {
                            showResult(`Unbanned ${address}`, true);
                            fetchBanList(dialog);
                        } else {
                            showResult(`Unban failed: ${data.error}`, false);
                        }
                    } catch (error) {
                        if (error && error.name === 'AbortError') return;
                        showResult(`Error: ${error.message}`, false);
                    }
                });
            });

            const clearButton = dialog.overlay.querySelector('#ban-clear-all');
            if (clearButton) {
                clearButton.addEventListener('click', async () => {
                    if (!global.confirm('Clear ALL bans? This cannot be undone.')) return;
                    try {
                        const data = await api.postJson(
                            '/api/bans/clear',
                            undefined,
                            { signal: dialog.signal }
                        );
                        if (data.success) {
                            showResult('All bans cleared', true);
                            fetchBanList(dialog);
                        } else {
                            showResult(`Clear failed: ${data.error}`, false);
                        }
                    } catch (error) {
                        if (error && error.name === 'AbortError') return;
                        showResult(`Error: ${error.message}`, false);
                    }
                });
            }
        }

        function showDisconnectDialog(peerId, network) {
            const canBan = network === 'ipv4' || network === 'ipv6';
            const safePeerId = modal.escapeHtml(peerId);
            const dialog = modal.open({
                id: 'disconnect-dialog',
                title: `Disconnect Peer ${peerId}`,
                ariaLabel: `Disconnect peer ${peerId}`,
                overlayClass: 'dialog-overlay',
                boxClass: 'dialog-box',
                showHeader: false,
                initialFocusSelector: '[data-choice="disconnect"]',
                contentHtml: `
                    <div class="dialog-title">Disconnect Peer ${safePeerId}</div>
                    <div class="dialog-text">Choose an action for this peer:</div>
                    <div class="dialog-actions">
                        <button type="button" class="dialog-btn dialog-btn-disconnect" data-choice="disconnect">Disconnect Only</button>
                        ${canBan ? '<button type="button" class="dialog-btn dialog-btn-ban" data-choice="ban">Disconnect + Ban 24h</button>' : ''}
                        <button type="button" class="dialog-btn dialog-btn-cancel" data-choice="cancel">Cancel</button>
                    </div>`,
            });

            dialog.overlay.addEventListener('click', async event => {
                const button = event.target.closest('.dialog-btn');
                if (!button) return;
                const choice = button.dataset.choice;
                dialog.close();
                if (choice === 'cancel') return;

                try {
                    if (choice === 'ban') {
                        const banData = await api.postJson('/api/peer/ban', { peer_id: peerId });
                        if (!banData.success) {
                            showResult(`Ban failed: ${banData.error}`, false);
                            return;
                        }
                        const disconnectData = await api.postJson(
                            '/api/peer/disconnect',
                            { peer_id: peerId }
                        );
                        if (disconnectData.success) {
                            showResult(`Banned ${banData.banned_ip} and disconnected peer ${peerId}`, true);
                        } else {
                            showResult(`Banned but disconnect failed: ${disconnectData.error}`, false);
                        }
                    } else {
                        const data = await api.postJson(
                            '/api/peer/disconnect',
                            { peer_id: peerId }
                        );
                        showResult(
                            data.success ? `Disconnected peer ${peerId}` : `Failed: ${data.error}`,
                            data.success
                        );
                    }
                    global.setTimeout(refreshPeers, 1000);
                } catch (error) {
                    showResult(`Error: ${error.message}`, false);
                }
            });
            return dialog;
        }

        function showResult(message, success) {
            const existing = document.getElementById('action-notification');
            if (existing) existing.remove();
            const notification = document.createElement('div');
            notification.id = 'action-notification';
            notification.setAttribute('role', success ? 'status' : 'alert');
            notification.setAttribute('aria-live', success ? 'polite' : 'assertive');
            notification.style.cssText = 'position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:400;padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;pointer-events:none;backdrop-filter:blur(12px);border:1px solid;';
            notification.style.color = success ? 'var(--ok)' : 'var(--err)';
            notification.style.borderColor = success
                ? 'rgba(63,185,80,0.4)'
                : 'rgba(248,81,73,0.4)';
            notification.style.background = 'rgba(10,14,20,0.92)';
            notification.textContent = message;
            document.body.appendChild(notification);
            global.setTimeout(() => {
                if (notification.parentNode) notification.remove();
            }, 5000);
        }

        return Object.freeze({
            init,
            openBanModal,
            closeBanModal,
            showDisconnectDialog,
            showResult,
        });
    }

    global.BPMPeerActions = Object.freeze({ create });
})(window);
