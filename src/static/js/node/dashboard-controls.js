import { queryAll, required } from '../core/dom.js';
import * as BPMModal from '../core/modal.js';
import { rows as nodeDisplayRows } from './dashboard-display.js';

/** Owns interaction bindings and all node-dashboard dialogs.
 * @param {import('./dashboard-components').ControlsOptions} options */
export function create(options) {
    const { document, lifecycle, view, api, fetchInfo, fetchPeers, onAction, getNodeInfo, storage } = options;
    const { postJson, errorMessage } = api;
    const { renderNodeMetricsValues, buildFdTooltip } = view;
    const fdTooltipEl = document.getElementById('fd-tooltip');
    let _apiDownModalVisible = false, _apiDownPromptAcknowledged = false;
    /** @type {Set<import('../types').ModalController>} */
    const dialogs = new Set();
    const componentRequests = new AbortController();
    /** @param {import('../types').ModalOptions} modalOptions */
    function openDialog(modalOptions) {
        const dialog = BPMModal.open({ ...modalOptions, document, onClose: () => {
            dialogs.delete(dialog);
            modalOptions.onClose?.();
        } });
        dialogs.add(dialog);
        return dialog;
    }
    function openConnectPeerModal() {
        const port = getNodeInfo()?.bitcoin_network?.default_peer_port;
        const suffix = typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535 ? `:${port}` : '';
        const listeners = lifecycle.replace('openConnectPeerModal');
        const dialog = openDialog({
            onClose: () => listeners.dispose(),
            id: 'connect-peer-modal', title: 'Connect Peer', closeId: 'connect-close', maxWidth: 520,
            initialFocusSelector: '#connect-addr-input',
            initialHtml: `
            <div class="connect-instructions">Enter a peer address to connect. Your node will attempt a one-time (onetry) connection.</div>
            <div class="connect-example">IPv4: 1.2.3.4${suffix}</div>
            <div class="connect-example">IPv6: [2001:db8::1]${suffix}</div>
            <div class="connect-example">Tor: abc...xyz.onion${suffix}</div>
            <div class="connect-example">I2P: abc...xyz.b32.i2p:0</div>
            <div class="connect-example">CJDNS: [fc00::1]${suffix}</div>
            ${suffix ? '' : '<div class="connect-instructions">Network metadata is unavailable. For addresses without a port, the server selects its configured network default. I2P requires :0.</div>'}
            <div class="connect-input-row">
                <input type="text" class="connect-input" id="connect-addr-input" placeholder="Enter peer address...">
                <button class="connect-btn" id="connect-go-btn">Connect</button>
            </div>
            <div class="connect-result" id="connect-result"></div>
            <div class="connect-permanent-hint">For a permanent connection, add the peer to the Bitcoin node's <code>addnode</code> configuration.</div>`,
        });

        /** @type {HTMLInputElement} */
        const input = required('#connect-addr-input', document);
        /** @type {HTMLButtonElement} */
        const goBtn = required('#connect-go-btn', document);
        const resultEl = required('#connect-result', document);
        listeners.listen(goBtn, 'click', async () => {
            if (goBtn.disabled) return;
            const addr = input.value.trim();
            if (!addr) {
                resultEl.textContent = 'Please enter an address';
                resultEl.className = 'connect-result err';
                return;
            }
            resultEl.textContent = 'Connecting...';
            resultEl.className = 'connect-result';
            goBtn.disabled = true;
            try {
                /** @type {import('../types').ActionResponse & {address: string}} */
                const data = await postJson('/api/peer/connect', { address: addr }, { signal: dialog.signal });
                if (data.success) {
                    resultEl.textContent = `Connection attempt sent to ${data.address}`;
                    resultEl.className = 'connect-result ok';
                    lifecycle.timeout(fetchPeers, 2000);
                } else {
                    resultEl.textContent = data.error || 'Failed';
                    resultEl.className = 'connect-result err';
                }
            } catch (err) {
                resultEl.textContent = 'Error: ' + errorMessage(err);
                resultEl.className = 'connect-result err';
            } finally {
                goBtn.disabled = false;
                if (dialog.isOpen() && document.activeElement === document.body) goBtn.focus({ preventScroll: true });
            }
        });

        listeners.listen(input, 'keydown', (e) => {
            if (e.key === 'Enter') goBtn.click();
        });
    }

    async function checkApiDownPrompt() {
        if (_apiDownModalVisible || _apiDownPromptAcknowledged) return;
        try {
            const data = await api.getJson('/api/connectivity', { signal: componentRequests.signal });
            if (componentRequests.signal.aborted) return;
            if (data.api_down_prompt && !data.geo_db_only_mode) {
                showApiDownModal();
                // Viewing the notice must not require a privileged server write.
                _apiDownPromptAcknowledged = true;
            }
        } catch (e) {
            /* ignore */
        }
    }

    function showApiDownModal() {
        if (_apiDownModalVisible) return;
        _apiDownModalVisible = true;
        const listeners = lifecycle.replace('showApiDownModal');
        const dialog = openDialog({
            id: 'api-down-modal', title: 'Geolocation API Not Responding', maxWidth: 440,
            bodyClass: 'modal-body api-down-body',
            closeId: 'api-down-close', initialFocusSelector: '#api-down-keep',
            initialHtml: `<p style="color:var(--text-secondary);margin:0 0 12px;font-size:12px">
                    The geolocation provider is not responding. Cached locations remain available while BPM retries.
                </p>
                <p style="color:var(--text-muted);margin:0 0 16px;font-size:11px">
                    You can switch to database-only mode (uses cached locations only) or keep trying the API.
                </p>
                <div style="display:flex;gap:8px;justify-content:center">
                    <button class="geodb-update-btn" id="api-down-dbonly" style="background:rgba(210,153,34,0.15);color:var(--warn);border-color:rgba(210,153,34,0.3)">Database-Only Mode</button>
                    <button class="geodb-update-btn" id="api-down-keep">Keep Trying</button>
                </div>
                <div id="api-down-error" role="alert" style="color:var(--err);font-size:11px"></div>
                `,
            onClose: () => { listeners.dispose(); _apiDownModalVisible = false; },
        });
        const overlay = dialog.overlay;
        const close = () => dialog.close();

        /** @type {HTMLButtonElement} */
        const databaseOnlyButton = required('#api-down-dbonly', document);
        listeners.listen(databaseOnlyButton, 'click', async () => {
            databaseOnlyButton.disabled = true;
            try {
                /** @type {{success: boolean; geo_db_only_mode?: boolean}} */
                const data = await postJson('/api/geodb/db-only', { enabled: true }, { signal: dialog.signal });
                if (!dialog.isOpen()) return;
                if (!data.success || data.geo_db_only_mode !== true) throw new Error('Could not save API lookup setting');
                close();
                fetchInfo();
            } catch (e) {
                if (overlay.isConnected) required('#api-down-error', overlay).textContent = 'Setting was not saved: ' + errorMessage(e);
            } finally {
                databaseOnlyButton.disabled = false;
                if (overlay.isConnected && document.activeElement === document.body) databaseOnlyButton.focus({ preventScroll: true });
            }
        });

        listeners.listen(required('#api-down-keep', document), 'click', close);
    }

    /** Open RPC node metrics, P2P traffic, and display toggles. */
    function openNodeMetricsModal() {
        const listeners = lifecycle.replace('openNodeMetricsModal');
        const dialog = openDialog({
            onClose: () => listeners.dispose(),
            id: 'system-info-modal', title: 'Node Metrics', maxWidth: 560,
            closeId: 'system-info-close', bodyId: 'system-info-body',
            initialHtml: '<div id="node-metrics-values"></div><div class="modal-section-title">Dashboard Display</div>',
        });
        renderNodeMetricsValues();
        const body = dialog.body;
        for (const item of nodeDisplayRows) {
            const visible = required(`#${item.id}`, document).style.display !== 'none';
            body.insertAdjacentHTML('beforeend', `<div class="info-row"><span class="info-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" class="si-dash-toggle" aria-label="${item.label}" data-target="${item.id}" ${visible ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`);
        }
        /** @type {HTMLInputElement[]} */ (queryAll('.si-dash-toggle', body)).forEach((checkbox) => {
            listeners.listen(checkbox, 'change', () => {
                const target = required(`#${checkbox.dataset.target}`, document);
                target.style.display = checkbox.checked ? '' : 'none';
                try {
                    const visibility = Object.fromEntries(nodeDisplayRows.map(({ id }) => [id, required(`#${id}`, document).style.display !== 'none']));
                    storage?.setItem('bpm.system.display', JSON.stringify(visibility));
                } catch { /* Toggles still work when browser storage is unavailable. */ }
            });
        });
    }
    function showConnectionRestoredToast() {
        // Remove any existing toast
        const listeners = lifecycle.replace('toast');
        const existing = document.getElementById('conn-restored-toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = 'conn-restored-toast';
        el.textContent = 'Reachability probe recovered';
        el.style.cssText = `
        position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:400;
        padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;
        backdrop-filter:blur(12px);border:1px solid rgba(63,185,80,0.4);
        color:var(--ok);background:rgba(10,14,20,0.92);
        transition:opacity 1s;pointer-events:auto;cursor:pointer;
    `;
        document.body.appendChild(el);

        // Click anywhere to dismiss immediately
        const dismiss = () => {
            el.remove();
            listeners.dispose();
        };
        listeners.timeout(() => listeners.listen(document, 'click', dismiss), 100);

        // Auto-fade after 5 seconds
        listeners.timeout(() => {
            el.style.opacity = '0';
            listeners.timeout(() => {
                if (el.parentElement) el.remove();
                listeners.dispose();
            }, 1000);
        }, 5000);
    }
    function init() {
    // Attach hover + click listeners to all flight deck chips
    queryAll('.fd-net-chip', document).forEach((chip) => {
        lifecycle.listen(chip, 'mouseenter', () => {
            const netKey = chip.dataset.net || '';
            if (!fdTooltipEl) return;
            const html = buildFdTooltip(netKey);
            if (!html) return;
            fdTooltipEl.innerHTML = html;
            fdTooltipEl.classList.remove('hidden');
            // Position below the chip
            const rect = chip.getBoundingClientRect();
            fdTooltipEl.style.left = rect.left + 'px';
            fdTooltipEl.style.top = rect.bottom + 6 + 'px';
        });
        lifecycle.listen(chip, 'mouseleave', () => {
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
        });
        // Click: IPv4/IPv6 → open AS distribution focused mode, Tor/I2P/CJDNS → enter private mode
        lifecycle.listen(chip, 'click', (e) => {
            e.stopPropagation();
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
            const netKey = chip.dataset.net || '';
            onAction({ type: 'network', network: netKey });
        });
    });


    // Connect Peer button handler
    const connectPeerBtn = document.getElementById('btn-connect-peer');
    if (connectPeerBtn) {
        lifecycle.listen(connectPeerBtn, 'click', (e) => {
            e.stopPropagation();
            openConnectPeerModal();
        });
    }

    try {
        const saved = JSON.parse(storage?.getItem('bpm.system.display') || '{}');
        for (const { id } of nodeDisplayRows) {
            if (saved?.[id] === false) required(`#${id}`, document).style.display = 'none';
        }
    } catch { /* Keep defaults if browser storage is unavailable or invalid. */ }

    // Every peer/traffic row opens node metrics and display settings.
    ['mo-row-peers', ...nodeDisplayRows.map(item => item.id)].forEach((id) => {
        const el = document.getElementById(id);
        if (el)
            lifecycle.listen(el, 'click', (e) => {
                e.stopPropagation();
                openNodeMetricsModal();
            });
    });


    }
    function dispose() {
        componentRequests.abort();
        lifecycle.dispose();
        for (const dialog of dialogs) dialog.close(false);
        dialogs.clear();
        document.getElementById('conn-restored-toast')?.remove();
    }
    init();
    return Object.freeze({ checkApiDownPrompt, showConnectionRestoredToast, dispose });
}
