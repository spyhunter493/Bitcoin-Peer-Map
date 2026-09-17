/* Peer table filtering, sorting, columns, and persisted display settings. */
(function (global) {
    'use strict';

    /** @param {import('../types').PeerTableOptions} options
     *  @returns {import('../types').PeerTableController} */
    function create(options) {
        const privateState = options.state;
        const sourceData = options.data;
        const actions = options.actions;

        // Connection type acronyms: short form + full description for hover
        const CONN_TYPE_SHORT = {
            'outbound-full-relay': 'OFR',
            'block-relay-only': 'BRO',
            'manual': 'MAN',
            'addr-fetch': 'AF',
            'feeler': 'FLR',
            'inbound': 'IN',
        };
        /** Get short type string for a peer and its full description */
        function peerTypeShort(p) {
            const dir = p.direction === 'IN' ? 'IN' : 'OUT';
            if (!p.connection_type) return dir;
            const ct = (Object.hasOwn(CONN_TYPE_SHORT, p.connection_type) ? CONN_TYPE_SHORT[p.connection_type] : null) || p.connection_type;
            return p.direction === 'IN' ? ct : `${dir}/${ct}`;
        }
        function peerTypeFull(p) {
            const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
            return p.connection_type ? `${dir} / ${p.connection_type}` : dir;
        }

        // Column definitions: { key, label, get(short), full(hover), vis, width }
        // width: preferred width in px for fixed layout. min is enforced via CSS.
        const COLUMNS = [
            { key: 'id',              label: 'ID',       get: p => p.id,                                      full: null,  vis: true,  w: 40  },
            { key: 'network',         label: 'Net',      get: p => (sourceData.NET_DISPLAY[p.network] || p.network),     full: null,  vis: true,  w: 45  },
            { key: 'conntime_fmt',    label: 'Duration', get: p => p.conntime_fmt || '—',                     full: null,  vis: true,  w: 75  },
            { key: 'connection_type', label: 'Type',     get: p => peerTypeShort(p),                           full: p => peerTypeFull(p), vis: true, w: 70 },
            { key: 'addr',            label: 'IP:Port',  get: p => p.addr || `${p.ip}:${p.port}`,             full: null,  vis: true,  w: 130 },
            { key: 'subver',          label: 'Software', get: p => p.subver || '—',                            full: null,  vis: true,  w: 90  },
            { key: 'services_abbrev', label: 'Services', get: p => actions.serviceAbbrev(p.services),                    full: p => actions.serviceHover(p.services),  vis: true,  w: 70  },
            { key: 'city',            label: 'City',     get: p => p.city || '—',                              full: null,  vis: true,  w: 60  },
            { key: 'regionName',      label: 'Region',   get: p => p.regionName || '—',                        full: null,  vis: true,  w: 55  },
            { key: 'country',         label: 'Country',  get: p => p.country || '—',                           full: null,  vis: true,  w: 70  },
            { key: 'continent',       label: 'Cont.',    get: p => p.continent || '—',                         full: null,  vis: true,  w: 60  },
            { key: 'isp',             label: 'ISP',      get: p => p.isp || '—',                               full: null,  vis: true,  w: 110 },
            { key: 'ping_ms',         label: 'Ping',     get: p => p.ping_ms != null ? p.ping_ms + 'ms' : '—', full: null, vis: true,  w: 50  },
            { key: 'bytessent_fmt',   label: 'Sent',     get: p => p.bytessent_fmt || '—',                     full: null,  vis: true,  w: 60  },
            { key: 'bytesrecv_fmt',   label: 'Recv',     get: p => p.bytesrecv_fmt || '—',                     full: null,  vis: true,  w: 60  },
            { key: 'in_addrman',      label: 'Addrman',  get: p => p.in_addrman ? 'Yes' : 'No',                full: null,  vis: true,  w: 55  },
            // Advanced columns (hidden by default)
            { key: 'direction',       label: 'Dir',      get: p => p.direction === 'IN' ? 'IN' : 'OUT',        full: p => p.direction === 'IN' ? 'Inbound' : 'Outbound', vis: false, w: 40 },
            { key: 'countryCode',     label: 'CC',       get: p => p.countryCode || '—',                       full: null,  vis: false, w: 35  },
            { key: 'continentCode',   label: 'CntC',     get: p => p.continentCode || '—',                     full: null,  vis: false, w: 40  },
            { key: 'lat',             label: 'Lat',      get: p => p.lat != null ? p.lat.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
            { key: 'lon',             label: 'Lon',      get: p => p.lon != null ? p.lon.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
            { key: 'region',          label: 'Rgn',      get: p => p.region || '—',                             full: null,  vis: false, w: 60  },
            { key: 'as',              label: 'AS',        get: p => p.as || '—',                                full: null,  vis: false, w: 80  },
            { key: 'asname',          label: 'AS Name',   get: p => p.asname || '—',                            full: null,  vis: false, w: 100 },
            { key: 'district',        label: 'District',  get: p => p.district || '—',                          full: null,  vis: false, w: 80  },
            { key: 'mobile',          label: 'Mob',       get: p => p.mobile ? 'Y' : 'N',                       full: p => p.mobile ? 'Yes' : 'No', vis: false, w: 35 },
            { key: 'org',             label: 'Org',       get: p => p.org || '—',                               full: null,  vis: false, w: 100 },
            { key: 'timezone',        label: 'TZ',        get: p => p.timezone || '—',                          full: null,  vis: false, w: 70  },
            { key: 'currency',        label: 'Curr',      get: p => p.currency || '—',                          full: null,  vis: false, w: 45  },
            { key: 'hosting',         label: 'Host',      get: p => p.hosting ? 'Y' : 'N',                      full: p => p.hosting ? 'Yes' : 'No', vis: false, w: 35 },
            { key: 'offset',          label: 'UTC',        get: p => p.offset != null ? p.offset : '—',         full: null,  vis: false, w: 45  },
            { key: 'proxy',           label: 'Proxy',      get: p => p.proxy ? 'Y' : 'N',                       full: p => p.proxy ? 'Yes' : 'No', vis: false, w: 40 },
            { key: 'zip',             label: 'ZIP',        get: p => p.zip || '—',                              full: null,  vis: false, w: 55  },
        ];

        // Visible column keys (start with defaults, can be toggled later)
        const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter(c => c.vis).map(c => c.key);
        let visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];

        // Sort state
        let sortKey = 'id';
        let sortAsc = true;

        // Auto-fit column state: ON by default, OFF when user resizes
        let autoFitColumns = true;
        let userColumnWidths = {};  // key -> px width (only used when autoFit OFF)
        let panelOpacity = 0;       // 0 = invisible, 100 = opaque
        let maxPeerRows = 10;       // visible rows in peer table
        let showAntarcticaPeers = true;
        const TABLE_COLUMN_KEYS = new Set(COLUMNS.map(c => c.key));

        function normalizeVisibleColumns(columns) {
            if (!Array.isArray(columns)) return [...DEFAULT_VISIBLE_COLUMNS];
            const normalized = [];
            for (const key of columns) {
                if (typeof key === 'string' && TABLE_COLUMN_KEYS.has(key) && !normalized.includes(key)) {
                    normalized.push(key);
                }
            }
            return normalized.length > 0 ? normalized : [...DEFAULT_VISIBLE_COLUMNS];
        }

        function normalizeColumnWidths(widths) {
            const normalized = {};
            if (!widths || typeof widths !== 'object' || Array.isArray(widths)) return normalized;
            for (const [key, rawWidth] of Object.entries(widths)) {
                if (!TABLE_COLUMN_KEYS.has(key)) continue;
                const width = Number(rawWidth);
                if (Number.isFinite(width)) normalized[key] = Math.round(sourceData.clamp(width, 30, 400));
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
            actions.writeSavedDisplaySettings(Object.assign(
                {},
                actions.readSavedDisplaySettings(),
                currentTableDisplaySettings()
            ));
        }

        function loadTableDisplaySettings() {
            const saved = actions.readSavedDisplaySettings();

            visibleColumns = normalizeVisibleColumns(saved.visibleColumns);

            if (typeof saved.autoFitColumns === 'boolean') {
                autoFitColumns = saved.autoFitColumns;
            }
            userColumnWidths = normalizeColumnWidths(saved.userColumnWidths);
            if (autoFitColumns) userColumnWidths = {};

            if (Number.isFinite(Number(saved.panelOpacity))) {
                panelOpacity = Math.round(sourceData.clamp(Number(saved.panelOpacity), 0, 100));
            }
            if (Number.isFinite(Number(saved.maxPeerRows))) {
                maxPeerRows = Math.round(sourceData.clamp(Number(saved.maxPeerRows), 3, 40));
            }
            if (typeof saved.showAntarcticaPeers === 'boolean') {
                showAntarcticaPeers = saved.showAntarcticaPeers;
            }
        }

        // Panel DOM (let because ban list view replaces and restores them)
        const panelEl = document.getElementById('peer-panel');
        let theadEl = document.getElementById('peer-thead');
        let tbodyEl = document.getElementById('peer-tbody');


        // Panel toggle (clicking the title bar)
        document.getElementById('peer-panel-handle').addEventListener('click', () => {
            panelEl.classList.toggle('collapsed');
            // [DISTRIBUTION] When expanding peer list, bring it on top of AS panel
            if (!panelEl.classList.contains('collapsed')) {
                document.body.classList.add('panel-focus-peers');
                document.body.classList.remove('panel-focus-as');
            }
            actions.scheduleDonutStackFit();
        });

        // [DISTRIBUTION] Clicking anywhere in peer panel body → bring peers to front
        const peerPanelBody = document.querySelector('.peer-panel-body');
        if (peerPanelBody) {
            peerPanelBody.addEventListener('click', () => {
                document.body.classList.add('panel-focus-peers');
                document.body.classList.remove('panel-focus-as');
            });
        }

        /** Build colgroup with column widths.
         *  Auto-fit ON: compute widths from data distribution (~95th percentile of value lengths),
         *  then scale proportionally to fill the viewport.
         *  Auto-fit OFF: use reasonable default widths from column definitions. */
        function renderColgroup() {
            const table = document.getElementById('peer-table');
            // Remove old colgroup if present
            const old = table.querySelector('colgroup');
            if (old) old.remove();

            if (autoFitColumns) {
                // ── Auto-fit: size columns to fit viewport based on data ──
                table.style.tableLayout = 'fixed';
                const cg = document.createElement('colgroup');
                const charPx = 7;  // approximate px per character at font-size 11px
                const headerPad = 28; // padding + sort arrow
                const colPad = 16;   // cell padding (8px each side)
                const actionsW = 80; // fixed actions column

                // Measure available width
                const tableWrap = table.closest('.peer-table-wrap');
                const availW = (tableWrap ? tableWrap.clientWidth : sourceData.W) - actionsW;

                const widths = [];
                for (const key of visibleColumns) {
                    const col = COLUMNS.find(c => c.key === key);
                    if (!col) { widths.push(60); continue; }

                    // Minimum: header label width
                    const headerW = col.label.length * charPx + headerPad;

                    if (sourceData.lastPeers.length === 0) {
                        widths.push(Math.max(headerW, col.w));
                        continue;
                    }

                    // Gather string lengths for all values
                    const lens = sourceData.lastPeers.map(p => String(col.get(p)).length);
                    lens.sort((a, b) => a - b);

                    // Use ~95th percentile to ignore extreme outliers (e.g. Tor/I2P addresses)
                    const p95Idx = Math.min(Math.floor(lens.length * 0.95), lens.length - 1);
                    const p95Len = lens[p95Idx];
                    const dataW = p95Len * charPx + colPad;

                    widths.push(Math.max(headerW, Math.min(dataW, 250)));
                }

                // Scale proportionally to fill available width
                const totalNatural = widths.reduce((s, w) => s + w, 0);
                const scale = totalNatural > 0 ? Math.max(availW / totalNatural, 0.5) : 1;

                for (const w of widths) {
                    const colEl = document.createElement('col');
                    colEl.style.width = Math.round(w * scale) + 'px';
                    cg.appendChild(colEl);
                }
                // Actions column
                const actCol = document.createElement('col');
                actCol.style.width = actionsW + 'px';
                cg.appendChild(actCol);
                table.insertBefore(cg, table.firstChild);
                return;
            }

            // ── Auto-fit OFF: use reasonable default widths from column definitions ──
            table.style.tableLayout = 'fixed';
            const cg = document.createElement('colgroup');
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                const colEl = document.createElement('col');
                const w = userColumnWidths[key] || (col ? col.w : 80);
                colEl.style.width = w + 'px';
                cg.appendChild(colEl);
            }
            // Actions column (single Disconnect button)
            const actCol = document.createElement('col');
            actCol.style.width = '80px';
            cg.appendChild(actCol);
            table.insertBefore(cg, table.firstChild);
        }

        /** Build table header row with resize handles */
        function renderPeerTableHead() {
            let html = '<tr>';
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) continue;
                const isActive = sortKey === key;
                // 3-state: no sortKey = unsorted (dim arrow), asc = ▲, desc = ▼
                const arrow = isActive ? (sortAsc ? '&#9650;' : '&#9660;') : '';
                const cls = isActive ? 'sort-arrow active' : 'sort-arrow';
                html += `<th data-sort="${key}"><span class="th-text">${col.label} <span class="${cls}">${arrow}</span></span><span class="th-resize" data-col="${key}"></span></th>`;
            }
            html += '<th>Actions</th>';
            html += '</tr>';
            theadEl.innerHTML = html;
            renderColgroup();
        }

        /** Keep peer rows and unchanged cells in place across snapshots. */
        let renderedColumns = '';

        function setCell(cell, value, title) {
            const text = String(value ?? '');
            const tooltip = String(title ?? '');
            if (cell.textContent !== text) cell.textContent = text;
            if (cell.title !== tooltip) cell.title = tooltip;
        }

        function updatePeerRow(row, peer, columns, rebuildCells) {
            const net = peer.network || 'ipv4';
            if (row.dataset.net !== net) row.dataset.net = net;
            row.classList.toggle('row-highlight', sourceData.highlightedPeerId === peer.id);
            if (rebuildCells || row.cells.length !== columns.length + 1) {
                row.replaceChildren();
                for (let i = 0; i < columns.length + 1; i++) {
                    row.appendChild(document.createElement('td'));
                }
                const button = document.createElement('button');
                button.className = 'peer-action-btn';
                button.dataset.action = 'disconnect';
                button.dataset.id = String(peer.id);
                button.textContent = 'Disconnect';
                row.lastElementChild.appendChild(button);
            }
            for (let i = 0; i < columns.length; i++) {
                const column = columns[i];
                const value = column.get(peer);
                setCell(row.cells[i], value, column.full ? column.full(peer) : value);
            }
            const button = row.lastElementChild.firstElementChild;
            if (button.dataset.net !== net) button.dataset.net = net;
        }

        /** Build table body from lastPeers (filtered by active network filter) */
        function renderPeerTable() {
            if (!tbodyEl) return;
            const filtered = global.BPMPeerTableModel.filterPeers(sourceData.lastPeers, {
                privateMode: privateState.privateNetMode,
                privateNetwork: privateState.pnSelectedNet,
                passesNetwork: actions.passesNetFilter,
                providerPeerIds: sourceData.asFilterPeerIds,
                mapPeerIds: sourceData.mapFilterPeerIds,
            });
            const sorted = global.BPMPeerTableModel.sortPeers(
                filtered, COLUMNS.find(column => column.key === sortKey), sortAsc
            );


            const signature = visibleColumns.join('|');
            const rebuildCells = signature !== renderedColumns;
            const columns = visibleColumns.map(key => COLUMNS.find(column => column.key === key)).filter(Boolean);
            const rowsById = new Map(Array.from(tbodyEl.rows, row => [Number(row.dataset.id), row]));
            const activeIds = new Set(sorted.map(peer => peer.id));
            for (const [id, row] of rowsById) {
                if (!activeIds.has(id)) {
                    row.remove();
                    rowsById.delete(id);
                }
            }
            // Walk backward so only rows whose order changed need to move.
            let nextRow = null;
            for (let i = sorted.length - 1; i >= 0; i--) {
                const peer = sorted[i];
                let row = rowsById.get(peer.id);
                if (!row) {
                    row = document.createElement('tr');
                    row.dataset.id = String(peer.id);
                }
                updatePeerRow(row, peer, columns, rebuildCells);
                if (row.parentNode !== tbodyEl || row.nextSibling !== nextRow) {
                    tbodyEl.insertBefore(row, nextRow);
                }
                nextRow = row;
            }
            renderedColumns = signature;
        }

        // Initial header render
        renderPeerTableHead();

        // ── Named event handlers (for reattachment after ban list close) ──

        let resizingColumn = false;  // suppress sort click when resize drag occurred
        let draggingColumn = false;  // suppress sort click when column reorder drag occurred

        function handleTheadClick(e) {
            // Suppress sort if this click followed a column resize or reorder drag
            if (resizingColumn) { resizingColumn = false; return; }
            if (draggingColumn) { draggingColumn = false; return; }
            // Ignore clicks on resize handles
            if (e.target.closest('.th-resize')) return;
            const th = e.target.closest('th[data-sort]');
            if (!th) return;
            const key = th.dataset.sort;
            // 3-state sort cycle: unsorted → ascending → descending → unsorted
            if (sortKey === key) {
                if (sortAsc) {
                    sortAsc = false;  // asc → desc
                } else {
                    sortKey = null;   // desc → unsorted
                    sortAsc = true;
                }
            } else {
                sortKey = key;
                sortAsc = true;       // new column → ascending
            }
            renderPeerTableHead();
            renderPeerTable();
        }

        let resizeState = null;
        function handleTheadResize(e) {
            const handle = e.target.closest('.th-resize');
            if (!handle) return;
            e.preventDefault();
            e.stopPropagation();
            const colKey = handle.dataset.col;
            const th = handle.parentElement;
            const startX = e.clientX;
            const startW = th.offsetWidth;

            resizeState = { colKey, th, startX, startW };

            const onMove = (me) => {
                if (!resizeState) return;
                resizingColumn = true;  // flag to suppress subsequent sort click
                const delta = me.clientX - resizeState.startX;
                const newW = Math.max(30, resizeState.startW + delta);
                if (autoFitColumns) {
                    autoFitColumns = false;
                    const ths = theadEl.querySelectorAll('th[data-sort]');
                    ths.forEach(t => {
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
        let colDragIndicator = null;

        function handleTheadDragStart(e) {
            // Only start column drag on th text area (not resize handle)
            if (e.target.closest('.th-resize')) return;
            const th = e.target.closest('th[data-sort]');
            if (!th) return;

            const key = th.dataset.sort;
            const startX = e.clientX;
            const thRect = th.getBoundingClientRect();
            let moved = false;

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
                    colDragIndicator.textContent = th.querySelector('.th-text') ? th.querySelector('.th-text').textContent.trim() : key;
                    colDragIndicator.style.width = thRect.width + 'px';
                    document.body.appendChild(colDragIndicator);
                }
                if (colDragIndicator) {
                    colDragIndicator.style.left = (me.clientX - thRect.width / 2) + 'px';
                    colDragIndicator.style.top = (thRect.top - 2) + 'px';
                }
                // Highlight drop target
                const allThs = Array.from(theadEl.querySelectorAll('th[data-sort]'));
                allThs.forEach(t => t.classList.remove('col-drag-over'));
                const targetTh = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
                const dropTh = targetTh ? targetTh.closest('th[data-sort]') : null;
                if (dropTh && dropTh !== th) dropTh.classList.add('col-drag-over');
            };

            const onUp = (me) => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (colDragIndicator) { colDragIndicator.remove(); colDragIndicator = null; }
                // Clean up highlight
                theadEl.querySelectorAll('.col-drag-over').forEach(t => t.classList.remove('col-drag-over'));

                if (!moved) return;
                // Find drop target
                const targetEl = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
                const dropTh = targetEl ? targetEl.closest('th[data-sort]') : null;
                if (dropTh && dropTh.dataset.sort !== key) {
                    const fromIdx = visibleColumns.indexOf(key);
                    const toIdx = visibleColumns.indexOf(dropTh.dataset.sort);
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
        const autoFitBtn = document.getElementById('btn-autofit');
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
        const tableSettingsBtn = document.getElementById('btn-table-settings');
        let tableSettingsEl = null;

        if (tableSettingsBtn) {
            tableSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (tableSettingsEl) { closeTableSettings(); return; }
                openTableSettings();
            });
        }

        function openTableSettings() {
            closeTableSettings();
            const popup = document.createElement('div');
            popup.className = 'table-settings-popup';
            popup.id = 'table-settings-popup';

            let html = '<div class="tsp-header"><span class="tsp-title">Table Settings</span><button class="tsp-defaults-btn" id="tsp-defaults">Defaults</button></div>';

            // ── Transparency slider ──
            html += '<div class="tsp-section">Transparency</div>';
            html += `<div class="tsp-slider-row"><input type="range" class="tsp-slider" id="tsp-opacity" min="0" max="100" value="${panelOpacity}"><span class="tsp-slider-val" id="tsp-opacity-val">${panelOpacity}%</span></div>`;

            // ── Visible rows ──
            html += '<div class="tsp-section">Visible Rows</div>';
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
            html += `<label class="tsp-col-item"><input type="checkbox" id="tsp-antarctica" ${showAntarcticaPeers ? 'checked' : ''}>Show in Antarctica</label>`;

            popup.innerHTML = html;
            document.body.appendChild(popup);
            tableSettingsEl = popup;

            // Position below the gear button
            if (tableSettingsBtn) {
                const rect = tableSettingsBtn.getBoundingClientRect();
                popup.style.right = (window.innerWidth - rect.right) + 'px';
                popup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
            }

            // Bind opacity slider
            const opacitySlider = document.getElementById('tsp-opacity');
            const opacityVal = document.getElementById('tsp-opacity-val');
            if (opacitySlider) {
                opacitySlider.addEventListener('input', () => {
                    panelOpacity = parseInt(opacitySlider.value);
                    opacityVal.textContent = panelOpacity + '%';
                    applyPanelOpacity();
                    saveTableDisplaySettings();
                });
            }

            // Bind visible rows slider
            const rowsSlider = document.getElementById('tsp-rows');
            const rowsVal = document.getElementById('tsp-rows-val');
            if (rowsSlider) {
                rowsSlider.addEventListener('input', () => {
                    maxPeerRows = parseInt(rowsSlider.value);
                    if (rowsVal) rowsVal.textContent = maxPeerRows;
                    applyMaxPeerRows();
                    saveTableDisplaySettings();
                });
            }

            // Bind column toggles
            popup.querySelectorAll('input[data-col]').forEach(cb => {
                cb.addEventListener('change', () => {
                    const key = cb.dataset.col;
                    if (cb.checked) {
                        if (!visibleColumns.includes(key)) {
                            visibleColumns.push(key);
                        }
                    } else {
                        // Don't allow removing all columns
                        const remaining = visibleColumns.filter(k => k !== key);
                        if (remaining.length === 0) { cb.checked = true; return; }
                        visibleColumns = remaining;
                    }
                    renderColgroup();
                    renderPeerTableHead();
                    renderPeerTable();
                    saveTableDisplaySettings();
                });
            });

            // Bind Antarctica toggle
            const antToggle = document.getElementById('tsp-antarctica');
            if (antToggle) {
                antToggle.addEventListener('change', () => {
                    showAntarcticaPeers = antToggle.checked;
                    saveTableDisplaySettings();
                });
            }

            // Bind Defaults button
            const defaultsBtn = document.getElementById('tsp-defaults');
            if (defaultsBtn) {
                defaultsBtn.addEventListener('click', () => {
                    // Reset columns to defaults
                    visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];
                    // Reset transparency to 0%
                    panelOpacity = 0;
                    applyPanelOpacity();
                    // Reset Antarctica setting
                    showAntarcticaPeers = true;
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

            setTimeout(() => {
                document.addEventListener('click', closeTableSettingsOnOutside);
            }, 0);
        }

        function applyPanelOpacity() {
            const alpha = panelOpacity / 100;
            const handle = document.querySelector('.peer-panel-handle');
            const body = document.querySelector('.peer-panel-body');
            if (handle) handle.style.background = `rgba(10, 14, 20, ${alpha})`;
            if (body) body.style.background = `rgba(10, 14, 20, ${alpha})`;
        }

        function closeTableSettingsOnOutside(e) {
            if (tableSettingsEl && !tableSettingsEl.contains(e.target) && e.target !== tableSettingsBtn) {
                closeTableSettings();
            }
        }

        function closeTableSettings() {
            if (tableSettingsEl) { tableSettingsEl.remove(); tableSettingsEl = null; }
            document.removeEventListener('click', closeTableSettingsOnOutside);
        }


    function applyMaxPeerRows() {
            const panel = document.querySelector('.peer-panel');
            if (!panel) return;
            let prefitForPanelGrowth = false;
            if (maxPeerRows > 0) {
                // handle(48) + thead(22) + rows * 22 + a tiny bit of padding
                const h = 48 + 22 + (maxPeerRows * 22) + 4;
                const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
                const finalPanelTop = viewportHeight - h;
                const currentPanelTop = panel.getBoundingClientRect().top;
                panel.style.maxHeight = h + 'px';
                if (finalPanelTop < currentPanelTop) {
                    actions.fitDonutStackForPanelTop(finalPanelTop, true);
                    prefitForPanelGrowth = true;
                }
            } else {
                panel.style.maxHeight = '';
            }
            if (prefitForPanelGrowth) {
                setTimeout(actions.fitDonutStackToViewport, 520);
            } else {
                actions.scheduleDonutStackFit();
            }
        }

    function highlightTableRow(peerId, scrollIntoView) {
            // Remove previous highlight
            const prev = tbodyEl.querySelector('.row-highlight');
            if (prev) prev.classList.remove('row-highlight');

            if (peerId === null) return;

            const row = tbodyEl.querySelector(`tr[data-id="${peerId}"]`);
            if (row) {
                row.classList.add('row-highlight');
                if (scrollIntoView && !panelEl.classList.contains('collapsed')) {
                    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    row.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
                }
            }
        }

        return Object.freeze({
            get showAntarcticaPeers() { return showAntarcticaPeers; },
            currentTableDisplaySettings,
            loadTableDisplaySettings,
            get panelEl() { return panelEl; },
            get tbodyEl() { return tbodyEl; },
            renderPeerTableHead,
            renderPeerTable,
            updateAutoFitBtn,
            applyPanelOpacity,
            applyMaxPeerRows,
            highlightTableRow,
        });
    }

    global.BPMPeerTable = Object.freeze({ create });
})(window);
