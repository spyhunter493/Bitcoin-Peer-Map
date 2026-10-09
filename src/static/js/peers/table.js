import * as PeerFilters from './filters.js';
import * as BPMGeometry from '../map/geometry.js';
import { query, queryAll, required, closest } from '../core/dom.js';
import * as BPMFormat from '../core/format.js';
import * as BPMPeerTableModel from './table-model.js';
import * as TableWindow from './table-window.js';
import { filterSearch } from './table-search.js';
import * as TableTools from './table-tools.js';
import { fmtPing } from '../core/ping.js';
import { formatCoordinate } from '../core/coordinates.js';
import { addrmanLabel } from '../core/addrman.js';
import { formatGeoAge, geoSourceLabel, geoFreshnessLabel } from '../core/geo.js';
/** @param {import('../types').PeerTableOptions} options
 *  @returns {import('../types').PeerTableController} */
function create(options) {
    let disposed = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let fitTimer = null;
    const dashboard = options.dashboard;
    const privateState = dashboard.privateNetwork;
    const { mapView, preferences, onAction } = options;
    /** @type {Record<string, string>} */
    const NET_DISPLAY = { ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
    const clamp = BPMGeometry.clamp;
    /** @param {string} network */
    const passesNetwork = (network) => dashboard.interaction.enabledNets.has(network);

    // Connection type acronyms: short form + full description for hover
    /** @type {Record<string, string>} */
    const CONN_TYPE_SHORT = {
        'outbound-full-relay': 'OFR',
        'block-relay-only': 'BRO',
        manual: 'MAN',
        'addr-fetch': 'AF',
        feeler: 'FLR',
        inbound: 'IN',
    };
    /** Get short type string for a peer and its full description
     *
     * @param {import('../types').Peer} p
     */
    function peerTypeShort(p) {
        const dir = p.direction === 'IN' ? 'IN' : 'OUT';
        if (!p.connection_type) return dir;
        const ct = (Object.hasOwn(CONN_TYPE_SHORT, p.connection_type) ? CONN_TYPE_SHORT[p.connection_type] : null) || p.connection_type;
        return p.direction === 'IN' ? ct : `${dir}/${ct}`;
    }
    /**
     * @param {import('../types').Peer} p
     */
    function peerTypeFull(p) {
        const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
        return p.connection_type ? `${dir} / ${p.connection_type}` : dir;
    }

    // Column definitions: { key, label, get(short), full(hover), vis, width }
    // width: preferred width in px for fixed layout. min is enforced via CSS.
    /** @type {(import('../types').PeerColumn & {label: string; full: ((peer: import('../types').Peer) => string) | null; vis: boolean; w: number})[]} */
    const COLUMNS = [
        { key: 'id', label: 'ID', get: (p) => p.id, full: null, vis: true, w: 40 },
        { key: 'network', label: 'Net', get: (p) => NET_DISPLAY[p.network] || p.network, full: null, vis: true, w: 45 },
        { key: 'conntime_fmt', label: 'Duration', get: (p) => p.conntime_fmt || '—', full: null, vis: true, w: 75 },
        { key: 'connection_type', label: 'Type', get: (p) => peerTypeShort(p), full: (p) => peerTypeFull(p), vis: true, w: 70 },
        { key: 'addr', label: 'IP:Port', get: (p) => p.addr || `${p.ip}:${p.port}`, full: null, vis: true, w: 130 },
        { key: 'subver', label: 'Software', get: (p) => p.subver || '—', full: null, vis: true, w: 90 },
        {
            key: 'services_abbrev',
            label: 'Services',
            get: (p) => BPMFormat.serviceAbbrev(p.services),
            full: (p) => BPMFormat.serviceHover(p.services),
            vis: true,
            w: 70,
        },
        { key: 'city', label: 'City', get: (p) => p.city || '—', full: null, vis: true, w: 60 },
        { key: 'regionName', label: 'Region', get: (p) => p.regionName || '—', full: null, vis: true, w: 55 },
        { key: 'country', label: 'Country', get: (p) => p.country || '—', full: null, vis: true, w: 70 },
        { key: 'continent', label: 'Cont.', get: (p) => p.continent || '—', full: null, vis: true, w: 60 },
        { key: 'isp', label: 'ISP', get: (p) => p.isp || '—', full: null, vis: true, w: 110 },
        { key: 'ping_ms', label: 'Ping', get: (p) => fmtPing(p.ping_ms), full: null, vis: true, w: 50 },
        { key: 'bytessent_fmt', label: 'Sent', get: (p) => p.bytessent_fmt || '—', full: null, vis: true, w: 60 },
        { key: 'tx_bps', label: 'Send rate', get: (p) => BPMFormat.fmtBps(p.tx_bps), full: null, vis: true, w: 96 },
        { key: 'bytesrecv_fmt', label: 'Recv', get: (p) => p.bytesrecv_fmt || '—', full: null, vis: true, w: 60 },
        { key: 'rx_bps', label: 'Recv rate', get: (p) => BPMFormat.fmtBps(p.rx_bps), full: null, vis: true, w: 96 },
        { key: 'in_addrman', label: 'Addrman', get: (p) => addrmanLabel(p.addrman_status), full: null, vis: true, w: 100 },
        // Advanced columns (hidden by default)
        {
            key: 'direction',
            label: 'Dir',
            get: (p) => (p.direction === 'IN' ? 'IN' : 'OUT'),
            full: (p) => (p.direction === 'IN' ? 'Inbound' : 'Outbound'),
            vis: false,
            w: 40,
        },
        { key: 'countryCode', label: 'CC', get: (p) => p.countryCode || '—', full: null, vis: false, w: 35 },
        { key: 'continentCode', label: 'CntC', get: (p) => p.continentCode || '—', full: null, vis: false, w: 40 },
        { key: 'lat', label: 'Lat', get: (p) => formatCoordinate(p, 'lat'), full: null, vis: false, w: 55 },
        { key: 'lon', label: 'Lon', get: (p) => formatCoordinate(p, 'lon'), full: null, vis: false, w: 55 },
        { key: 'region', label: 'Rgn', get: (p) => p.region || '—', full: null, vis: false, w: 60 },
        { key: 'as', label: 'AS', get: (p) => p.as || '—', full: null, vis: false, w: 80 },
        { key: 'asname', label: 'AS Name', get: (p) => p.asname || '—', full: null, vis: false, w: 100 },
        { key: 'district', label: 'District', get: (p) => p.district || '—', full: null, vis: false, w: 80 },
        { key: 'mobile', label: 'Mob', get: (p) => (p.mobile ? 'Y' : 'N'), full: (p) => (p.mobile ? 'Yes' : 'No'), vis: false, w: 35 },
        { key: 'org', label: 'Org', get: (p) => p.org || '—', full: null, vis: false, w: 100 },
        { key: 'timezone', label: 'TZ', get: (p) => p.timezone || '—', full: null, vis: false, w: 70 },
        { key: 'currency', label: 'Curr', get: (p) => p.currency || '—', full: null, vis: false, w: 45 },
        { key: 'hosting', label: 'Host', get: (p) => (p.hosting ? 'Y' : 'N'), full: (p) => (p.hosting ? 'Yes' : 'No'), vis: false, w: 35 },
        { key: 'offset', label: 'UTC', get: (p) => (p.offset != null ? p.offset : '—'), full: null, vis: false, w: 45 },
        { key: 'proxy', label: 'Proxy', get: (p) => (p.proxy ? 'Y' : 'N'), full: (p) => (p.proxy ? 'Yes' : 'No'), vis: false, w: 40 },
        { key: 'zip', label: 'ZIP', get: (p) => p.zip || '—', full: null, vis: false, w: 55 },
        { key: 'geo_source', label: 'Source', get: (p) => geoSourceLabel(p.geo), full: null, vis: false, w: 100 },
        { key: 'geo_age_seconds', label: 'Geo age', get: (p) => p.geo?.freshness === 'unavailable' ? 'Unavailable' : formatGeoAge(p.geo?.age_seconds), full: null, vis: false, w: 75 },
        { key: 'geo_freshness', label: 'Freshness', get: (p) => geoFreshnessLabel(p.geo), full: null, vis: false, w: 80 },
    ];

    // Visible column keys (start with defaults, can be toggled later)
    const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter((c) => c.vis).map((c) => c.key);
    /** @type {string[]} */
    let visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];

    // Sort state
    /** @type {string | null} */
    let sortKey = 'id';
    let sortAsc = true;

    // Auto-fit column state: ON by default, OFF when user resizes
    let autoFitColumns = true;
    /** @type {Record<string, number>} */
    let userColumnWidths = {}; // key -> px width (only used when autoFit OFF)
    let panelOpacity = 0; // 0 = invisible, 100 = opaque
    let maxPeerRows = 10; // visible rows in peer table
    let showAntarcticaPeers = true;
    /** @type {Set<string>} */
    const TABLE_COLUMN_KEYS = new Set(COLUMNS.map((c) => c.key));

    /** Keep rate labels, sort arrows and units readable in narrow tables.
     * @param {string} key @param {number} [fallback] */
    function minimumColumnWidth(key, fallback = 30) {
        return key === 'tx_bps' || key === 'rx_bps' ? 96 : fallback;
    }

    /**
     * @param {unknown} columns
     */
    function normalizeVisibleColumns(columns) {
        if (!Array.isArray(columns)) return [...DEFAULT_VISIBLE_COLUMNS];
        /** @type {string[]} */
        const normalized = [];
        for (const key of columns) {
            if (typeof key === 'string' && TABLE_COLUMN_KEYS.has(key) && !normalized.includes(key)) {
                normalized.push(key);
            }
        }
        return normalized.length > 0 ? normalized : [...DEFAULT_VISIBLE_COLUMNS];
    }

    /**
     * @param {unknown} widths
     */
    function normalizeColumnWidths(widths) {
        /** @type {Record<string, number>} */
        const normalized = {};
        if (!widths || typeof widths !== 'object' || Array.isArray(widths)) return normalized;
        for (const [key, rawWidth] of Object.entries(widths)) {
            if (!TABLE_COLUMN_KEYS.has(key)) continue;
            const width = Number(rawWidth);
            if (Number.isFinite(width)) normalized[key] = Math.round(clamp(width, minimumColumnWidth(key), 400));
        }
        return normalized;
    }

    function currentTableDisplaySettings() {
        return {
            visibleColumns: [...visibleColumns],
            autoFitColumns,
            userColumnWidths: normalizeColumnWidths(userColumnWidths),
            panelOpacity,
            maxPeerRows,
            showAntarcticaPeers,
        };
    }

    function saveTableDisplaySettings() {
        preferences.writeSavedDisplaySettings(Object.assign({}, preferences.readSavedDisplaySettings(), currentTableDisplaySettings()));
    }

    function loadTableDisplaySettings() {
        const saved = preferences.readSavedDisplaySettings();

        visibleColumns = normalizeVisibleColumns(saved.visibleColumns);

        if (typeof saved.autoFitColumns === 'boolean') {
            autoFitColumns = saved.autoFitColumns;
        }
        userColumnWidths = normalizeColumnWidths(saved.userColumnWidths);
        if (autoFitColumns) userColumnWidths = {};

        if (Number.isFinite(Number(saved.panelOpacity))) {
            panelOpacity = Math.round(clamp(Number(saved.panelOpacity), 0, 100));
        }
        if (Number.isFinite(Number(saved.maxPeerRows))) {
            maxPeerRows = Math.round(clamp(Number(saved.maxPeerRows), 3, 40));
        }
        if (typeof saved.showAntarcticaPeers === 'boolean') {
            showAntarcticaPeers = saved.showAntarcticaPeers;
        }
    }

    // Panel DOM (let because ban list view replaces and restores them)
    const panelEl = required('#peer-panel');
    /** @type {HTMLTableSectionElement} */
    const theadEl = required('#peer-thead');
    /** @type {HTMLTableSectionElement} */
    const tbodyEl = required('#peer-tbody');

    function updateCollapseControl() {
        const button = required('#btn-minimize');
        const expanded = !panelEl.classList.contains('collapsed');
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-controls', 'peer-panel-body');
        button.setAttribute('aria-label', expanded ? 'Hide peer list table' : 'Show peer list table');
        button.title = expanded ? 'Hide peer list table' : 'Show peer list table';
        button.innerHTML = expanded ? '&#9660;' : '&#9650;';
    }
    updateCollapseControl();
    new MutationObserver(updateCollapseControl).observe(panelEl, { attributes: true, attributeFilter: ['class'] });

    // Panel toggle (clicking the title bar)
    required('#peer-panel-handle').addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
        updateCollapseControl();
        // [DISTRIBUTION] When expanding peer list, bring it on top of AS panel
        if (!panelEl.classList.contains('collapsed')) {
            document.body.classList.add('panel-focus-peers');
            document.body.classList.remove('panel-focus-as');
        }
        onAction({ type: 'layout' });
    });

    // [DISTRIBUTION] Clicking anywhere in peer panel body → bring peers to front
    const peerPanelBody = query('.peer-panel-body', document);
    if (peerPanelBody) {
        peerPanelBody.addEventListener('click', () => {
            document.body.classList.add('panel-focus-peers');
            document.body.classList.remove('panel-focus-as');
        });
    }

    /** @type {import('../types').Peer[] | null} */
    let measuredPeers = null;
    let measuredColumns = '';
    /** @type {number[]} */
    let naturalWidths = [];
    let layoutSignature = '';
    let actionsWidth = 160;

    function measureActionsWidth() {
        const row = tbodyEl.querySelector('tr[data-id]');
        const cell = row instanceof HTMLTableRowElement ? row.cells[row.cells.length - 1] : null;
        if (!cell) return;
        const buttons = queryAll('.peer-action-btn', cell);
        if (!buttons.length || !buttons[0].getBoundingClientRect().width) return;
        const cellStyle = getComputedStyle(cell);
        const padding = parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight);
        const contentWidth = buttons.reduce((width, button) => {
            const style = getComputedStyle(button);
            return width + button.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        }, 0);
        // Leave room for focus outlines and collapsed-border rounding. Font
        // fallback or a user's larger text setting must not clip either action.
        actionsWidth = Math.ceil(contentWidth + padding + 8);
    }

    /** Fit from the full snapshot's 95th percentile, preserving manual widths.
     * Cached measurements are reused on resize; unchanged widths retain the colgroup. */
    function renderColgroup() {
        if (disposed) return;
        const table = required('#peer-table');
        measureActionsWidth();
        const widths = [];
        if (autoFitColumns) {
            // ── Auto-fit: size columns to fit viewport based on data ──
            const charPx = 7; // approximate px per character at font-size 11px
            const headerPad = 28; // padding + sort arrow
            const colPad = 16; // cell padding (8px each side)
            const actionsW = actionsWidth;

            // Measure available width
            const tableWrap = table.closest('.peer-table-wrap');
            const availW = Math.max(0, (tableWrap ? tableWrap.clientWidth : mapView.width) - actionsW);
            const columnsSignature = visibleColumns.join('|');
            if (measuredPeers !== dashboard.peers || measuredColumns !== columnsSignature) {
                naturalWidths = [];
                for (const key of visibleColumns) {
                    const col = COLUMNS.find((c) => c.key === key);
                    if (!col) {
                        naturalWidths.push(60);
                        continue;
                    }

                    // Minimum: header label width
                    const headerW = col.label.length * charPx + headerPad;

                    if (dashboard.peers.length === 0) {
                        naturalWidths.push(Math.max(headerW, col.w));
                        continue;
                    }

                    // Width is capped at 250px, so a bounded length histogram
                    // finds the percentile without sorting the full peer list.
                    const maxLength = Math.ceil((250 - colPad) / charPx);
                    const lengths = new Uint32Array(maxLength + 1);
                    for (const peer of dashboard.peers) lengths[Math.min(String(col.get(peer)).length, maxLength)]++;
                    const p95Idx = Math.min(Math.floor(dashboard.peers.length * 0.95), dashboard.peers.length - 1);
                    let p95Len = 0, count = lengths[0];
                    while (count <= p95Idx && p95Len < maxLength) count += lengths[++p95Len];
                    const dataW = p95Len * charPx + colPad;

                    naturalWidths.push(Math.max(headerW, Math.min(dataW, 250)));
                }
                measuredPeers = dashboard.peers;
                measuredColumns = columnsSignature;
            }

            // Scale proportionally to fill available width
            const totalNatural = naturalWidths.reduce((s, w) => s + w, 0);
            const scale = totalNatural > 0 ? Math.max(availW / totalNatural, 0.5) : 1;
            let rateWidth = 0, otherNatural = 0, rateFloorBinds = false;
            const rateWidths = naturalWidths.map((width, index) => {
                const minimum = minimumColumnWidth(visibleColumns[index], 0);
                if (!minimum) { otherNatural += width; return 0; }
                const scaled = Math.round(width * scale);
                const readable = Math.max(minimum, scaled);
                rateWidth += readable;
                if (readable > scaled) rateFloorBinds = true;
                return readable;
            });
            // Reserve readable rates before sizing the other columns. Narrow
            // tables keep the existing half-size floor and scroll inside the panel.
            const otherScale = rateFloorBinds && otherNatural > 0
                ? Math.max((availW - rateWidth) / otherNatural, 0.5) : scale;
            naturalWidths.forEach((width, index) => {
                const scaled = rateFloorBinds && otherScale > 0.5
                    ? Math.max(Math.round(width * 0.5), Math.floor(width * otherScale))
                    : Math.round(width * otherScale);
                widths.push(rateWidths[index] || scaled);
            });
        } else {
            for (const key of visibleColumns) {
                const col = COLUMNS.find((c) => c.key === key);
                widths.push(Math.max(minimumColumnWidth(key, 0), userColumnWidths[key] || (col ? col.w : 80)));
            }
        }
        widths.push(actionsWidth);
        const signature = `${visibleColumns.join('|')}:${widths.join('|')}`;
        if (signature === layoutSignature) return;
        layoutSignature = signature;
        table.style.tableLayout = 'fixed';
        let cg = query('colgroup', table);
        if (!cg) { cg = document.createElement('colgroup'); table.insertBefore(cg, table.firstChild); }
        while (cg.children.length > widths.length) cg.lastElementChild?.remove();
        while (cg.children.length < widths.length) cg.appendChild(document.createElement('col'));
        widths.forEach((width, index) => {
            const column = /** @type {HTMLElement} */ (cg.children[index]);
            const value = `${width}px`;
            if (column.style.width !== value) column.style.width = value;
        });
    }

    const tableViewport = required('.peer-table-wrap', panelEl);
    let observedWidth = tableViewport.clientWidth;
    let layoutFrame = 0;
    const columnObserver = new ResizeObserver(() => {
        if (disposed) return;
        const width = tableViewport.clientWidth;
        if (width === observedWidth) return;
        observedWidth = width;
        if (!autoFitColumns || layoutFrame) return;
        layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            if (autoFitColumns) renderColgroup();
        });
    });
    columnObserver.observe(tableViewport);
    const refreshFonts = () => renderColgroup();
    document.fonts.ready.then(refreshFonts);
    document.fonts.addEventListener('loadingdone', refreshFonts);

    /** Build table header row with resize handles */
    function renderPeerTableHead() {
        const focused = document.activeElement instanceof HTMLElement && theadEl.contains(document.activeElement)
            ? document.activeElement.closest('th')?.dataset.sort : undefined;
        let html = '<tr>';
        for (const key of visibleColumns) {
            const col = COLUMNS.find((c) => c.key === key);
            if (!col) continue;
            const isActive = sortKey === key;
            // 3-state: no sortKey = unsorted (dim arrow), asc = ▲, desc = ▼
            const arrow = isActive ? (sortAsc ? '&#9650;' : '&#9660;') : '';
            const cls = isActive ? 'sort-arrow active' : 'sort-arrow';
            const sort = isActive ? ` aria-sort="${sortAsc ? 'ascending' : 'descending'}"` : '';
            html += `<th scope="col" data-sort="${key}"${sort}><button type="button" class="th-text" aria-label="Sort by ${col.label}">${col.label} <span class="${cls}" aria-hidden="true">${arrow}</span></button><span class="th-resize" data-col="${key}" aria-hidden="true"></span></th>`;
        }
        html += '<th scope="col">Actions</th>';
        html += '</tr>';
        theadEl.innerHTML = html;
        if (focused) query(`th[data-sort="${focused}"] button`, theadEl)?.focus({ preventScroll: true });
        renderColgroup();
    }

    const tableWindow = TableWindow.create({
        tbody: tbodyEl, thead: theadEl, viewport: required('.peer-table-wrap', panelEl),
        updateRow: (row, peer, rebuild) => updatePeerRow(row, peer, renderedColumns, rebuild),
    });
    /** @type {typeof COLUMNS} */
    let renderedColumns = [];
    /** @type {number | null} */
    let highlightedRowId = null;
    const tableTools = TableTools.create({
        onQuery: () => renderPeerTable(),
        onClear: (filter) => onAction({ type: 'clear-filter', filter }),
    });

    /** The chips describe the same scopes that determine the table result. */
    function activeFilterScopes() {
        /** @type {import('./table-tools').FilterScope[]} */
        const scopes = [];
        const interaction = dashboard.interaction;
        const distribution = dashboard.distribution;
        if (privateState.privateNetMode) {
            scopes.push({ key: 'private-mode', label: 'Private view' });
            if (privateState.pnSelectedNet) scopes.push({ key: 'private-network', label: `Network: ${NET_DISPLAY[privateState.pnSelectedNet] || privateState.pnSelectedNet}` });
            if (privateState.pnFilter) scopes.push({ key: 'private-filter', label: `Private group: ${privateState.pnFilter.label}` });
        } else {
            if (!['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'].every(network => interaction.enabledNets.has(network))) {
                scopes.push({ key: 'network', label: `Networks: ${[...interaction.enabledNets].map(network => NET_DISPLAY[network] || network).join(', ') || 'none'}` });
            }
            const distributionScope = !distribution.peerDetailActive || distribution.selectedProvider ||
                distribution.activeNetwork || distribution.insightActiveAsNum ||
                distribution.filterPeerIds !== null || distribution.subSubFilterPeerIds !== null;
            if (interaction.asFilterPeerIds !== null && distributionScope) {
                const provider = distribution.selectedProvider;
                const detail = distribution.filterLabel || (distribution.activeNetwork ? NET_DISPLAY[distribution.activeNetwork] : null);
                const label = [provider, detail, distribution.subSubFilterProvider].filter(Boolean).join(' / ') || 'Distribution selection';
                scopes.push({ key: 'provider', label: `Selection: ${label}` });
            }
            if (interaction.mapFilterPeerIds !== null) {
                const ids = [...interaction.mapFilterPeerIds];
                scopes.push({ key: 'map', label: ids.length === 1 ? `Map: peer ${ids[0]}` : `Map: ${ids.length} peers` });
            }
        }
        return scopes;
    }

    /**
     * @param {HTMLTableCellElement} cell
     * @param {unknown} value
     * @param {unknown} title
     */
    function setCell(cell, value, title) {
        const text = String(value ?? '');
        const tooltip = String(title ?? '');
        if (cell.textContent !== text) cell.textContent = text;
        if (cell.title !== tooltip) cell.title = tooltip;
    }

    /**
     * @param {HTMLTableRowElement} row
     * @param {import('../types').Peer} peer
     * @param {typeof COLUMNS} columns
     * @param {boolean} rebuildCells
     */
    function updatePeerRow(row, peer, columns, rebuildCells) {
        const net = peer.network || 'ipv4';
        if (row.dataset.net !== net) row.dataset.net = net;
        row.classList.toggle('row-highlight', (dashboard.interaction.highlightedPeerId ?? highlightedRowId) === peer.id);
        if (rebuildCells || row.cells.length !== columns.length + 1) {
            row.replaceChildren();
            for (let i = 0; i < columns.length + 1; i++) {
                row.appendChild(document.createElement('td'));
            }
            for (const action of ['details', 'disconnect']) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'peer-action-btn';
                button.dataset.action = action;
                button.dataset.id = String(peer.id);
                button.textContent = action === 'details' ? 'Details' : 'Disconnect';
                button.setAttribute('aria-label', `${action === 'details' ? 'Details for' : 'Disconnect'} peer ${peer.id}`);
                row.cells[row.cells.length - 1].appendChild(button);
            }
        }
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            const value = column.get(peer);
            setCell(row.cells[i], value, column.full ? column.full(peer) : value);
        }
        for (const button of queryAll('button', row.cells[row.cells.length - 1])) {
            if (button.dataset.net !== net) button.dataset.net = net;
        }
    }

    /** Build table body from lastPeers (filtered by active network filter) */
    function renderPeerTable() {
        if (disposed) return;
        if (!tbodyEl) return;
        if (autoFitColumns) renderColgroup();
        const peers =
            privateState.privateNetMode && privateState.pnFilter
                ? PeerFilters.resolve(dashboard.peers, privateState.pnFilter.filter)
                : dashboard.peers;
        const filtered = BPMPeerTableModel.filterPeers(peers, {
            privateMode: privateState.privateNetMode,
            privateNetwork: privateState.pnSelectedNet,
            passesNetwork: passesNetwork,
            providerPeerIds: dashboard.interaction.asFilterPeerIds,
            mapPeerIds: dashboard.interaction.mapFilterPeerIds,
        });
        const sorted = BPMPeerTableModel.sortPeers(
            filterSearch(filtered, tableTools.query),
            COLUMNS.find((column) => column.key === sortKey),
            sortAsc
        );

        renderedColumns = visibleColumns.map((key) => COLUMNS.find((column) => column.key === key)).filter((column) => column !== undefined);
        if (highlightedRowId !== null && !dashboard.byId.has(highlightedRowId)) highlightedRowId = null;
        query('.peer-search-empty', tbodyEl)?.remove();
        tableWindow.update(sorted, visibleColumns.join('|'), renderedColumns.length + 1);
        const scopes = activeFilterScopes();
        tableTools.update({peers: sorted, total: dashboard.peers.length, columns: renderedColumns,
            sort: {key: sortKey, direction: sortKey ? (sortAsc ? 'ascending' : 'descending') : null}, scopes});
        if (!sorted.length && (tableTools.query.trim() || scopes.length)) {
            const row = document.createElement('tr');
            row.className = 'peer-search-empty';
            const cell = row.insertCell();
            cell.colSpan = renderedColumns.length + 1;
            cell.textContent = 'No peers match these filters. Clear search or remove a filter to broaden the list.';
            tbodyEl.appendChild(row);
        }
        // The initial snapshot mounts the controls after the first width pass.
        // Measure their actual rendered font before exposing the finished table.
        renderColgroup();
    }

    // Initial header render
    renderPeerTableHead();

    // ── Named event handlers (for reattachment after ban list close) ──

    let resizingColumn = false; // suppress sort click when resize drag occurred
    let draggingColumn = false; // suppress sort click when column reorder drag occurred

    /** @param {MouseEvent} e */
    function handleTheadClick(e) {
        // Suppress sort if this click followed a column resize or reorder drag
        if (resizingColumn) {
            resizingColumn = false;
            return;
        }
        if (draggingColumn) {
            draggingColumn = false;
            return;
        }
        // Ignore clicks on resize handles
        if (closest('.th-resize', e.target)) return;
        const th = closest('th[data-sort]', e.target);
        if (!th) return;
        const key = th.dataset.sort || '';
        // 3-state sort cycle: unsorted → ascending → descending → unsorted
        if (sortKey === key) {
            if (sortAsc) {
                sortAsc = false; // asc → desc
            } else {
                sortKey = null; // desc → unsorted
                sortAsc = true;
            }
        } else {
            sortKey = key;
            sortAsc = true; // new column → ascending
        }
        renderPeerTableHead();
        renderPeerTable();
    }

    /** @type {{colKey: string; th: HTMLElement; startX: number; startW: number} | null} */
    let resizeState = null;
    /** @param {MouseEvent} e */
    function handleTheadResize(e) {
        const handle = closest('.th-resize', e.target);
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const colKey = handle.dataset.col || '';
        const th = handle.parentElement;
        if (!th) return;
        const startX = e.clientX;
        const startW = th.offsetWidth;

        resizeState = { colKey, th, startX, startW };

        /** @param {MouseEvent} me */
        const onMove = (me) => {
            if (!resizeState) return;
            resizingColumn = true; // flag to suppress subsequent sort click
            const delta = me.clientX - resizeState.startX;
            const newW = Math.max(minimumColumnWidth(resizeState.colKey), resizeState.startW + delta);
            if (autoFitColumns) {
                autoFitColumns = false;
                const ths = queryAll('th[data-sort]', theadEl);
                ths.forEach((t) => {
                    const key = t.dataset.sort;
                    if (key) userColumnWidths[key] = t.offsetWidth;
                });
                updateAutoFitBtn();
            }
            userColumnWidths[resizeState.colKey] = newW;
            renderColgroup();
        };
        const onUp = () => {
            resizeState = null;
            saveTableDisplaySettings();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // ── Column drag-to-reorder ──
    /** @type {HTMLElement | null} */
    let colDragIndicator = null;

    /** @param {MouseEvent} e */
    function handleTheadDragStart(e) {
        // Only start column drag on th text area (not resize handle)
        if (closest('.th-resize', e.target)) return;
        const th = closest('th[data-sort]', e.target);
        if (!th) return;

        const key = th.dataset.sort || '';
        const startX = e.clientX;
        const thRect = th.getBoundingClientRect();
        let moved = false;

        /** @param {MouseEvent} me */
        const onMove = (me) => {
            const dx = me.clientX - startX;
            // Only activate drag after 10px horizontal movement
            if (!moved && Math.abs(dx) < 10) return;
            if (!moved) {
                moved = true;
                draggingColumn = true;
                // Create floating indicator
                colDragIndicator = document.createElement('div');
                colDragIndicator.className = 'col-drag-indicator';
                colDragIndicator.textContent = query('.th-text', th)?.textContent?.trim() || key;
                colDragIndicator.style.width = thRect.width + 'px';
                document.body.appendChild(colDragIndicator);
            }
            if (colDragIndicator) {
                colDragIndicator.style.left = me.clientX - thRect.width / 2 + 'px';
                colDragIndicator.style.top = thRect.top - 2 + 'px';
            }
            // Highlight drop target
            const allThs = Array.from(queryAll('th[data-sort]', theadEl));
            allThs.forEach((t) => t.classList.remove('col-drag-over'));
            const targetTh = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
            const dropTh = targetTh ? closest('th[data-sort]', targetTh) : null;
            if (dropTh && dropTh !== th) dropTh.classList.add('col-drag-over');
        };

        /** @param {MouseEvent} me */
        const onUp = (me) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (colDragIndicator) {
                colDragIndicator.remove();
                colDragIndicator = null;
            }
            // Clean up highlight
            queryAll('.col-drag-over', theadEl).forEach((t) => t.classList.remove('col-drag-over'));

            if (!moved) return;
            // Find drop target
            const targetEl = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
            const dropTh = targetEl ? closest('th[data-sort]', targetEl) : null;
            if (dropTh && dropTh.dataset.sort !== key) {
                const fromIdx = visibleColumns.indexOf(key);
                const toIdx = visibleColumns.indexOf(dropTh.dataset.sort || '');
                if (fromIdx !== -1 && toIdx !== -1) {
                    // Move column in visibleColumns array
                    visibleColumns.splice(fromIdx, 1);
                    visibleColumns.splice(toIdx, 0, key);
                    renderColgroup();
                    renderPeerTableHead();
                    renderPeerTable();
                    saveTableDisplaySettings();
                }
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    theadEl.addEventListener('mousedown', handleTheadDragStart);

    // Sort on column header click
    theadEl.addEventListener('click', handleTheadClick);
    // Column resize via drag on th-resize handles
    theadEl.addEventListener('mousedown', handleTheadResize);

    // ── Auto-fit toggle button ──
    const autoFitBtn = required('#btn-autofit');
    function updateAutoFitBtn() {
        autoFitBtn.classList.toggle('active', autoFitColumns);
    }
    updateAutoFitBtn();
    autoFitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        autoFitColumns = !autoFitColumns;
        if (autoFitColumns) userColumnWidths = {};
        updateAutoFitBtn();
        renderColgroup();
        saveTableDisplaySettings();
    });

    // ── Table Settings gear popup (column toggles + transparency) ──
    const tableSettingsBtn = required('#btn-table-settings');
    /** @type {HTMLElement | null} */
    let tableSettingsEl = null;
    /** @type {ResizeObserver | null} */
    let tableSettingsObserver = null;
    tableSettingsBtn.setAttribute('aria-haspopup', 'dialog');
    tableSettingsBtn.setAttribute('aria-expanded', 'false');
    tableSettingsBtn.setAttribute('aria-controls', 'table-settings-popup');

    if (tableSettingsBtn) {
        tableSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tableSettingsEl) {
                closeTableSettings();
                return;
            }
            openTableSettings();
        });
    }

    function openTableSettings() {
        closeTableSettings();
        const popup = document.createElement('div');
        popup.className = 'table-settings-popup';
        popup.id = 'table-settings-popup';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-labelledby', 'tsp-title');
        popup.tabIndex = -1;

        let html =
            '<div class="tsp-header"><span class="tsp-title" id="tsp-title">Table Settings</span><button class="tsp-defaults-btn" id="tsp-defaults">Defaults</button></div>';

        // ── Transparency slider ──
        html += '<label class="tsp-section" for="tsp-opacity">Transparency</label>';
        html += `<div class="tsp-slider-row"><input type="range" class="tsp-slider" id="tsp-opacity" min="0" max="100" value="${panelOpacity}"><span class="tsp-slider-val" id="tsp-opacity-val">${panelOpacity}%</span></div>`;

        // ── Visible rows ──
        html += '<label class="tsp-section" for="tsp-rows">Visible Rows</label>';
        html += `<div class="tsp-slider-row"><input type="range" class="tsp-slider" id="tsp-rows" min="3" max="40" value="${maxPeerRows}"><span class="tsp-slider-val" id="tsp-rows-val">${maxPeerRows}</span></div>`;

        // ── Column toggles ──
        html += '<div class="tsp-section">Columns</div>';
        html += '<div class="tsp-col-grid">';
        for (const col of COLUMNS) {
            const checked = visibleColumns.includes(col.key) ? 'checked' : '';
            html += `<label class="tsp-col-item"><input type="checkbox" data-col="${col.key}" ${checked}>${col.label}</label>`;
        }
        html += '</div>';

        // ── Antarctica setting ──
        html += '<div class="tsp-section">Private Networks</div>';
        html += `<label class="tsp-col-item" title="Show map placeholders for private and ungeolocated peers. Peers remain in the table."><input type="checkbox" id="tsp-antarctica" ${showAntarcticaPeers ? 'checked' : ''}>Show in Antarctica</label>`;

        popup.innerHTML = html;
        document.body.appendChild(popup);
        tableSettingsEl = popup;
        tableSettingsBtn.setAttribute('aria-expanded', 'true');
        positionTableSettings();
        tableSettingsObserver = new ResizeObserver(positionTableSettings);
        tableSettingsObserver.observe(panelEl);
        tableSettingsObserver.observe(popup);
        window.addEventListener('resize', positionTableSettings);
        window.addEventListener('scroll', positionTableSettings, { capture: true, passive: true });
        popup.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closeTableSettings();
            tableSettingsBtn.focus();
        });
        popup.focus({ preventScroll: true });

        // Bind opacity slider
        /** @type {HTMLInputElement} */
        const opacitySlider = required('#tsp-opacity');
        const opacityVal = required('#tsp-opacity-val');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', () => {
                panelOpacity = parseInt(opacitySlider.value);
                opacityVal.textContent = panelOpacity + '%';
                applyPanelOpacity();
                saveTableDisplaySettings();
            });
        }

        // Bind visible rows slider
        /** @type {HTMLInputElement} */
        const rowsSlider = required('#tsp-rows');
        const rowsVal = required('#tsp-rows-val');
        if (rowsSlider) {
            rowsSlider.addEventListener('input', () => {
                maxPeerRows = parseInt(rowsSlider.value);
                if (rowsVal) rowsVal.textContent = String(maxPeerRows);
                applyMaxPeerRows();
                saveTableDisplaySettings();
            });
        }

        // Bind column toggles
        /** @type {HTMLInputElement[]} */ (queryAll('input[data-col]', popup)).forEach((cb) => {
            cb.addEventListener('change', () => {
                const key = cb.dataset.col || '';
                if (cb.checked) {
                    if (!visibleColumns.includes(key)) {
                        visibleColumns.push(key);
                    }
                } else {
                    // Don't allow removing all columns
                    const remaining = visibleColumns.filter((k) => k !== key);
                    if (remaining.length === 0) {
                        cb.checked = true;
                        return;
                    }
                    visibleColumns = remaining;
                }
                renderColgroup();
                renderPeerTableHead();
                renderPeerTable();
                saveTableDisplaySettings();
            });
        });

        // Bind Antarctica toggle
        /** @type {HTMLInputElement} */
        const antToggle = required('#tsp-antarctica');
        if (antToggle) {
            antToggle.addEventListener('change', () => {
                showAntarcticaPeers = antToggle.checked;
                saveTableDisplaySettings();
                onAction({ type: 'antarctica', visible: showAntarcticaPeers });
            });
        }

        // Bind Defaults button
        const defaultsBtn = required('#tsp-defaults');
        if (defaultsBtn) {
            defaultsBtn.addEventListener('click', () => {
                // Reset columns to defaults
                visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];
                // Reset transparency to 0%
                panelOpacity = 0;
                applyPanelOpacity();
                // Reset Antarctica setting
                showAntarcticaPeers = true;
                onAction({ type: 'antarctica', visible: true });
                // Reset visible rows to default
                maxPeerRows = 10;
                applyMaxPeerRows();
                // Reset auto-fit
                autoFitColumns = true;
                userColumnWidths = {};
                updateAutoFitBtn();
                // Re-render table
                renderColgroup();
                renderPeerTableHead();
                renderPeerTable();
                saveTableDisplaySettings();
                // Refresh the popup to reflect changes
                closeTableSettings();
                openTableSettings();
            });
        }

        // Capture outside clicks immediately, including controls that stop propagation.
        document.addEventListener('click', closeTableSettingsOnOutside, true);
    }

    function positionTableSettings() {
        if (!tableSettingsEl) return;
        const margin = 12, gap = 8;
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const anchor = tableSettingsBtn.getBoundingClientRect();
        const availableHeight = Math.max(0, height - margin * 2);
        const above = clamp(anchor.top - gap - margin, 0, availableHeight);
        const below = clamp(height - anchor.bottom - gap - margin, 0, availableHeight);
        const naturalHeight = tableSettingsEl.scrollHeight + 2;
        const useAbove = above >= naturalHeight || above >= below;
        tableSettingsEl.style.maxHeight = (useAbove ? above : below) + 'px';
        const popupHeight = tableSettingsEl.offsetHeight;
        const top = useAbove ? anchor.top - gap - popupHeight : anchor.bottom + gap;
        tableSettingsEl.style.top = clamp(top, margin, Math.max(margin, height - popupHeight - margin)) + 'px';
        tableSettingsEl.style.left = clamp(anchor.right - tableSettingsEl.offsetWidth, margin, Math.max(margin, width - tableSettingsEl.offsetWidth - margin)) + 'px';
    }

    function applyPanelOpacity() {
        const alpha = panelOpacity / 100;
        const handle = query('.peer-panel-handle', document);
        const body = query('.peer-panel-body', document);
        if (handle) handle.style.background = `rgba(10, 14, 20, ${alpha})`;
        if (body) body.style.background = `rgba(10, 14, 20, ${alpha})`;
    }

    /** @param {MouseEvent} e */
    function closeTableSettingsOnOutside(e) {
        if (e.target instanceof Node && tableSettingsEl && !tableSettingsEl.contains(e.target) && !tableSettingsBtn.contains(e.target)) {
            closeTableSettings();
        }
    }

    function closeTableSettings() {
        tableSettingsObserver?.disconnect();
        tableSettingsObserver = null;
        window.removeEventListener('resize', positionTableSettings);
        window.removeEventListener('scroll', positionTableSettings, true);
        tableSettingsBtn.setAttribute('aria-expanded', 'false');
        if (tableSettingsEl) {
            tableSettingsEl.remove();
            tableSettingsEl = null;
        }
        document.removeEventListener('click', closeTableSettingsOnOutside, true);
    }

    function applyMaxPeerRows() {
        if (disposed) return;
        if (fitTimer !== null) clearTimeout(fitTimer);
        fitTimer = null;
        const panel = query('.peer-panel', document);
        if (!panel) return;
        let prefitForPanelGrowth = false;
        if (maxPeerRows > 0) {
            const headerHeight = required('#peer-panel-handle').offsetHeight;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
            const topbarBottom = document.getElementById('topbar')?.getBoundingClientRect().bottom || 0;
            const available = Math.max(headerHeight + 44, viewportHeight - topbarBottom - 40);
            const h = Math.min(headerHeight + 22 + maxPeerRows * 22 + 4, available);
            const finalPanelTop = viewportHeight - 28 - h;
            const currentPanelTop = panel.getBoundingClientRect().top;
            panel.style.maxHeight = h + 'px';
            if (finalPanelTop < currentPanelTop) {
                onAction({ type: 'fit', top: finalPanelTop, immediate: true });
                prefitForPanelGrowth = true;
            }
        } else {
            panel.style.maxHeight = '';
        }
        if (prefitForPanelGrowth) {
            fitTimer = setTimeout(() => { fitTimer = null; onAction({ type: 'fit' }); }, 520);
        } else {
            onAction({ type: 'layout' });
        }
    }

    const headerObserver = new ResizeObserver(applyMaxPeerRows);
    headerObserver.observe(required('#peer-panel-handle'));

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (fitTimer !== null) clearTimeout(fitTimer);
        tableTools.dispose();
        tableWindow.dispose();
        headerObserver.disconnect();
        columnObserver.disconnect();
        if (layoutFrame) cancelAnimationFrame(layoutFrame);
        document.fonts.removeEventListener('loadingdone', refreshFonts);
        closeTableSettings();
    }

    /**
     * @param {number | null} peerId
     * @param {boolean} [scrollIntoView]
     */
    function highlightTableRow(peerId, scrollIntoView) {
        highlightedRowId = peerId;
        // Remove previous highlight
        const prev = query('.row-highlight', tbodyEl);
        if (prev) prev.classList.remove('row-highlight');

        if (peerId === null) return;

        if (scrollIntoView && !panelEl.classList.contains('collapsed')) {
            tableWindow.reveal(peerId, !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        }

        const row = query(`tr[data-id="${peerId}"]`, tbodyEl);
        if (row) {
            row.classList.add('row-highlight');
        }
    }

    return Object.freeze({
        get showAntarcticaPeers() {
            return showAntarcticaPeers;
        },
        currentTableDisplaySettings,
        loadTableDisplaySettings,
        get panelEl() {
            return panelEl;
        },
        get tbodyEl() {
            return tbodyEl;
        },
        renderPeerTableHead,
        renderPeerTable,
        updateAutoFitBtn,
        applyPanelOpacity,
        applyMaxPeerRows,
        highlightTableRow,
        dispose,
    });
}

export { create };
