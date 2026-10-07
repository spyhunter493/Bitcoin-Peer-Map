import { errorMessage, postJson, getJson } from '../core/api.js';
import { query, queryAll, required } from '../core/dom.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import * as BPMModal from '../core/modal.js';
import * as BPMPolling from '../core/polling.js';
import * as BPMFormat from '../core/format.js';
import * as BPMNodeMonitor from './monitor.js';
import { renderUpdateStatus } from '../core/version.js';
import * as BPMGeoipSettings from '../settings/geoip.js';
import { fmtPing, isMeasuredPing } from '../core/ping.js';
/**
 * @param {{config: import('../types').DashboardConfig; onAction: (action: import('../types').NodeAction) => void | Promise<void>}} options
 */
function create({ config: CFG, onAction }) {
    const dashboard = BPMDashboard;
    const escapeHtml = BPMModal.escapeHtml;
    const effectivePollInterval = BPMPolling.effectiveInterval;
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);
    /** @type {Record<string,string>} */
    const NET_DISPLAY = { ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
    const fetchPeers = () => onAction({ type: 'refresh-peers' });
    /** @type {Record<string, number | null>} */
    const prevValues = {}; // elementId -> previous numeric value

    /**
     * @param {string} elementId
     * @param {unknown} newValue
     * @param {string} [mode]
     */
    function pulseOnChange(elementId, newValue, mode) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const numNew = parseFloat(String(newValue).replace(/[^0-9.\-]/g, ''));
        if (isNaN(numNew)) {
            prevValues[elementId] = null;
            return;
        }
        const prev = prevValues[elementId];
        prevValues[elementId] = numNew;
        if (prev === null || prev === undefined) return;
        if (numNew === prev) return;
        const up = numNew > prev;
        const allClasses = [
            'pulse-up',
            'pulse-down',
            'pulse-up-long',
            'pulse-down-long',
            'pulse-white',
        ];
        allClasses.forEach((c) => el.classList.remove(c));
        void el.offsetWidth; // force reflow
        if (mode === 'white') {
            el.classList.add('pulse-white');
            setTimeout(() => el.classList.remove('pulse-white'), 1500);
        } else if (mode === 'long') {
            el.classList.add(up ? 'pulse-up-long' : 'pulse-down-long');
            setTimeout(() => el.classList.remove('pulse-up-long', 'pulse-down-long'), 5000);
        } else {
            el.classList.add(up ? 'pulse-up' : 'pulse-down');
            setTimeout(() => el.classList.remove('pulse-up', 'pulse-down'), 1500);
        }
        return up ? 1 : -1;
    }

    /**
     * @param {HTMLElement | null} parentEl
     * @param {number} delta
     */
    function showDeltaIndicator(parentEl, delta) {
        if (!parentEl || delta === 0) return;
        const existing = query('.delta-indicator', parentEl);
        if (existing) existing.remove();
        const span = document.createElement('span');
        span.className = 'delta-indicator ' + (delta > 0 ? 'delta-up' : 'delta-down');
        span.textContent = (delta > 0 ? '+' : '') + delta;
        parentEl.appendChild(span);
        setTimeout(() => span.remove(), 2500);
    }

    // ═══════════════════════════════════════════════════════════
    // BTC SUPPORT ADDRESS — Selectable text (no click handler)
    // ═══════════════════════════════════════════════════════════
    // Address is plain selectable text — users can highlight and copy manually.

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK — Toggle + Network stats
    // ═══════════════════════════════════════════════════════════

    // Flight deck is always visible (toggle removed)

    // Previous flight deck counts for delta indicators
    /** @type {Record<string, number>} */
    const fdPrevCounts = {};

    // Cached flight deck counts and scores for tooltip use
    /** @type {Record<string, {in: number; out: number}>} */
    let fdCachedCounts = {
        ipv4: { in: 0, out: 0 },
        ipv6: { in: 0, out: 0 },
        onion: { in: 0, out: 0 },
        i2p: { in: 0, out: 0 },
        cjdns: { in: 0, out: 0 },
    };
    /** @type {Record<string, number | null>} */
    let fdCachedScores = { ipv4: null, ipv6: null };
    /** @type {Record<string, import('../types').NetworkDetails>} */
    let fdCachedNetworkDetails = {};

    /** @param {import('../types').Peer[]} peers */
    function updateFlightDeck(peers) {
        /** @type {Record<string, {in: number; out: number}>} */
        const counts = {
            ipv4: { in: 0, out: 0 },
            ipv6: { in: 0, out: 0 },
            onion: { in: 0, out: 0 },
            i2p: { in: 0, out: 0 },
            cjdns: { in: 0, out: 0 },
        };
        for (const n of peers) {
            const net = n.network || 'ipv4';
            if (!counts[net]) continue;
            if (n.direction === 'IN') counts[net].in++;
            else counts[net].out++;
        }
        fdCachedCounts = counts;
        const netMap = { ipv4: 'ipv4', ipv6: 'ipv6', onion: 'tor', i2p: 'i2p', cjdns: 'cjdns' };
        for (const [net, label] of Object.entries(netMap)) {
            const c = counts[net];
            const inEl = document.getElementById(`fd-${label}-in`);
            const outEl = document.getElementById(`fd-${label}-out`);
            if (inEl) {
                const oldIn = fdPrevCounts[`${net}-in`] || 0;
                inEl.textContent = String(c.in);
                if (oldIn !== c.in && fdPrevCounts[`${net}-in`] !== undefined) {
                    pulseOnChange(`fd-${label}-in`, c.in);
                    showDeltaIndicator(inEl.parentElement, c.in - oldIn);
                }
                fdPrevCounts[`${net}-in`] = c.in;
            }
            if (outEl) {
                const oldOut = fdPrevCounts[`${net}-out`] || 0;
                outEl.textContent = String(c.out);
                if (oldOut !== c.out && fdPrevCounts[`${net}-out`] !== undefined) {
                    pulseOnChange(`fd-${label}-out`, c.out);
                    showDeltaIndicator(outEl.parentElement, c.out - oldOut);
                }
                fdPrevCounts[`${net}-out`] = c.out;
            }
            // Green/red dot indicator (enabled = has peers, disabled = no peers)
            const dotEl = document.getElementById(`fd-${label}-dot`);
            if (dotEl) {
                const total = c.in + c.out;
                if (total > 0) {
                    dotEl.className = 'fd-net-dot enabled';
                } else {
                    dotEl.className = 'fd-net-dot disabled';
                }
            }
            const chipEl = query(`.fd-net-chip[data-net="${net}"]`, document);
            if (chipEl) {
                const addresses = fdCachedNetworkDetails[net]?.localaddresses || [];
                chipEl.classList.toggle('has-local-address', addresses.length > 0);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK HOVER TOOLTIPS — Detailed network info on hover
    // ═══════════════════════════════════════════════════════════

    const fdTooltipEl = document.getElementById('fd-tooltip');

    // Friendly names and descriptions for each network
    /** @type {Record<string, {full: string; label: string; isOverlay: boolean}>} */
    const FD_NET_INFO = {
        ipv4: { full: 'Public IPv4 network', label: 'Public IPv4', isOverlay: false },
        ipv6: { full: 'Public IPv6 network', label: 'Public IPv6', isOverlay: false },
        onion: { full: 'Tor onion routing network', label: 'Tor onion routing network', isOverlay: true },
        i2p: { full: 'I2P anonymous network', label: 'I2P anonymous network', isOverlay: true },
        cjdns: { full: 'CJDNS encrypted mesh network', label: 'CJDNS encrypted mesh network', isOverlay: true },
    };

    /** @param {import('../types').NodeAddress} address */
    function formatNodeAddress(address) {
        if (!address || !address.address) return '';
        const host = String(address.address);
        const port = Number(address.port || 0);
        if (!port) return host;
        return host.includes(':') && !host.endsWith('.onion') && !host.endsWith('.i2p') ? `[${host}]:${port}` : `${host}:${port}`;
    }

    /** @param {string} value */
    function shortNodeAddress(value) {
        if (value.length <= 36) return value;
        return `${value.slice(0, 16)}...${value.slice(-15)}`;
    }

    /** @param {string} netKey
     *
     * @param {string} rowClass
     * @param {string} mutedClass
     */
    function buildNetworkIdentityRows(netKey, rowClass, mutedClass) {
        const details = fdCachedNetworkDetails[netKey];
        if (!details) return '';

        let html = '';
        html += `<div class="${rowClass}">Reachable: ${details.reachable ? 'Yes' : 'No'}</div>`;
        if (details.limited) html += `<div class="${mutedClass}">Limited by node network settings</div>`;
        if (details.proxy) {
            const proxy = escapeHtml(details.proxy);
            html += `<div class="${rowClass}">Proxy: <span title="${proxy}">${proxy}</span></div>`;
        }

        const addresses = details.localaddresses || [];
        if (addresses.length === 0) {
            html += `<div class="${mutedClass}">No advertised address reported</div>`;
            return html;
        }

        const label = PRIVATE_NETS.has(netKey) ? 'Service' : 'Advertised';
        for (const address of addresses.slice(0, 3)) {
            const fullAddress = formatNodeAddress(address);
            const escapedFull = escapeHtml(fullAddress);
            const shortAddress = escapeHtml(shortNodeAddress(fullAddress));
            html += `<div class="${rowClass}">${label}: <span class="node-address" title="${escapedFull}">${shortAddress}</span></div>`;
        }
        if (addresses.length > 3) {
            html += `<div class="${mutedClass}">${addresses.length - 3} more advertised addresses</div>`;
        }
        return html;
    }

    /** @param {string} netKey */
    function buildFdTooltip(netKey) {
        const info = FD_NET_INFO[netKey];
        if (!info) return '';
        const c = fdCachedCounts[netKey] || { in: 0, out: 0 };
        const total = c.in + c.out;
        const isEnabled = total > 0;

        // Get score for ipv4/ipv6 from cached values
        let scoreVal = null;
        if (!info.isOverlay) {
            scoreVal = fdCachedScores[netKey];
        }

        let html = '<div class="fdt-title">';
        if (isEnabled) {
            html += `${info.full} <span class="fdt-status-enabled">(Enabled)</span>`;
        } else {
            html += `${info.label} <span class="fdt-status-disabled">(Disabled)</span>`;
        }
        html += '</div>';

        html += `<div class="fdt-row">Inbound: ${c.in} peers</div>`;
        html += `<div class="fdt-row">Outbound: ${c.out} peers</div>`;
        html += buildNetworkIdentityRows(netKey, 'fdt-row', 'fdt-row-muted');

        if (info.isOverlay) {
            html += '<div class="fdt-row-muted">Overlay network (no reliable local score)</div>';
        } else if (scoreVal) {
            html += `<div class="fdt-row">Local Network Score: ${scoreVal}</div>`;
        }

        if (isEnabled) {
            if (info.isOverlay) {
                html += '<div class="fdt-row-muted">Appears to be properly configured</div>';
            }
        } else {
            html +=
                '<div class="fdt-warn">This network is either disabled or not currently connected.<br>Please check your node network settings.</div>';
        }

        return html;
    }

    // Attach hover + click listeners to all flight deck chips
    queryAll('.fd-net-chip', document).forEach((chip) => {
        chip.addEventListener('mouseenter', () => {
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
        chip.addEventListener('mouseleave', () => {
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
        });
        // Click: IPv4/IPv6 → open AS distribution focused mode, Tor/I2P/CJDNS → enter private mode
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
            const netKey = chip.dataset.net || '';
            onAction({ type: 'network', network: netKey });
        });
    });

    // ═══════════════════════════════════════════════════════════

    const infoPolling = BPMPolling.create({
        task: refreshNodeInfo,
        intervalMs: effectivePollInterval(CFG.infoPollInterval),
    });

    // ═══════════════════════════════════════════════════════════
    // GEODB MANAGEMENT DROPDOWN
    // ═══════════════════════════════════════════════════════════

    const geoipSettings = BPMGeoipSettings.create({
        getNodeInfo: () => lastNodeInfo,
        refreshInfo: fetchInfo,
    });
    const openGeoDBDropdown = geoipSettings.open;

    // ═══════════════════════════════════════════════════════════
    // CONNECT PEER MODAL
    // ═══════════════════════════════════════════════════════════

    function openConnectPeerModal() {
        const port = lastNodeInfo?.bitcoin_network?.default_peer_port;
        const suffix = typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535 ? `:${port}` : '';
        const dialog = BPMModal.open({
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
        const input = required('#connect-addr-input');
        /** @type {HTMLButtonElement} */
        const goBtn = required('#connect-go-btn');
        const resultEl = required('#connect-result');
        goBtn.addEventListener('click', async () => {
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
                    setTimeout(fetchPeers, 2000);
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

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') goBtn.click();
        });
    }

    // Connect Peer button handler
    const connectPeerBtn = document.getElementById('btn-connect-peer');
    if (connectPeerBtn) {
        connectPeerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openConnectPeerModal();
        });
    }

    const nodeDisplayRows = [
        { id: 'mo-row-netin', label: 'P2P \u2193 (Download rate)' },
        { id: 'mo-row-netout', label: 'P2P \u2191 (Upload rate)' },
        { id: 'mo-row-p2p-in', label: 'P2P \u2193 (Downloaded total)' },
        { id: 'mo-row-p2p-out', label: 'P2P \u2191 (Uploaded total)' },
    ];
    try {
        const saved = JSON.parse(localStorage.getItem('bpm.system.display') || '{}');
        for (const { id } of nodeDisplayRows) {
            if (saved?.[id] === false) required(`#${id}`).style.display = 'none';
        }
    } catch { /* Keep defaults if browser storage is unavailable or invalid. */ }

    // Every peer/traffic row opens node metrics and display settings.
    ['mo-row-peers', ...nodeDisplayRows.map(item => item.id)].forEach((id) => {
        const el = document.getElementById(id);
        if (el)
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                openNodeMetricsModal();
            });
    });

    /** @type {import('../types').NodeInfo | null} */
    let lastNodeInfo = null; // Full /api/info response for Node Info card
    /** @type {import('../types').NodeRefreshState} */
    const nodeRefreshState = { stale: false, lastSuccessfulRefresh: null };

    // Track previous internet state for toast notifications
    let _prevInternetState = 'green';
    let _lastRestoredToastTime = 0;

    /**
     * @param {import('../types').NodeTraffic | null} traffic
     */
    function updateNodeTrafficTotals(traffic) {
        const inEl = document.getElementById('mo-p2p-in');
        const outEl = document.getElementById('mo-p2p-out');
        const downloaded = traffic?.download_bytes ?? null;
        const uploaded = traffic?.upload_bytes ?? null;
        if (inEl) {
            inEl.textContent = downloaded === null ? '\u2014' : traffic?.download_fmt || BPMFormat.fmtBytesShort(downloaded);
            inEl.title = downloaded === null ? 'Node traffic unavailable' : `${downloaded.toLocaleString()} bytes downloaded since the Bitcoin node started`;
            if (downloaded !== null) pulseOnChange('mo-p2p-in', downloaded, 'white');
        }
        if (outEl) {
            outEl.textContent = uploaded === null ? '\u2014' : traffic?.upload_fmt || BPMFormat.fmtBytesShort(uploaded);
            outEl.title = uploaded === null ? 'Node traffic unavailable' : `${uploaded.toLocaleString()} bytes uploaded since the Bitcoin node started`;
            if (uploaded !== null) pulseOnChange('mo-p2p-out', uploaded, 'white');
        }
    }

    function fetchInfo() {
        return infoPolling.run();
    }

    async function refreshNodeInfo() {
        try {
            /** @type {import('../types').NodeInfo} */
            const info = await getJson('/api/info', undefined, 35_000);
            if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid node info response');

            lastNodeInfo = info;
            nodeRefreshState.lastSuccessfulRefresh = Date.now();
            nodeRefreshState.stale = false;
            renderUpdateStatus(info.updates);

            // Update internet connectivity indicator
            if (info.internet_state) {
                updateInternetDot(info.internet_state);
                // Show "Connection restored" toast when transitioning to green
                if (info.internet_state === 'green' && _prevInternetState !== 'green') {
                    const now = Date.now();
                    if (now - _lastRestoredToastTime > 60000) {
                        showConnectionRestoredToast();
                        _lastRestoredToastTime = now;
                    }
                }
                _prevInternetState = info.internet_state;
            }

            // Check if we should show the API-down prompt
            if (info.api_available === false && !info.geo_db_only_mode) {
                checkApiDownPrompt();
            }

            updateNodeTrafficTotals(info.node_traffic);
            updateTrafficRates();
            renderNodeMetricsValues();

            // Store flight deck scores for tooltip display
            if (info.network_scores) {
                fdCachedScores.ipv4 = info.network_scores.ipv4;
                fdCachedScores.ipv6 = info.network_scores.ipv6;
            }
            fdCachedNetworkDetails = info.network_details || {};

            updateHUD();
            nodeMonitor.refreshNodeInfo();
        } catch (err) {
            nodeRefreshState.stale = nodeRefreshState.lastSuccessfulRefresh !== null;
            if (lastNodeInfo) lastNodeInfo = { ...lastNodeInfo, node_traffic: null, node_metrics: undefined };
            updateNodeTrafficTotals(null);
            updateTrafficRates();
            renderNodeMetricsValues();
            updateHUD();
            nodeMonitor.refreshNodeInfo();
            console.error('[Bitcoin Peer Map] Failed to fetch info:', err);
        }
    }

    const nodeMonitor = BPMNodeMonitor.create({
        getNodeInfo: () => lastNodeInfo,
        getRefreshState: () => nodeRefreshState,
        formatBytes: BPMFormat.fmtBytesShort,
    });

    function openRecentBlocksModal() {
        nodeMonitor.openRecentBlocks();
    }

    function openNodeInfoModal() {
        nodeMonitor.openNodeInfo();
    }

    function openChainTipsModal() {
        nodeMonitor.openChainTips();
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECTION STATUS (topbar dot + text)
    // ═══════════════════════════════════════════════════════════

    /**
     * @param {import('../types').PeerDataStatus} status
     */
    function renderPeerDataStatus(status) {
        const labels = {
            live: 'Live',
            connecting: 'Connecting…',
            'node-unavailable': 'Node unavailable',
            'dashboard-unavailable': 'Dashboard unavailable',
            delayed: 'Refresh delayed',
        };
        const label = labels[status.state];
        const dot = document.getElementById('status-dot');
        if (dot) {
            dot.dataset.state = status.state;
            dot.setAttribute('aria-label', 'Peer data: ' + label);
            dot.classList.toggle('online', status.state === 'live');
            dot.classList.toggle('pending', status.state === 'connecting' || status.state === 'delayed');
            const details = status.stale
                ? 'Showing the last successful peer snapshot. Refresh will retry automatically.'
                : 'Connection status for peer data from your Bitcoin node';
            dot.title = label + '\n' + details + '\n' + (status.lastSuccessAt === null
                ? 'No successful peer snapshot yet'
                : 'Last successful peer snapshot: ' + new Date(status.lastSuccessAt * 1000).toLocaleString());
        }
        const peerCount = document.getElementById('mo-peers');
        if (peerCount) peerCount.title = status.stale ? 'Peers in the last successful snapshot' : 'Total connected peers';
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNET CONNECTIVITY INDICATOR
    // ═══════════════════════════════════════════════════════════

    /**
     * @param {string} state
     */
    function updateInternetDot(state) {
        const dot = document.getElementById('internet-dot');
        if (!dot) return;
        dot.classList.remove('green', 'yellow', 'red');
        dot.classList.add(state);
        let tip;
        if (state === 'green') {
            tip = 'Google reachability probe succeeded; GeoIP provider health is tracked separately';
        } else if (state === 'yellow') {
            tip = 'Google reachability probe failed; retrying. GeoIP lookups use their own provider health.';
        } else {
            tip = 'Google reachability probe unavailable; GeoIP lookups use their own provider health';
        }
        dot.title = tip;
    }

    function showConnectionRestoredToast() {
        // Remove any existing toast
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
            document.removeEventListener('click', dismiss);
        };
        setTimeout(() => document.addEventListener('click', dismiss), 100);

        // Auto-fade after 5 seconds
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
                if (el.parentElement) el.remove();
                document.removeEventListener('click', dismiss);
            }, 1000);
        }, 5000);
    }

    // Provider failures are independent of the reachability probe.
    let _apiDownModalVisible = false;
    let _apiDownPromptAcknowledged = false;

    async function checkApiDownPrompt() {
        if (_apiDownModalVisible || _apiDownPromptAcknowledged) return;
        try {
            const resp = await fetch('/api/connectivity');
            const data = await resp.json();
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
        const dialog = BPMModal.open({
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
            onClose: () => { _apiDownModalVisible = false; },
        });
        const overlay = dialog.overlay;
        const close = () => dialog.close();

        /** @type {HTMLButtonElement} */
        const databaseOnlyButton = required('#api-down-dbonly');
        databaseOnlyButton.addEventListener('click', async () => {
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

        required('#api-down-keep').addEventListener('click', close);
    }

    // ═══════════════════════════════════════════════════════════
    // CANVAS RESIZE
    // Handles high-DPI displays via devicePixelRatio scaling.
    // ═══════════════════════════════════════════════════════════

    function updateHUD() {
        // Count alive nodes by network type
        const netCounts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let total = 0;
        for (const n of dashboard.peers) {
            total++;
            if (netCounts.hasOwnProperty(n.network)) netCounts[n.network]++;
        }

        // Map overlay — peer count
        const moPeers = document.getElementById('mo-peers');
        if (moPeers) {
            moPeers.textContent = String(total);
            pulseOnChange('mo-peers', total, 'white');
        }

        // Map overlay — status
        const moStatus = document.getElementById('mo-status');
        if (moStatus) {
            const status = BPMNodeMonitor.syncStatus(lastNodeInfo?.blockchain?.ibd, nodeRefreshState.stale);
            moStatus.textContent = status.label;
            moStatus.style.color = status.color;
            moStatus.title = status.title;
        }

        // Map overlay — status message (like original: "Map Loaded!" / "Locating X peers...")
        const moMsg = document.getElementById('mo-status-msg');
        if (moMsg) {
            const apiAvail = lastNodeInfo ? lastNodeInfo.api_available : true;
            const dbOnly = lastNodeInfo ? lastNodeInfo.geo_db_only_mode : false;
            const provider = lastNodeInfo?.providers?.geoip;
            const retryIn = provider?.retry_at == null ? 0 : Math.max(0, Math.ceil(provider.retry_at - Date.now() / 1000));

            if (dbOnly) {
                moMsg.textContent = 'API lookup off';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else if (retryIn > 0) {
                moMsg.textContent = `${provider?.state === 'rate_limited' ? 'GeoIP rate limited' : 'GeoIP retry'} (${retryIn}s)`;
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else if (provider?.state === 'unavailable' || apiAvail === false) {
                moMsg.textContent = 'GeoIP provider unavailable';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else {
                moMsg.style.color = '';
                // Count pending geolocation peers
                let pendingGeo = 0;
                for (const n of dashboard.peers) {
                    if (n.location_status === 'pending') pendingGeo++;
                }
                if (pendingGeo > 0) {
                    moMsg.textContent = `Locating ${pendingGeo} peer${pendingGeo > 1 ? 's' : ''}...`;
                    moMsg.classList.remove('loaded');
                } else if (total > 0) {
                    moMsg.textContent = 'Map Loaded!';
                    moMsg.classList.add('loaded');
                }
            }
        }

        // Badge counts (inside the filter badges)
        const bcAll = document.getElementById('bc-all');
        const bcIpv4 = document.getElementById('bc-ipv4');
        const bcIpv6 = document.getElementById('bc-ipv6');
        const bcTor = document.getElementById('bc-tor');
        const bcI2p = document.getElementById('bc-i2p');
        const bcCjdns = document.getElementById('bc-cjdns');
        if (bcAll) {
            bcAll.textContent = String(total);
            pulseOnChange('bc-all', total, 'white');
        }
        if (bcIpv4) {
            bcIpv4.textContent = String(netCounts.ipv4);
            pulseOnChange('bc-ipv4', netCounts.ipv4);
        }
        if (bcIpv6) {
            bcIpv6.textContent = String(netCounts.ipv6);
            pulseOnChange('bc-ipv6', netCounts.ipv6);
        }
        if (bcTor) {
            bcTor.textContent = String(netCounts.onion);
            pulseOnChange('bc-tor', netCounts.onion);
        }
        if (bcI2p) {
            bcI2p.textContent = String(netCounts.i2p);
            pulseOnChange('bc-i2p', netCounts.i2p);
        }
        if (bcCjdns) {
            bcCjdns.textContent = String(netCounts.cjdns);
            pulseOnChange('bc-cjdns', netCounts.cjdns);
        }
    }

    /** @param {string} net */
    function getNetworkStats(net) {
        const aliveNodes = dashboard.peers;
        /** @type {Record<string, number>} */
        const counts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let inbound = 0,
            outbound = 0,
            totalPing = 0,
            pingCount = 0;

        for (const n of aliveNodes) {
            if (counts.hasOwnProperty(n.network)) counts[n.network]++;
            const match = net === 'all' || n.network === net;
            if (match) {
                if (n.direction === 'IN') inbound++;
                else outbound++;
                if (isMeasuredPing(n.ping_ms)) {
                    totalPing += n.ping_ms;
                    pingCount++;
                }
            }
        }

        const total = net === 'all' ? aliveNodes.length : counts[net] || 0;
        const detailsForNet = net !== 'all' ? fdCachedNetworkDetails[net] : null;

        if (total === 0 && net !== 'all' && !detailsForNet) return null;

        const avgPing = pingCount > 0 ? totalPing / pingCount : null;
        const label = net === 'all' ? 'All Networks' : NET_DISPLAY[net] || net.toUpperCase();

        let html = `<div class="pop-title">${label}</div>`;
        html += `<div class="pop-row"><span class="pop-label">Peers</span><span class="pop-val">${total}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Inbound</span><span class="pop-val">${inbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Outbound</span><span class="pop-val">${outbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Avg Ping</span><span class="pop-val">${fmtPing(avgPing)}</span></div>`;
        if (net !== 'all') {
            const details = detailsForNet;
            if (details) {
                html += `<div class="pop-row"><span class="pop-label">Reachable</span><span class="pop-val">${details.reachable ? 'Yes' : 'No'}</span></div>`;
                if (details.proxy) {
                    const proxy = escapeHtml(details.proxy);
                    html += `<div class="pop-row"><span class="pop-label">Proxy</span><span class="pop-val node-address" title="${proxy}">${proxy}</span></div>`;
                }
                const addresses = details.localaddresses || [];
                const labelText = PRIVATE_NETS.has(net) ? 'Service' : 'Advertised';
                if (addresses.length) {
                    for (const address of addresses.slice(0, 3)) {
                        const fullAddress = formatNodeAddress(address);
                        const escapedFull = escapeHtml(fullAddress);
                        const shortAddress = escapeHtml(shortNodeAddress(fullAddress));
                        html += `<div class="pop-row"><span class="pop-label">${labelText}</span><span class="pop-val node-address" title="${escapedFull}">${shortAddress}</span></div>`;
                    }
                } else {
                    html += '<div class="pop-row"><span class="pop-label">Advertised</span><span class="pop-val">None</span></div>';
                }
            }
        }

        if (net === 'all') {
            // Show per-network breakdown
            for (const nk of Object.keys(NET_DISPLAY)) {
                if (counts[nk] > 0) {
                    html += `<div class="pop-row"><span class="pop-label">${NET_DISPLAY[nk]}</span><span class="pop-val">${counts[nk]}</span></div>`;
                }
            }
        }

        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // NODE METRICS — Knots RPC snapshots from the existing node-info poll
    // ═══════════════════════════════════════════════════════════

    function renderNodeMetricsValues() {
        const values = document.getElementById('node-metrics-values');
        if (!values) return;
        const metrics = lastNodeInfo?.node_metrics;
        const traffic = lastNodeInfo?.node_traffic;
        const rate = (/** @type {number | null | undefined} */ value) => value == null ? '\u2014' : formatBps(value);
        values.innerHTML = `<div class="modal-section-title">Node</div>
            <div class="info-row" title="Time since Bitcoin Knots started"><span class="info-label">Node uptime</span><span class="info-val">${escapeHtml(metrics?.uptime ?? '\u2014')}</span></div>
            <div class="modal-section-title">P2P Traffic</div>
            <div class="info-row" title="Average Bitcoin P2P download rate between node polls"><span class="info-label">P2P IN \u2193 (rate)</span><span class="info-val">${rate(metrics?.rx_bps)}</span></div>
            <div class="info-row" title="Average Bitcoin P2P upload rate between node polls"><span class="info-label">P2P OUT \u2191 (rate)</span><span class="info-val">${rate(metrics?.tx_bps)}</span></div>
            <div class="info-row" title="Downloaded by Bitcoin Knots since it started"><span class="info-label">P2P IN \u2193 (total)</span><span class="info-val">${escapeHtml(traffic?.download_fmt ?? '\u2014')}</span></div>
            <div class="info-row" title="Uploaded by Bitcoin Knots since it started"><span class="info-label">P2P OUT \u2191 (total)</span><span class="info-val">${escapeHtml(traffic?.upload_fmt ?? '\u2014')}</span></div>`;
    }

    /** Open RPC node metrics, P2P traffic, and display toggles. */
    function openNodeMetricsModal() {
        const dialog = BPMModal.open({
            id: 'system-info-modal', title: 'Node Metrics', maxWidth: 560,
            closeId: 'system-info-close', bodyId: 'system-info-body',
            initialHtml: '<div id="node-metrics-values"></div><div class="modal-section-title">Dashboard Display</div>',
        });
        renderNodeMetricsValues();
        const body = dialog.body;
        for (const item of nodeDisplayRows) {
            const visible = required(`#${item.id}`).style.display !== 'none';
            body.insertAdjacentHTML('beforeend', `<div class="info-row"><span class="info-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" class="si-dash-toggle" aria-label="${item.label}" data-target="${item.id}" ${visible ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`);
        }
        /** @type {HTMLInputElement[]} */ (queryAll('.si-dash-toggle', body)).forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const target = required(`#${checkbox.dataset.target}`);
                target.style.display = checkbox.checked ? '' : 'none';
                try {
                    const visibility = Object.fromEntries(nodeDisplayRows.map(({ id }) => [id, required(`#${id}`).style.display !== 'none']));
                    localStorage.setItem('bpm.system.display', JSON.stringify(visibility));
                } catch { /* Toggles still work when browser storage is unavailable. */ }
            });
        });
    }

    function updateTrafficRates() {
        const metrics = lastNodeInfo?.node_metrics;
        for (const [id, rate] of /** @type {[string, number | null | undefined][]} */ ([
            ['ro-rate-in', metrics?.rx_bps], ['ro-rate-out', metrics?.tx_bps],
        ])) {
            const element = document.getElementById(id);
            const text = rate == null ? '\u2014' : formatBps(rate);
            if (element && element.textContent !== text) element.textContent = text;
        }
    }

    /** @param {number} bps */
    function formatBps(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    return Object.freeze({
        updateFlightDeck,
        infoPolling,
        openGeoDBDropdown,
        fetchInfo,
        openRecentBlocksModal,
        openNodeInfoModal,
        openChainTipsModal,
        renderPeerDataStatus,
        updateHUD,
        getNetworkStats,
    });
}
export { create };
