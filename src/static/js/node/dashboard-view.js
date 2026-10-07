import { query } from '../core/dom.js';
import * as BPMModal from '../core/modal.js';
import * as BPMFormat from '../core/format.js';
import { syncStatus } from './monitor.js';
import { fmtPing } from '../core/ping.js';
import * as data from './dashboard-data.js';

/** Dashboard DOM presentation consumes snapshots and prepared models.
 * @param {import('./dashboard-components').ViewOptions} options */
export function create(options) {
    const { dashboard, document, lifecycle, ui, getNodeInfo, getRefreshState, nowSeconds } = options;
    const escapeHtml = BPMModal.escapeHtml;
    const PRIVATE_NETS = new Set(data.privateNetworks), NET_DISPLAY = data.networkLabels;
    const { formatNodeAddress, shortNodeAddress, formatBps } = data;
    /** @type {Record<string, number | null>} */
    const prevValues = {};
    /** @type {Record<string, number>} */
    const fdPrevCounts = {};
    /** @type {Record<string, {full: string; label: string; isOverlay: boolean}>} */
    const FD_NET_INFO = {
        ipv4: { full: 'Public IPv4 network', label: 'Public IPv4', isOverlay: false },
        ipv6: { full: 'Public IPv6 network', label: 'Public IPv6', isOverlay: false },
        onion: { full: 'Tor onion routing network', label: 'Tor onion routing network', isOverlay: true },
        i2p: { full: 'I2P anonymous network', label: 'I2P anonymous network', isOverlay: true },
        cjdns: { full: 'CJDNS encrypted mesh network', label: 'CJDNS encrypted mesh network', isOverlay: true },
    };
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
            lifecycle.timeout(() => el.classList.remove('pulse-white'), 1500);
        } else if (mode === 'long') {
            el.classList.add(up ? 'pulse-up-long' : 'pulse-down-long');
            lifecycle.timeout(() => el.classList.remove('pulse-up-long', 'pulse-down-long'), 5000);
        } else {
            el.classList.add(up ? 'pulse-up' : 'pulse-down');
            lifecycle.timeout(() => el.classList.remove('pulse-up', 'pulse-down'), 1500);
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
        lifecycle.timeout(() => span.remove(), 2500);
    }

    /** @param {import('../types').Peer[]} peers */
    function updateFlightDeck(peers) {
        const counts = data.networkCounts(peers);
        ui.counts = counts;
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
                const addresses = ui.networkDetails[net]?.localaddresses || [];
                chipEl.classList.toggle('has-local-address', addresses.length > 0);
            }
        }
    }

    /** @param {string} netKey
     *
     * @param {string} rowClass
     * @param {string} mutedClass
     */
    function buildNetworkIdentityRows(netKey, rowClass, mutedClass) {
        const details = ui.networkDetails[netKey];
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
        const c = ui.counts[netKey] || { in: 0, out: 0 };
        const total = c.in + c.out;
        const isEnabled = total > 0;

        // Get score for ipv4/ipv6 from cached values
        let scoreVal = null;
        if (!info.isOverlay) {
            scoreVal = ui.scores[netKey];
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

    function updateHUD() {
        const summary = data.networkStats(dashboard.peers, 'all', undefined);
        if (!summary) return;
        const { counts: netCounts, total } = summary;

        // Map overlay — peer count
        const moPeers = document.getElementById('mo-peers');
        if (moPeers) {
            moPeers.textContent = String(total);
            pulseOnChange('mo-peers', total, 'white');
        }

        // Map overlay — status
        const moStatus = document.getElementById('mo-status');
        if (moStatus) {
            const status = syncStatus(getNodeInfo()?.blockchain?.ibd, getRefreshState().stale);
            moStatus.textContent = status.label;
            moStatus.style.color = status.color;
            moStatus.title = status.title;
        }

        // Map overlay — status message (like original: "Map Loaded!" / "Locating X peers...")
        const moMsg = document.getElementById('mo-status-msg');
        if (moMsg) {
            const status = data.locationStatus(dashboard.peers, getNodeInfo(), nowSeconds());
            if (status.text !== null) moMsg.textContent = status.text;
            if (status.loaded !== null) moMsg.classList.toggle('loaded', status.loaded);
            moMsg.style.color = status.color;
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
        const detailsForNet = net !== 'all' ? ui.networkDetails[net] : undefined;
        const summary = data.networkStats(dashboard.peers, net, detailsForNet);
        if (!summary) return null;
        const { counts, total, inbound, outbound, avgPing, label } = summary;

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

    function renderNodeMetricsValues() {
        const values = document.getElementById('node-metrics-values');
        if (!values) return;
        const metrics = getNodeInfo()?.node_metrics;
        const traffic = getNodeInfo()?.node_traffic;
        const rate = (/** @type {number | null | undefined} */ value) => value == null ? '\u2014' : formatBps(value);
        values.innerHTML = `<div class="modal-section-title">Node</div>
            <div class="info-row" title="Time since Bitcoin Knots started"><span class="info-label">Node uptime</span><span class="info-val">${escapeHtml(metrics?.uptime ?? '\u2014')}</span></div>
            <div class="modal-section-title">P2P Traffic</div>
            <div class="info-row" title="Average Bitcoin P2P download rate between node polls"><span class="info-label">P2P IN \u2193 (rate)</span><span class="info-val">${rate(metrics?.rx_bps)}</span></div>
            <div class="info-row" title="Average Bitcoin P2P upload rate between node polls"><span class="info-label">P2P OUT \u2191 (rate)</span><span class="info-val">${rate(metrics?.tx_bps)}</span></div>
            <div class="info-row" title="Downloaded by Bitcoin Knots since it started"><span class="info-label">P2P IN \u2193 (total)</span><span class="info-val">${escapeHtml(traffic?.download_fmt ?? '\u2014')}</span></div>
            <div class="info-row" title="Uploaded by Bitcoin Knots since it started"><span class="info-label">P2P OUT \u2191 (total)</span><span class="info-val">${escapeHtml(traffic?.upload_fmt ?? '\u2014')}</span></div>`;
    }

    function updateTrafficRates() {
        const metrics = getNodeInfo()?.node_metrics;
        for (const [id, rate] of /** @type {[string, number | null | undefined][]} */ ([
            ['ro-rate-in', metrics?.rx_bps], ['ro-rate-out', metrics?.tx_bps],
        ])) {
            const element = document.getElementById(id);
            const text = rate == null ? '\u2014' : formatBps(rate);
            if (element && element.textContent !== text) element.textContent = text;
        }
    }
    function dispose() {
        lifecycle.dispose();
        for (const id of Object.keys(prevValues)) document.getElementById(id)?.classList.remove(
            'pulse-up', 'pulse-down', 'pulse-up-long', 'pulse-down-long', 'pulse-white');
        document.querySelectorAll('.delta-indicator').forEach(element => element.remove());
        document.getElementById('fd-tooltip')?.classList.add('hidden');
    }
    return Object.freeze({ pulseOnChange, showDeltaIndicator, updateFlightDeck, buildNetworkIdentityRows, buildFdTooltip, updateNodeTrafficTotals, renderPeerDataStatus, updateInternetDot, updateHUD, getNetworkStats, renderNodeMetricsValues, updateTrafficRates, dispose });
}
