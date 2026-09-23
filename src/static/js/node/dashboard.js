import { errorMessage } from '../core/api.js';
import { query, queryAll, required } from '../core/dom.js';
import { dashboard as BPMDashboard } from '../core/dashboard-state.js';
import * as BPMModal from '../core/modal.js';
import * as BPMWorldMap from '../map/geometry.js';
import * as BPMPolling from '../core/polling.js';
import * as BPMPrice from './price.js';
import * as BPMFormat from '../core/format.js';
import * as BPMNodeMonitor from './monitor.js';
/**
 * @param {{config: import('../types').DashboardConfig; onAction: (action: import('../types').NodeAction) => void | Promise<void>}} options
 */
function create({ config: CFG, onAction }) {
    const dashboard = BPMDashboard;
    const escapeHtml = BPMModal.escapeHtml;
    const mrow = BPMModal.row;
    const clamp = BPMWorldMap.clamp;
    const effectivePollInterval = BPMPolling.effectiveInterval;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);
    /** @type {Record<string,string>} */
    const NET_DISPLAY = { ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
    const fetchPeers = () => onAction({ type: 'refresh-peers' });
    /** @param {HTMLElement | null} anchor */
    const openDisplaySettingsPopup = (anchor) => onAction({ type: 'settings', anchor });
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
            'price-up',
            'price-down',
            'price-pulse-up',
            'price-pulse-down',
        ];
        allClasses.forEach((c) => el.classList.remove(c));
        void el.offsetWidth; // force reflow
        if (mode === 'white') {
            el.classList.add('pulse-white');
            setTimeout(() => el.classList.remove('pulse-white'), 1500);
        } else if (mode === 'long') {
            el.classList.add(up ? 'pulse-up-long' : 'pulse-down-long');
            setTimeout(() => el.classList.remove('pulse-up-long', 'pulse-down-long'), 5000);
        } else if (mode === 'persistent') {
            el.classList.add(up ? 'price-pulse-up' : 'price-pulse-down');
            setTimeout(() => {
                el.classList.remove('price-pulse-up', 'price-pulse-down');
                el.classList.add(up ? 'price-up' : 'price-down');
            }, 2000);
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

    /** @type {import('../types').PriceInfo | null} */
    let lastPriceInfo = null;
    const priceController = BPMPrice.create({
        onPrice(info) {
            lastPriceInfo = info;
            updateBtcPricePanel(info);
        },
    });
    const pricePolling = BPMPolling.create({
        task: priceController.refresh,
        intervalMs: effectivePollInterval(CFG.infoPollInterval),
    });
    const infoPolling = BPMPolling.create({
        task: refreshNodeInfo,
        intervalMs: effectivePollInterval(CFG.infoPollInterval),
    });

    // ═══════════════════════════════════════════════════════════
    // CURRENCY SELECTOR DROPDOWN
    // ═══════════════════════════════════════════════════════════

    const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'NZD', 'SGD'];
    /** @type {Record<string, {symbol: string; decimals: number}>} */
    const CURRENCY_META = {
        USD: { symbol: '$', decimals: 2 },
        EUR: { symbol: '\u20AC', decimals: 2 }, // €
        GBP: { symbol: '\u00A3', decimals: 2 }, // £
        JPY: { symbol: '\u00A5', decimals: 0 }, // ¥
        CHF: { symbol: 'CHF ', decimals: 2 },
        CAD: { symbol: 'C$', decimals: 2 },
        AUD: { symbol: 'A$', decimals: 2 },
        CNY: { symbol: 'CN\u00A5', decimals: 2 }, // CN¥
        NZD: { symbol: 'NZ$', decimals: 2 },
        SGD: { symbol: 'S$', decimals: 2 },
    };

    /**
     * @param {number} price
     * @param {string} currencyCode
     */
    function formatCurrencyPrice(price, currencyCode) {
        const meta = CURRENCY_META[currencyCode] || { symbol: '', decimals: 2 };
        return (
            meta.symbol +
            price.toLocaleString(undefined, {
                minimumFractionDigits: meta.decimals,
                maximumFractionDigits: meta.decimals,
            })
        );
    }

    /** @type {HTMLElement | null} */
    let currencyDropdownEl = null;

    const currCodeEl = document.getElementById('mo-btc-currency');
    const btcPriceBarEl = document.getElementById('btc-price-bar');

    function openCurrencyDropdown() {
        closeCurrencyDropdown();
        const dd = document.createElement('div');
        dd.className = 'currency-dropdown';
        dd.id = 'currency-dropdown';
        let html = '<div class="curr-title">Select Currency</div><div class="curr-grid">';
        for (const c of CURRENCIES) {
            html += `<button class="curr-btn${c === priceController.currency ? ' active' : ''}" data-curr="${c}">${c}</button>`;
        }
        html += '</div>';
        html += `<div class="curr-freq"><span>Update every</span><input type="number" id="curr-freq-input" value="${CFG.infoPollInterval / 1000}" min="5" max="99"><span>sec</span></div>`;
        // Show last price error if any
        if (lastPriceInfo && lastPriceInfo.last_price_error) {
            html += `<div class="curr-error" style="color:var(--text-muted);font-size:9px;padding:6px 8px 2px;border-top:1px solid rgba(255,255,255,0.06)">${escapeHtml(lastPriceInfo.last_price_error)}</div>`;
        }
        dd.innerHTML = html;
        document.body.appendChild(dd);
        currencyDropdownEl = dd;

        // Position below the centered BTC price bar
        const anchor = btcPriceBarEl || currCodeEl;
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            const ddWidth = 200; // approx dropdown width
            dd.style.left = Math.max(8, rect.left + rect.width / 2 - ddWidth / 2) + 'px';
            dd.style.top = rect.bottom + 6 + 'px';
        }

        queryAll('.curr-btn', dd).forEach((btn) => {
            btn.addEventListener('click', () => {
                priceController.setCurrency(btn.dataset.curr || 'USD');
                queryAll('.curr-btn', dd).forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        /** @type {HTMLInputElement} */
        const freqInput = required('#curr-freq-input');
        if (freqInput) {
            freqInput.addEventListener('change', () => {
                const v = clamp(parseInt(freqInput.value) || 10, 5, 99);
                freqInput.value = String(v);
                // Restart info poll with new interval
                CFG.infoPollInterval = v * 1000;
                onAction({ type: 'intervals' });
            });
        }

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeCurrencyOnOutside);
        }, 0);
    }

    /** @param {MouseEvent} e */
    function closeCurrencyOnOutside(e) {
        const bar = btcPriceBarEl || currCodeEl;
        if (
            currencyDropdownEl &&
            !currencyDropdownEl.contains(e.target instanceof Node ? e.target : null) &&
            (!bar || !bar.contains(e.target instanceof Node ? e.target : null))
        ) {
            closeCurrencyDropdown();
        }
    }

    function closeCurrencyDropdown() {
        if (currencyDropdownEl) {
            currencyDropdownEl.remove();
            currencyDropdownEl = null;
        }
        document.removeEventListener('click', closeCurrencyOnOutside);
    }

    // ═══════════════════════════════════════════════════════════
    // GEODB MANAGEMENT DROPDOWN
    // ═══════════════════════════════════════════════════════════

    /** Open GeoIP DB as a centered modal (like Node Info) */
    function openGeoDBDropdown() {
        const existing = document.getElementById('geodb-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'geodb-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:480px"><div class="modal-header"><span class="modal-title">GeoIP DB</span><button class="modal-close" id="geodb-modal-close">&times;</button></div><div class="modal-body" id="geodb-modal-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        required('#geodb-modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const body = required('#geodb-modal-body');

        if (lastNodeInfo && lastNodeInfo.geo_db_stats) {
            const stats = lastNodeInfo.geo_db_stats;
            const statusText = stats.status || 'unknown';
            const statusCls = statusText === 'ok' ? 'ok' : statusText === 'disabled' ? 'disabled' : 'error';
            let html = '';
            html += `<div class="modal-row"><span class="modal-label" title="Database health status">Status</span><span class="geodb-status-badge ${statusCls}" title="${escapeHtml(statusText.toUpperCase())}">${escapeHtml(statusText.toUpperCase())}</span></div>`;
            if (stats.entries != null)
                html += mrow(
                    'Entries',
                    stats.entries.toLocaleString(),
                    'Total number of IP geolocation records in the database',
                    `${stats.entries.toLocaleString()} records`
                );
            if (stats.size_bytes != null)
                html += mrow(
                    'Size',
                    (stats.size_bytes / 1e6).toFixed(1) + ' MB',
                    'Database file size on disk',
                    `${(stats.size_bytes / 1e6).toFixed(1)} MB`
                );
            if (stats.newest_age_seconds != null) {
                const secs = stats.newest_age_seconds;
                let newestText;
                if (secs >= 86400) {
                    newestText = Math.floor(secs / 86400) + ' days';
                } else if (secs >= 3600) {
                    const h = Math.floor(secs / 3600);
                    const m = Math.floor((secs % 3600) / 60);
                    newestText = h + 'h ' + m + 'm';
                } else if (secs >= 60) {
                    const m = Math.floor(secs / 60);
                    const s = secs % 60;
                    newestText = m + 'm ' + s + 's';
                } else {
                    newestText = secs + 's';
                }
                html += mrow('Newest Entry', newestText, 'Age of the newest geolocation record', newestText + ' old');
            } else if (stats.newest_age_days != null) {
                html += mrow(
                    'Newest Entry',
                    stats.newest_age_days + ' days',
                    'Age of the newest geolocation record',
                    `${stats.newest_age_days} days old`
                );
            }
            if (stats.oldest_age_days != null)
                html += mrow(
                    'Oldest Entry',
                    stats.oldest_age_days + ' days',
                    'Age of the oldest geolocation record',
                    `${stats.oldest_age_days} days old`
                );
            if (stats.path)
                html += `<div class="modal-row"><span class="modal-label" title="File system path to the database">Path</span><span class="modal-val" style="font-size:9px;max-width:260px" title="${escapeHtml(stats.path)}">${escapeHtml(stats.path)}</span></div>`;
            const alVal = stats.auto_lookup ? 'On' : 'Off';
            html += mrow(
                'Auto-resolve',
                alVal,
                'Master switch — enables the GeoIP system that resolves peer IPs to locations on the map',
                alVal,
                stats.auto_lookup ? 'modal-val-ok' : 'modal-val-warn'
            );
            // Auto-update toggle switch (persists to settings.json)
            const auOn = !!stats.auto_update;
            html += `<div class="modal-row"><span class="modal-label" title="Automatically update the geolocation database (at startup and once per hour while the map is open)">Auto-update</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle" title="${auOn ? 'Click to disable auto-update' : 'Click to enable auto-update'}"><input type="checkbox" id="geodb-autoupdate-toggle" ${auOn ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
            // API Lookup toggle switch (no On/Off text — slider colour shows state)
            const dbOnly = stats.db_only_mode || false;
            const apiOn = !dbOnly;
            html += `<div class="modal-row"><span class="modal-label" title="When ON, unknown IPs are looked up via ip-api.com. When OFF, only cached database entries are used.">API Lookup</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle" title="${apiOn ? 'Click to disable API lookups' : 'Click to enable API lookups'}"><input type="checkbox" id="geodb-dbonly-toggle" ${apiOn ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
            html += '<button class="geodb-update-btn" id="geodb-update-btn">Update Database</button>';
            html += '<div class="geodb-result" id="geodb-result"></div>';
            body.innerHTML = html;

            // Auto-update toggle handler (persists to settings.json)
            required('#geodb-autoupdate-toggle').addEventListener('change', async () => {
                try {
                    const resp = await fetch('/api/geodb/toggle-auto-update', { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        // Refresh info + modal, and start/stop the hourly timer
                        fetchInfo().then(() => {
                            syncDbAutoUpdateTimer();
                            openGeoDBDropdown();
                        });
                    }
                } catch (err) {
                    console.error('Toggle auto-update failed:', err);
                }
            });

            // DB-only toggle handler
            required('#geodb-dbonly-toggle').addEventListener('change', async () => {
                try {
                    const resp = await fetch('/api/geodb/toggle-db-only', { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        // Refresh the modal
                        fetchInfo().then(() => openGeoDBDropdown());
                    }
                } catch (err) {
                    console.error('Toggle DB-only failed:', err);
                }
            });

            required('#geodb-update-btn').addEventListener('click', async () => {
                const resultEl = required('#geodb-result');
                resultEl.textContent = 'Updating...';
                resultEl.style.color = 'var(--text-secondary)';
                try {
                    const resp = await fetch('/api/geodb/update', { method: 'POST' });
                    const data = await resp.json();
                    resultEl.textContent = data.message || (data.success ? 'Done' : 'Failed');
                    resultEl.style.color = data.success ? 'var(--ok)' : 'var(--err)';
                } catch (err) {
                    resultEl.textContent = 'Error: ' + errorMessage(err);
                    resultEl.style.color = 'var(--err)';
                }
            });
        } else {
            body.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;text-align:center">No GeoDB data available</div>';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECT PEER MODAL
    // ═══════════════════════════════════════════════════════════

    function openConnectPeerModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'connect-peer-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:520px">
        <div class="modal-header"><span class="modal-title">Connect Peer</span><button class="modal-close" id="connect-close">&times;</button></div>
        <div class="modal-body">
            <div class="connect-instructions">Enter a peer address to connect. Your node will attempt a one-time (onetry) connection.</div>
            <div class="connect-example">IPv4: 1.2.3.4:8333</div>
            <div class="connect-example">IPv6: [2001:db8::1]:8333</div>
            <div class="connect-example">Tor: abc...xyz.onion:8333</div>
            <div class="connect-example">I2P: abc...xyz.b32.i2p:0</div>
            <div class="connect-example">CJDNS: [fc00::1]:8333</div>
            <div class="connect-input-row">
                <input type="text" class="connect-input" id="connect-addr-input" placeholder="Enter peer address...">
                <button class="connect-btn" id="connect-go-btn">Connect</button>
            </div>
            <div class="connect-result" id="connect-result"></div>
            <div class="connect-permanent-hint">For a permanent connection, add the peer to the Bitcoin node's <code>addnode</code> configuration.</div>
        </div>
    </div>`;
        document.body.appendChild(overlay);
        required('#connect-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        /** @type {HTMLInputElement} */
        const input = required('#connect-addr-input');
        const goBtn = required('#connect-go-btn');
        const resultEl = required('#connect-result');
        goBtn.addEventListener('click', async () => {
            const addr = input.value.trim();
            if (!addr) {
                resultEl.textContent = 'Please enter an address';
                resultEl.className = 'connect-result err';
                return;
            }
            resultEl.textContent = 'Connecting...';
            resultEl.className = 'connect-result';
            try {
                const resp = await fetch('/api/peer/connect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: addr }),
                });
                const data = await resp.json();
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

    // Node Info button handler (old handle btn, kept for compatibility)
    const nodeInfoBtn = document.getElementById('btn-node-info');
    if (nodeInfoBtn) {
        nodeInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openNodeInfoModal();
        });
    }

    // System Info button handler (old handle btn, kept for compatibility)
    const systemInfoBtn = document.getElementById('btn-system-info');
    if (systemInfoBtn) {
        systemInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSystemInfoModal();
        });
    }

    // Right overlay: NODE INFO link → opens Node Info modal
    const roNodeInfoLink = document.getElementById('ro-node-info');
    if (roNodeInfoLink) {
        roNodeInfoLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openNodeInfoModal();
        });
    }

    // Right overlay: GEOIP DB link
    const roGeodbLink = document.getElementById('ro-geodb-link');
    if (roGeodbLink) {
        roGeodbLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openGeoDBDropdown();
        });
    }

    // Left overlay: Peers/CPU/RAM/NET rows → click opens system info modal
    ['mo-row-peers', 'mo-row-cpu', 'mo-row-ram', 'mo-row-netin', 'mo-row-netout'].forEach((id) => {
        const el = document.getElementById(id);
        if (el)
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                openSystemInfoModal();
            });
    });

    // BTC price bar: click toggles currency selector
    const btcPriceBar = document.getElementById('btc-price-bar');
    if (btcPriceBar) {
        btcPriceBar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currencyDropdownEl) {
                closeCurrencyDropdown();
            } else {
                openCurrencyDropdown();
            }
        });
    }

    // Right overlay: click Update/Status rows → open settings popup
    ['ro-row-countdown', 'ro-row-statusmsg'].forEach((id) => {
        const el = document.getElementById(id);
        if (el)
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(el);
            });
    });

    // Right overlay: DISPLAY SETTINGS link → open settings popup
    const roDisplaySettingsLink = document.getElementById('ro-display-settings-link');
    if (roDisplaySettingsLink) {
        roDisplaySettingsLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openDisplaySettingsPopup(roDisplaySettingsLink);
        });
    }

    // ═══════════════════════════════════════════════════════════

    /** @type {import('../types').NodeInfo | null} */
    let lastNodeInfo = null; // Full /api/info response for Node Info card

    // Track previous internet state for toast notifications
    let _prevInternetState = 'green';
    let _lastRestoredToastTime = 0;

    // ── DB auto-update — once per hour while map is open ──
    const DB_AUTO_UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour
    /** @type {number | null} */
    let dbAutoUpdateTimer = null;
    const dbStatusEl = document.getElementById('db-update-status');

    /** Show a temporary message in the top bar DB status area.
     *
     * @param {string} text
     * @param {string} [cls]
     */
    function showDbStatus(text, cls) {
        if (!dbStatusEl) return;
        dbStatusEl.textContent = text;
        dbStatusEl.className = 'db-update-status' + (cls ? ' ' + cls : '');
        dbStatusEl.style.display = '';
    }
    function hideDbStatus() {
        if (!dbStatusEl) return;
        dbStatusEl.style.display = 'none';
        dbStatusEl.textContent = '';
        dbStatusEl.className = 'db-update-status';
    }

    /**
     * @param {import('../types').NodeTraffic | null} traffic
     */
    function updateNodeTrafficTotals(traffic) {
        if (!traffic) return;
        const inEl = document.getElementById('mo-p2p-in');
        const outEl = document.getElementById('mo-p2p-out');
        const downloaded = Number(traffic.download_bytes || 0);
        const uploaded = Number(traffic.upload_bytes || 0);
        if (inEl) {
            inEl.textContent = traffic.download_fmt || BPMFormat.fmtBytesShort(downloaded);
            inEl.title = `${downloaded.toLocaleString()} bytes downloaded since the Bitcoin node started`;
            pulseOnChange('mo-p2p-in', downloaded, 'white');
        }
        if (outEl) {
            outEl.textContent = traffic.upload_fmt || BPMFormat.fmtBytesShort(uploaded);
            outEl.title = `${uploaded.toLocaleString()} bytes uploaded since the Bitcoin node started`;
            pulseOnChange('mo-p2p-out', uploaded, 'white');
        }
    }

    /** Run the DB auto-update sequence: countdown → check → result. */
    async function performDbAutoUpdate() {
        // 3-second countdown
        for (let i = 3; i >= 1; i--) {
            showDbStatus(`Updating DB in ${i}...`);
            await new Promise((r) => setTimeout(r, 1000));
        }
        showDbStatus('Checking for DB update...');
        try {
            const resp = await fetch('/api/geodb/update', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                const isUpToDate = data.message && data.message.toLowerCase().includes('up to date');
                showDbStatus(isUpToDate ? 'DB already up to date' : 'DB successfully updated', 'success');
            } else {
                showDbStatus('DB update failed', 'error');
            }
        } catch (e) {
            showDbStatus('DB update failed', 'error');
        }
        // Auto-dismiss after 3 seconds
        setTimeout(hideDbStatus, 3000);
    }

    /** Start or stop the hourly DB auto-update timer based on current setting. */
    function syncDbAutoUpdateTimer() {
        const stats = lastNodeInfo && lastNodeInfo.geo_db_stats;
        const autoOn = stats && stats.auto_lookup && stats.auto_update;
        if (autoOn && !dbAutoUpdateTimer) {
            dbAutoUpdateTimer = setInterval(performDbAutoUpdate, DB_AUTO_UPDATE_INTERVAL);
        } else if (!autoOn && dbAutoUpdateTimer) {
            clearInterval(dbAutoUpdateTimer);
            dbAutoUpdateTimer = null;
            hideDbStatus();
        }
    }

    function fetchInfo() {
        return infoPolling.run();
    }

    async function refreshNodeInfo() {
        try {
            const resp = await fetch('/api/info?include_price=false');
            if (!resp.ok) return;
            /** @type {import('../types').NodeInfo} */
            const info = await resp.json();

            lastNodeInfo = info;

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
            if (info.internet_state === 'green' && info.api_available === false && !info.geo_db_only_mode) {
                checkApiDownPrompt();
            }

            updateNodeTrafficTotals(info.node_traffic);

            // Update right overlay GeoIP DB count
            if (info.geo_db_stats && info.geo_db_stats.entries != null) {
                const geodbCountEl = document.getElementById('ro-geodb-count');
                if (geodbCountEl) geodbCountEl.textContent = info.geo_db_stats.entries.toLocaleString();
            }

            // Store flight deck scores for tooltip display
            if (info.network_scores) {
                fdCachedScores.ipv4 = info.network_scores.ipv4;
                fdCachedScores.ipv6 = info.network_scores.ipv6;
            }
            fdCachedNetworkDetails = info.network_details || {};

            updateHUD();
        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to fetch info:', err);
        }
    }

    const nodeMonitor = BPMNodeMonitor.create({
        getNodeInfo: () => lastNodeInfo,
        getCurrency: () => priceController.currency,
        currencyMeta: CURRENCY_META,
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

    /** Update BTC Price in left map overlay + ₿ symbol coloring
     *
     * @param {import('../types').PriceInfo} info
     */
    function updateBtcPricePanel(info) {
        const priceEl = document.getElementById('mo-btc-price');
        const arrowEl = document.getElementById('mo-btc-arrow');
        if (!priceEl) return;

        // Remove any existing asterisks
        let existingAst = priceEl.parentElement && query('.price-offline-ast', priceEl.parentElement);
        if (existingAst) existingAst.remove();

        if (info.btc_price) {
            const price = Number(info.btc_price);
            priceEl.textContent = formatCurrencyPrice(price, priceController.currency);
            priceEl.style.color = '';
            priceEl.title = '';

            // Persistent coloring on price element (red/green on change)
            const dir = pulseOnChange('mo-btc-price', price, 'persistent');

            // ₿ symbol stays gold normally — price text gets red/green
            // Arrow indicator shows direction
            if (arrowEl && dir) {
                arrowEl.textContent = dir > 0 ? '\u25B2' : '\u25BC';
                arrowEl.className = 'mo-btc-arrow ' + (dir > 0 ? 'arrow-up' : 'arrow-down');
            }
        } else if (info.last_known_price) {
            // Offline but have a cached price — show grey with red asterisks
            const price = parseFloat(info.last_known_price);
            const curr = info.last_price_currency || priceController.currency;
            priceEl.textContent = formatCurrencyPrice(price, curr);
            priceEl.style.color = 'var(--text-muted)';
            priceEl.title = 'OFFLINE... Waiting for connection';
            if (arrowEl) {
                arrowEl.textContent = '';
                arrowEl.className = 'mo-btc-arrow';
            }
            // Add red asterisks
            const ast = document.createElement('span');
            ast.className = 'price-offline-ast';
            ast.textContent = '**';
            ast.style.cssText = 'color:var(--err);font-weight:700;margin-left:3px;font-size:11px';
            priceEl.parentElement?.appendChild(ast);
        } else {
            // No price at all — show dashes
            priceEl.textContent = '- - -';
            priceEl.style.color = 'var(--text-muted)';
            priceEl.title = 'OFFLINE... Waiting for connection';
            if (arrowEl) {
                arrowEl.textContent = '';
                arrowEl.className = 'mo-btc-arrow';
            }
            // Add red asterisks
            const ast = document.createElement('span');
            ast.className = 'price-offline-ast';
            ast.textContent = '**';
            ast.style.cssText = 'color:var(--err);font-weight:700;margin-left:3px;font-size:11px';
            priceEl.parentElement?.appendChild(ast);
        }

        // Currency code display
        const codeEl = document.getElementById('mo-btc-currency');
        if (codeEl) codeEl.textContent = priceController.currency;
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
        const statusEl = document.getElementById('peer-data-status');
        const ageEl = document.getElementById('peer-data-age');
        const dot = document.getElementById('status-dot');
        if (statusEl) {
            statusEl.dataset.state = status.state;
            if (statusEl.textContent !== label) statusEl.textContent = label;
            statusEl.title = status.stale
                ? 'Showing the last successful peer snapshot. Refresh will retry automatically.'
                : 'Connection status for peer data from your Bitcoin node';
        }
        if (ageEl) {
            const seconds = status.ageSeconds === null ? null : Math.floor(status.ageSeconds);
            const age =
                seconds === null
                    ? 'Never'
                    : seconds < 60
                      ? seconds + 's ago'
                      : seconds < 3600
                        ? Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's ago'
                        : Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm ago';
            ageEl.textContent = age + (status.stale ? ' (cached)' : '');
            ageEl.dataset.stale = String(status.stale);
            ageEl.title =
                status.lastSuccessAt === null
                    ? 'No successful peer snapshot yet'
                    : 'Last successful peer snapshot: ' + new Date(status.lastSuccessAt * 1000).toLocaleString();
        }
        if (dot) {
            dot.classList.toggle('online', status.state === 'live');
            dot.classList.toggle('pending', status.state === 'connecting' || status.state === 'delayed');
            dot.title = label;
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
        const txt = document.getElementById('internet-text');
        if (!dot) return;
        dot.classList.remove('green', 'yellow', 'red');
        dot.classList.add(state);
        let tip;
        if (state === 'green') {
            tip = 'Internet connection is active';
        } else if (state === 'yellow') {
            tip = 'Detecting connection issues, retrying...';
        } else {
            tip = 'No internet connection detected';
        }
        dot.title = tip;
        if (txt) txt.title = tip;
    }

    function showConnectionRestoredToast() {
        // Remove any existing toast
        const existing = document.getElementById('conn-restored-toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = 'conn-restored-toast';
        el.textContent = 'Connection restored';
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

    // API-down modal: shown when internet is up but geo API is failing
    let _apiDownModalVisible = false;

    async function checkApiDownPrompt() {
        if (_apiDownModalVisible) return;
        try {
            const resp = await fetch('/api/connectivity');
            const data = await resp.json();
            if (data.api_down_prompt && !data.geo_db_only_mode) {
                showApiDownModal();
                // Acknowledge we showed the prompt
                fetch('/api/connectivity/api-prompt-ack', { method: 'POST' });
            }
        } catch (e) {
            /* ignore */
        }
    }

    function showApiDownModal() {
        if (_apiDownModalVisible) return;
        _apiDownModalVisible = true;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'api-down-modal';
        overlay.innerHTML = `
        <div class="modal-box" style="max-width:440px">
            <div class="modal-header">
                <span class="modal-title">Geolocation API Not Responding</span>
                <button class="modal-close" id="api-down-close">&times;</button>
            </div>
            <div class="modal-body" style="padding:16px">
                <p style="color:var(--text-secondary);margin:0 0 12px;font-size:12px">
                    The geolocation API is not responding, but your internet connection appears to be working.
                </p>
                <p style="color:var(--text-muted);margin:0 0 16px;font-size:11px">
                    You can switch to database-only mode (uses cached locations only) or keep trying the API.
                </p>
                <div style="display:flex;gap:8px;justify-content:center">
                    <button class="geodb-update-btn" id="api-down-dbonly" style="background:rgba(210,153,34,0.15);color:var(--warn);border-color:rgba(210,153,34,0.3)">Database-Only Mode</button>
                    <button class="geodb-update-btn" id="api-down-keep">Keep Trying</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            _apiDownModalVisible = false;
        };

        required('#api-down-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        required('#api-down-dbonly').addEventListener('click', async () => {
            try {
                await fetch('/api/geodb/toggle-db-only', { method: 'POST' });
            } catch (e) {
                /* ignore */
            }
            close();
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
        if (moStatus && lastNodeInfo) {
            if (lastNodeInfo.blockchain && lastNodeInfo.blockchain.ibd) {
                moStatus.textContent = 'Syncing (IBD)';
                moStatus.style.color = 'var(--warn)';
                moStatus.title = 'Initial Block Download in progress — node is still catching up to the network';
            } else {
                moStatus.textContent = 'Synced';
                moStatus.style.color = 'var(--ok)';
                moStatus.title = 'IBD Completed — node is fully synced with the network';
            }
        }

        // Map overlay — status message (like original: "Map Loaded!" / "Locating X peers...")
        const moMsg = document.getElementById('mo-status-msg');
        if (moMsg) {
            const inetState = lastNodeInfo ? lastNodeInfo.internet_state : 'green';
            const apiAvail = lastNodeInfo ? lastNodeInfo.api_available : true;
            const dbOnly = lastNodeInfo ? lastNodeInfo.geo_db_only_mode : false;

            if (inetState === 'red') {
                moMsg.textContent = 'Offline';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--err)';
            } else if (inetState === 'yellow') {
                moMsg.textContent = 'Connection issues...';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else if (dbOnly || apiAvail === false) {
                moMsg.textContent = 'Geo service unavailable';
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
                if (n.ping_ms > 0) {
                    totalPing += n.ping_ms;
                    pingCount++;
                }
            }
        }

        const total = net === 'all' ? aliveNodes.length : counts[net] || 0;
        const detailsForNet = net !== 'all' ? fdCachedNetworkDetails[net] : null;

        if (total === 0 && net !== 'all' && !detailsForNet) return null;

        const avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : '—';
        const label = net === 'all' ? 'All Networks' : NET_DISPLAY[net] || net.toUpperCase();

        let html = `<div class="pop-title">${label}</div>`;
        html += `<div class="pop-row"><span class="pop-label">Peers</span><span class="pop-val">${total}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Inbound</span><span class="pop-val">${inbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Outbound</span><span class="pop-val">${outbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Avg Ping</span><span class="pop-val">${avgPing}${avgPing !== '—' ? 'ms' : ''}</span></div>`;
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
    // SYSTEM INFO — CPU/RAM from /api/stats (data stored for modal)
    // ═══════════════════════════════════════════════════════════

    async function fetchSystemStats() {
        try {
            const resp = await fetch('/api/stats');
            if (!resp.ok) return;
            const data = await resp.json();
            renderSystemInfoCard(data.system_stats || {});
        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to fetch system stats:', err);
        }
    }

    const systemStatsPolling = BPMPolling.create({
        task: fetchSystemStats,
        intervalMs: effectivePollInterval(30000),
    });

    /** @type {import('../types').SystemStats | null} */
    let lastSystemStats = null;

    /** SSE stream reference (declared early so renderSystemInfoCard can check it)
     * @type {EventSource | null} */
    let sysStreamSource = null;
    let sysStreamRetryDelay = 1000;
    /** @type {number | null} */
    let sysStreamRetryTimer = null;

    /**
     * @param {import('../types').SystemStats} stats
     */
    function renderSystemInfoCard(stats) {
        // Merge modal-only fields (uptime, load, disk) into lastSystemStats
        // CPU/RAM/NET are driven by the SSE stream — don't overwrite those here
        if (!lastSystemStats) lastSystemStats = {};
        if (stats.uptime) lastSystemStats.uptime = stats.uptime;
        if (stats.uptime_sec) lastSystemStats.uptime_sec = stats.uptime_sec;
        if (stats.load_1 != null) lastSystemStats.load_1 = stats.load_1;
        if (stats.load_5 != null) lastSystemStats.load_5 = stats.load_5;
        if (stats.load_15 != null) lastSystemStats.load_15 = stats.load_15;
        if (stats.disk_total_gb != null) lastSystemStats.disk_total_gb = stats.disk_total_gb;
        if (stats.disk_used_gb != null) lastSystemStats.disk_used_gb = stats.disk_used_gb;
        if (stats.disk_free_gb != null) lastSystemStats.disk_free_gb = stats.disk_free_gb;
        if (stats.disk_pct != null) lastSystemStats.disk_pct = stats.disk_pct;
        if (stats.cpu_breakdown) lastSystemStats.cpu_breakdown = stats.cpu_breakdown;

        // Only update CPU/RAM display if SSE stream is not active (fallback)
        if (!sysStreamSource) {
            const cpuEl = document.getElementById('ro-cpu');
            const ramEl = document.getElementById('ro-ram');
            if (cpuEl && stats.cpu_pct != null) {
                const cpuPct = Math.round(stats.cpu_pct);
                cpuEl.textContent = cpuPct + '%';
                pulseOnChange('ro-cpu', cpuPct, 'white');
            }
            if (ramEl && stats.mem_pct != null) {
                const memPct = Math.round(stats.mem_pct);
                ramEl.textContent = memPct + '%';
                pulseOnChange('ro-ram', memPct, 'white');
            }
        }

        // Update right overlay GeoIP DB entry count
        const geodbCountEl = document.getElementById('ro-geodb-count');
        if (geodbCountEl && lastNodeInfo && lastNodeInfo.geo_db_stats && lastNodeInfo.geo_db_stats.entries != null) {
            geodbCountEl.textContent = lastNodeInfo.geo_db_stats.entries.toLocaleString();
        }
    }

    /** Open combined System Info modal — system stats + NET bar settings + display toggles + recent changes */
    function openSystemInfoModal() {
        const existing = document.getElementById('system-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'system-info-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:560px"><div class="modal-header"><span class="modal-title">System Info</span><button class="modal-close" id="system-info-close">&times;</button></div><div class="modal-body" id="system-info-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        required('#system-info-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        const body = required('#system-info-body');
        const stats = lastSystemStats || {};
        const cpuPct = stats.cpu_pct != null ? Math.round(stats.cpu_pct) : null;
        const memPct = stats.mem_pct != null ? Math.round(stats.mem_pct) : null;
        const memUsed = stats.mem_used_mb;
        const memTotal = stats.mem_total_mb;
        let html = '';

        // ── Section 1: System Overview ──
        html += '<div class="modal-section-title">System</div>';
        // CPU with bar
        html += '<div class="info-row"><span class="info-label">CPU</span>';
        if (cpuPct != null) {
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${cpuPct}%"></span><span class="info-bar-text">${cpuPct}%</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';
        // RAM with bar
        html += '<div class="info-row"><span class="info-label">RAM</span>';
        if (memPct != null) {
            const memStr = memUsed && memTotal ? `${memPct}% (${memUsed}/${memTotal} MB)` : `${memPct}%`;
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${memPct}%"></span><span class="info-bar-text">${memStr}</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';
        // Uptime
        if (stats.uptime) {
            html += `<div class="info-row"><span class="info-label">Uptime</span><span class="info-val">${escapeHtml(stats.uptime)}</span></div>`;
        }
        // Load average
        if (stats.load_1 != null) {
            html += `<div class="info-row"><span class="info-label">Load Avg</span><span class="info-val">${stats.load_1.toFixed(2)} / ${(stats.load_5 ?? 0).toFixed(2)} / ${(stats.load_15 ?? 0).toFixed(2)}</span></div>`;
        }
        // Disk usage
        if (stats.disk_pct != null) {
            const diskStr = `${stats.disk_pct}% (${stats.disk_used_gb} / ${stats.disk_total_gb} GB)`;
            html += `<div class="info-row"><span class="info-label">Disk</span><span class="info-val info-bar-wrap"><span class="info-bar" style="width:${stats.disk_pct}%"></span><span class="info-bar-text">${diskStr}</span></span></div>`;
        }

        // ── Section 2: Network Traffic ──
        html += '<div class="modal-section-title">Network Traffic</div>';
        if (lastNetTraffic) {
            const rx = lastNetTraffic.rx_bps || 0;
            const tx = lastNetTraffic.tx_bps || 0;
            const curMaxIn = netBarMode === 'manual' ? netBarManualMaxIn : getAdaptiveMax(netHistoryIn);
            const curMaxOut = netBarMode === 'manual' ? netBarManualMaxOut : getAdaptiveMax(netHistoryOut);
            const rxPct = Math.min(100, (rx / curMaxIn) * 100);
            const txPct = Math.min(100, (tx / curMaxOut) * 100);
            html += `<div class="info-row"><span class="info-label">IN \u2193</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-in" style="width:${rxPct}%"></span></span><span class="net-traffic-rate">${formatBps(rx)}</span></span></div>`;
            html += `<div class="info-row"><span class="info-label">OUT \u2191</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-out" style="width:${txPct}%"></span></span><span class="net-traffic-rate">${formatBps(tx)}</span></span></div>`;
            html += `<div class="info-row" style="margin-top:2px"><span class="info-label">Current Max</span><span class="info-val" style="font-size:10px">IN: ${formatBps(curMaxIn)} \u00b7 OUT: ${formatBps(curMaxOut)}</span></div>`;
        } else {
            html += '<div style="color:var(--text-muted);padding:4px 0">No traffic data yet</div>';
        }
        if (lastNodeInfo && lastNodeInfo.node_traffic) {
            const traffic = lastNodeInfo.node_traffic;
            html += `<div class="info-row"><span class="info-label">P2P IN \u2193</span><span class="info-val">${escapeHtml(traffic.download_fmt || BPMFormat.fmtBytesShort(traffic.download_bytes || 0))}</span></div>`;
            html += `<div class="info-row"><span class="info-label">P2P OUT \u2191</span><span class="info-val">${escapeHtml(traffic.upload_fmt || BPMFormat.fmtBytesShort(traffic.upload_bytes || 0))}</span></div>`;
        }

        // ── Section 3: NET Bar Settings ──
        html += '<div class="modal-section-title">NET Bar Scaling</div>';
        const manualMaxInKB = Math.round(netBarManualMaxIn / 1024);
        const manualMaxOutKB = Math.round(netBarManualMaxOut / 1024);
        html += '<div class="si-net-mode">';
        html += `<label class="si-radio"><input type="radio" name="si-netbar-mode" value="auto" ${netBarMode === 'auto' ? 'checked' : ''}><span class="si-radio-dot"></span><span class="si-radio-text"><span class="si-radio-label">Auto-detect</span><span class="si-radio-desc">Adapts to p90 of recent traffic (recommended)</span></span></label>`;
        html += `<label class="si-radio"><input type="radio" name="si-netbar-mode" value="manual" ${netBarMode === 'manual' ? 'checked' : ''}><span class="si-radio-dot"></span><span class="si-radio-text"><span class="si-radio-label">Manual</span><span class="si-radio-desc">Set fixed max values for bar scaling</span></span></label>`;
        html += '</div>';
        html += `<div class="si-manual-fields" id="si-manual-fields" style="display:${netBarMode === 'manual' ? 'block' : 'none'}">`;
        html += `<div class="info-row"><span class="info-label">Max IN</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="si-max-in" value="${manualMaxInKB}" min="1" max="999999"><span class="dsp-unit">KB/s</span></div></div>`;
        html += `<div class="info-row"><span class="info-label">Max OUT</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="si-max-out" value="${manualMaxOutKB}" min="1" max="999999"><span class="dsp-unit">KB/s</span></div></div>`;
        html += '</div>';

        // ── Section 4: Dashboard Display ──
        html += '<div class="modal-section-title">Dashboard Display</div>';
        const dashItems = [
            { id: 'mo-row-cpu', label: 'CPU' },
            { id: 'mo-row-ram', label: 'RAM' },
            { id: 'mo-row-netin', label: 'NET \u2193 (Download)' },
            { id: 'mo-row-netout', label: 'NET \u2191 (Upload)' },
        ];
        dashItems.forEach((item) => {
            const el = document.getElementById(item.id);
            const vis = el ? el.style.display !== 'none' : true;
            html += `<div class="info-row"><span class="info-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" class="si-dash-toggle" data-target="${item.id}" ${vis ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        });

        body.innerHTML = html;

        // ── Bind NET bar mode radios ──
        /** @type {HTMLInputElement[]} */
        const modeRadios = queryAll('input[name="si-netbar-mode"]', body);
        const manualFields = document.getElementById('si-manual-fields');
        modeRadios.forEach((radio) => {
            radio.addEventListener('change', () => {
                netBarMode = radio.value;
                if (manualFields) manualFields.style.display = netBarMode === 'manual' ? 'block' : 'none';
                updateHandleTrafficBars();
            });
        });

        // ── Bind manual max inputs ──
        /** @type {HTMLInputElement} */
        const maxInInput = required('#si-max-in');
        /** @type {HTMLInputElement} */
        const maxOutInput = required('#si-max-out');
        if (maxInInput) {
            maxInInput.addEventListener('change', () => {
                const v = clamp(parseInt(maxInInput.value) || 100, 1, 999999);
                maxInInput.value = String(v);
                netBarManualMaxIn = v * 1024;
                if (netBarMode === 'manual') updateHandleTrafficBars();
            });
        }
        if (maxOutInput) {
            maxOutInput.addEventListener('change', () => {
                const v = clamp(parseInt(maxOutInput.value) || 100, 1, 999999);
                maxOutInput.value = String(v);
                netBarManualMaxOut = v * 1024;
                if (netBarMode === 'manual') updateHandleTrafficBars();
            });
        }

        // ── Bind dashboard display toggles ──
        /** @type {HTMLInputElement[]} */ (queryAll('.si-dash-toggle', body)).forEach((cb) => {
            cb.addEventListener('change', () => {
                const target = document.getElementById(cb.dataset.target || '');
                if (target) target.style.display = cb.checked ? '' : 'none';
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // NETWORK TRAFFIC + SYSTEM STATS — SSE stream with dual-EMA
    // ═══════════════════════════════════════════════════════════

    /** @type {{rx_bps: number; tx_bps: number} | null} */
    let lastNetTraffic = null;

    // NET bar scaling mode: 'auto' uses p90 adaptive, 'manual' uses fixed max values
    let netBarMode = 'auto';
    let netBarManualMaxIn = 1024 * 1024; // 1 MB/s default manual max for IN
    let netBarManualMaxOut = 1024 * 1024; // 1 MB/s default manual max for OUT

    // History arrays for adaptive max (from original dashboard)
    /** @type {number[]} */
    const netHistoryIn = [];
    /** @type {number[]} */
    const netHistoryOut = [];
    const NET_HISTORY_SIZE = 30;

    /**
     * @param {number[]} history
     */
    function getAdaptiveMax(history) {
        if (history.length < 3) return 50 * 1024;
        const sorted = [...history].sort((a, b) => a - b);
        const p90Index = Math.floor(sorted.length * 0.9);
        const p90 = sorted[p90Index] || sorted[sorted.length - 1];
        return Math.max(p90 * 1.2, 10 * 1024);
    }

    /** Update the traffic bars in the right overlay */
    function updateHandleTrafficBars() {
        if (!lastNetTraffic) return;
        const rx = lastNetTraffic.rx_bps || 0;
        const tx = lastNetTraffic.tx_bps || 0;

        // Push to history for adaptive scaling
        netHistoryIn.push(rx);
        netHistoryOut.push(tx);
        if (netHistoryIn.length > NET_HISTORY_SIZE) netHistoryIn.shift();
        if (netHistoryOut.length > NET_HISTORY_SIZE) netHistoryOut.shift();

        const maxIn = netBarMode === 'manual' ? netBarManualMaxIn : getAdaptiveMax(netHistoryIn);
        const maxOut = netBarMode === 'manual' ? netBarManualMaxOut : getAdaptiveMax(netHistoryOut);

        const rxPct = Math.min(100, (rx / maxIn) * 100);
        const txPct = Math.min(100, (tx / maxOut) * 100);

        const barIn = document.getElementById('ro-bar-in');
        const barOut = document.getElementById('ro-bar-out');
        const rateIn = document.getElementById('ro-rate-in');
        const rateOut = document.getElementById('ro-rate-out');

        if (barIn) barIn.style.width = rxPct + '%';
        if (barOut) barOut.style.width = txPct + '%';
        if (rateIn) rateIn.textContent = formatBps(rx);
        if (rateOut) rateOut.textContent = formatBps(tx);
    }

    /** Format bytes/sec to human-readable string
     *
     * @param {number} bps
     */
    function formatBps(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    // ── Number tweening state for smooth CPU/RAM text ──
    /** @type {import('../types').NumberTween} */
    let tweenCpu = { current: null, target: null, el: null };
    /** @type {import('../types').NumberTween} */
    let tweenRam = { current: null, target: null, el: null };
    /** @type {number | null} */
    let tweenRafId = null;

    function startTweenLoop() {
        if (tweenRafId !== null) return;

        /**
         * @param {import('../types').NumberTween} tween
         */
        function advanceTween(tween) {
            if (tween.current === null || tween.target === null || !tween.el) return false;

            const diff = tween.target - tween.current;
            if (reducedMotionQuery.matches || Math.abs(diff) < 0.15) {
                tween.current = tween.target;
            } else {
                tween.current += diff * 0.06;
            }

            const displayValue = Math.round(tween.current) + '%';
            if (tween.el.textContent !== displayValue) tween.el.textContent = displayValue;
            return tween.current !== tween.target;
        }

        function tick() {
            tweenRafId = null;
            const cpuActive = advanceTween(tweenCpu);
            const ramActive = advanceTween(tweenRam);
            if (cpuActive || ramActive) tweenRafId = requestAnimationFrame(tick);
        }
        tweenRafId = requestAnimationFrame(tick);
    }

    // ── SSE EventSource for real-time system stats ──
    function disconnectSystemStream() {
        if (sysStreamRetryTimer !== null) clearTimeout(sysStreamRetryTimer);
        sysStreamRetryTimer = null;
        if (sysStreamSource) {
            const source = sysStreamSource;
            sysStreamSource = null;
            source.close();
        }
    }

    function connectSystemStream() {
        if (document.hidden) return;
        disconnectSystemStream();
        const source = new EventSource('/api/stream/system');
        sysStreamSource = source;

        source.addEventListener('system', (e) => {
            try {
                /** @type {import('../types').SystemStats} */
                const d = JSON.parse(e.data);
                let tweenChanged = false;

                // ── NET traffic (deadband: only update visuals for changes > 2 KB/s) ──
                const newRx = d.rx_bps || 0;
                const newTx = d.tx_bps || 0;
                const prevRx = lastNetTraffic ? lastNetTraffic.rx_bps : 0;
                const prevTx = lastNetTraffic ? lastNetTraffic.tx_bps : 0;
                const firstSample = !lastNetTraffic;
                // Always update cache so future comparisons use current values
                lastNetTraffic = { rx_bps: newRx, tx_bps: newTx };
                // Only trigger visual update when change exceeds deadband
                if (Math.abs(newRx - prevRx) > 2048 || Math.abs(newTx - prevTx) > 2048 || firstSample) {
                    updateHandleTrafficBars();
                }

                // ── CPU with tweening (deadband: ignore changes < 1%) ──
                const cpuEl = document.getElementById('ro-cpu');
                if (cpuEl && d.cpu_pct != null) {
                    tweenCpu.el = cpuEl;
                    if (tweenCpu.current === null) {
                        tweenCpu.current = d.cpu_pct;
                        tweenCpu.target = d.cpu_pct;
                        cpuEl.textContent = Math.round(d.cpu_pct) + '%';
                    } else if (Math.abs(d.cpu_pct - (tweenCpu.target ?? tweenCpu.current)) >= 1.0) {
                        tweenCpu.target = d.cpu_pct;
                        tweenChanged = true;
                        pulseOnChange('ro-cpu', Math.round(d.cpu_pct), 'white');
                    }
                }

                // ── RAM with tweening (deadband: ignore changes < 0.5%) ──
                const ramEl = document.getElementById('ro-ram');
                if (ramEl && d.mem_pct != null) {
                    tweenRam.el = ramEl;
                    if (tweenRam.current === null) {
                        tweenRam.current = d.mem_pct;
                        tweenRam.target = d.mem_pct;
                        ramEl.textContent = Math.round(d.mem_pct) + '%';
                    } else if (Math.abs(d.mem_pct - (tweenRam.target ?? tweenRam.current)) >= 0.5) {
                        tweenRam.target = d.mem_pct;
                        tweenChanged = true;
                        pulseOnChange('ro-ram', Math.round(d.mem_pct), 'white');
                    }
                    // Update hover tooltip
                    let hoverParts = [`Memory: ${Math.round(d.mem_pct)}%`];
                    if (d.mem_used_mb && d.mem_total_mb) hoverParts.push(`Used: ${d.mem_used_mb} / ${d.mem_total_mb} MB`);
                    if (d.cpu_pct != null) hoverParts.push(`CPU: ${Math.round(d.cpu_pct)}%`);
                    ramEl.title = hoverParts.join('\n');
                }

                if (tweenChanged) startTweenLoop();

                // Store for modal use (merge with existing lastSystemStats)
                if (!lastSystemStats) lastSystemStats = {};
                lastSystemStats.cpu_pct = d.cpu_pct;
                lastSystemStats.mem_pct = d.mem_pct;
                lastSystemStats.mem_used_mb = d.mem_used_mb;
                lastSystemStats.mem_total_mb = d.mem_total_mb;

                sysStreamRetryDelay = 1000; // reset on success
            } catch (err) {
                console.error('[Bitcoin Peer Map] SSE parse error:', err);
            }
        });

        source.onerror = () => {
            if (sysStreamSource !== source) return;
            source.close();
            sysStreamSource = null;
            // Reconnect with backoff (max 10s)
            if (!document.hidden) sysStreamRetryTimer = setTimeout(connectSystemStream, sysStreamRetryDelay);
            sysStreamRetryDelay = Math.min(sysStreamRetryDelay * 1.5, 10000);
        };
    }

    return Object.freeze({
        updateFlightDeck,
        infoPolling,
        pricePolling,
        openGeoDBDropdown,
        syncDbAutoUpdateTimer,
        fetchInfo,
        openRecentBlocksModal,
        openNodeInfoModal,
        openChainTipsModal,
        renderPeerDataStatus,
        updateHUD,
        getNetworkStats,
        systemStatsPolling,
        disconnectSystemStream,
        connectSystemStream,
    });
}
export { create };
