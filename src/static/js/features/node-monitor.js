/* Node diagnostics: overview, recent blocks, and chain-tip modals. */
(function (global) {
    'use strict';

    const modal = global.BPMModal;
    const api = global.BPMApi;

    function fmtDateTime(seconds) {
        if (!seconds) return '\u2014';
        return new Date(seconds * 1000).toLocaleString();
    }

    function fmtAge(seconds) {
        if (seconds == null || seconds < 0) return '\u2014';
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
        return `${Math.floor(seconds / 86400)}d`;
    }

    function fmtDifficulty(value) {
        const difficulty = Number(value);
        if (!Number.isFinite(difficulty) || difficulty <= 0) return '\u2014';
        if (difficulty >= 1e12) return `${(difficulty / 1e12).toFixed(2)}T`;
        if (difficulty >= 1e9) return `${(difficulty / 1e9).toFixed(2)}B`;
        if (difficulty >= 1e6) return `${(difficulty / 1e6).toFixed(2)}M`;
        return difficulty.toLocaleString();
    }

    function shortHash(hash) {
        if (!hash) return '\u2014';
        if (hash.length <= 20) return hash;
        return `${hash.substring(0, 10)}\u2026${hash.substring(hash.length - 8)}`;
    }

    function blockExplorerUrl(hash, chain) {
        if (!hash) return null;
        const paths = {
            main: '',
            test: '/testnet',
            testnet4: '/testnet4',
            signet: '/signet',
        };
        const chainPath = paths[chain];
        if (chainPath == null) return null;
        return `https://mempool.space${chainPath}/block/${encodeURIComponent(hash)}`;
    }

    function blockHashCell(hash, chain) {
        const title = modal.escapeHtml(hash);
        const text = modal.escapeHtml(shortHash(hash));
        const url = blockExplorerUrl(hash, chain);
        return url
            ? `<a class="modal-link modal-mono" href="${url}" target="_blank" rel="noopener" title="${title}">${text}</a>`
            : `<span class="modal-mono" title="${title}">${text}</span>`;
    }

    function renderRecentBlocks(data, formatBytes) {
        if (!data || data.success !== true) {
            return `<div style="color:var(--err)">${modal.escapeHtml(data && (data.error || data.detail) || 'Could not load recent blocks')}</div>`;
        }

        const summary = data.summary || {};
        const blocks = Array.isArray(data.blocks) ? data.blocks : [];
        let html = '<div class="modal-section-title">Summary</div>';
        html += '<div class="modal-summary-grid">';
        html += modal.summaryItem('Tip Height', summary.tip_height != null ? summary.tip_height.toLocaleString() : '\u2014');
        html += modal.summaryItem('Blocks', summary.count != null ? summary.count.toLocaleString() : blocks.length.toLocaleString());
        html += modal.summaryItem('Avg Size', summary.avg_size_mb != null ? `${summary.avg_size_mb} MB` : '\u2014');
        html += modal.summaryItem('Avg TXs', summary.avg_transactions != null ? summary.avg_transactions.toLocaleString() : '\u2014');
        html += modal.summaryItem('Total TXs', summary.total_transactions != null ? summary.total_transactions.toLocaleString() : '\u2014');
        html += modal.summaryItem('Latest', fmtDateTime(summary.latest_time));
        html += '</div>';

        html += '<div class="modal-section-title">Recent Blocks</div>';
        if (!blocks.length) {
            return html + '<div style="color:var(--text-muted);padding:4px 0">No block data returned</div>';
        }

        html += '<div class="modal-table-wrap"><table class="modal-data-table">';
        html += '<colgroup><col style="width:82px"><col style="width:170px"><col style="width:74px"><col style="width:86px"><col style="width:74px"><col style="width:82px"><col style="width:96px"></colgroup>';
        html += '<thead><tr><th>Height</th><th>Hash</th><th>Age</th><th>Size</th><th>TXs</th><th>Version</th><th>Difficulty</th></tr></thead><tbody>';
        for (const block of blocks) {
            const height = block.height != null ? Number(block.height).toLocaleString() : '\u2014';
            html += '<tr>';
            html += `<td class="modal-mono num">${modal.escapeHtml(height)}</td>`;
            html += `<td>${blockHashCell(block.hash || '', summary.chain)}</td>`;
            html += `<td title="${modal.escapeHtml(fmtDateTime(block.time))}">${modal.escapeHtml(fmtAge(block.age_seconds))}</td>`;
            html += `<td class="num">${modal.escapeHtml(formatBytes(block.size || 0))}</td>`;
            html += `<td class="modal-mono num">${modal.escapeHtml((block.tx_count || 0).toLocaleString())}</td>`;
            html += `<td class="modal-mono num">${modal.escapeHtml(block.version ?? '\u2014')}</td>`;
            html += `<td class="num">${modal.escapeHtml(fmtDifficulty(block.difficulty))}</td>`;
            html += '</tr>';
        }
        return html + '</tbody></table></div>';
    }

    function chainTipStatusClass(status) {
        const safeStatus = String(status || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '-');
        return `chain-tip-status-${safeStatus}`;
    }

    function renderChainTips(data) {
        if (!data || data.success !== true) {
            return `<div style="color:var(--err)">${modal.escapeHtml(data && (data.error || data.detail) || 'Could not load chain tips')}</div>`;
        }

        const summary = data.summary || {};
        const tips = Array.isArray(data.tips) ? data.tips : [];
        let html = '<div class="modal-section-title">Summary</div>';
        html += '<div class="modal-summary-grid chain-tip-summary-grid">';
        html += modal.summaryItem('Best Height', summary.best_height != null ? summary.best_height.toLocaleString() : '\u2014');
        html += modal.summaryItem('Tips', summary.total != null ? summary.total.toLocaleString() : tips.length.toLocaleString());
        html += modal.summaryItem('Active', summary.active_count != null ? summary.active_count.toLocaleString() : '\u2014');
        html += modal.summaryItem('Non-active', summary.non_active_count != null ? summary.non_active_count.toLocaleString() : '\u2014');
        html += modal.summaryItem('Forks', summary.fork_count != null ? summary.fork_count.toLocaleString() : '\u2014');
        const latestNonActive = summary.latest_non_active_height != null
            ? `#${summary.latest_non_active_height.toLocaleString()} ${summary.latest_non_active_status || ''}`.trim()
            : 'None';
        html += modal.summaryItem('Latest Non-active Tip', latestNonActive);
        html += '</div>';

        if (summary.best_hash) {
            html += modal.row('Best Block Hash', shortHash(summary.best_hash), 'Best block hash on the active chain', summary.best_hash);
        }

        html += '<div class="modal-section-title">Chain Tips</div>';
        if (!tips.length) {
            return html + '<div style="color:var(--text-muted);padding:4px 0">No chain-tip data returned</div>';
        }
        if (!summary.non_active_count) {
            html += '<div style="color:var(--ok);padding:4px 0">No forked or stale chain tips reported</div>';
        }
        if (summary.age_lookup_limited) {
            const ageLookupLimit = summary.age_lookup_limit ?? 100;
            html += `<div style="color:var(--text-muted);padding:4px 0">Age lookup limited to the first ${modal.escapeHtml(ageLookupLimit)} prioritized tips</div>`;
        }

        html += '<div class="modal-table-wrap"><table class="modal-data-table chain-tip-table">';
        html += '<colgroup><col style="width:120px"><col style="width:90px"><col style="width:82px"><col style="width:180px"><col style="width:74px"></colgroup>';
        html += '<thead><tr><th>Status</th><th>Height</th><th>Branch</th><th>Hash</th><th>Age</th></tr></thead><tbody>';
        for (const tip of tips) {
            const status = tip.status || 'unknown';
            const statusLabel = tip.status_label || status;
            const height = tip.height != null ? Number(tip.height).toLocaleString() : '\u2014';
            const branchLength = tip.branch_length != null ? Number(tip.branch_length).toLocaleString() : '\u2014';
            html += '<tr>';
            html += `<td><span class="chain-tip-status ${chainTipStatusClass(status)}">${modal.escapeHtml(statusLabel)}</span></td>`;
            html += `<td class="modal-mono num">${modal.escapeHtml(height)}</td>`;
            html += `<td class="modal-mono num">${modal.escapeHtml(branchLength)}</td>`;
            html += `<td>${blockHashCell(tip.hash || '', summary.chain)}</td>`;
            html += `<td title="${modal.escapeHtml(fmtDateTime(tip.time))}">${modal.escapeHtml(fmtAge(tip.age_seconds))}</td>`;
            html += '</tr>';
        }
        return html + '</tbody></table></div>';
    }

    function create(options) {
        const getNodeInfo = options.getNodeInfo;
        const getCurrency = options.getCurrency;
        const currencyMeta = options.currencyMeta;
        const formatBytes = options.formatBytes;

        function openRecentBlocks() {
            return modal.openFetched({
                id: 'recent-blocks-modal',
                closeId: 'recent-blocks-close',
                bodyId: 'recent-blocks-body',
                title: 'Recent Blocks',
                maxWidth: 900,
                url: '/api/blocks/recent?limit=25',
                render: data => renderRecentBlocks(data, formatBytes),
                api,
            });
        }

        function openChainTips() {
            return modal.openFetched({
                id: 'chain-tips-modal',
                closeId: 'chain-tips-close',
                bodyId: 'chain-tips-body',
                title: 'Chain Tips',
                maxWidth: 820,
                url: '/api/chain-tips',
                render: renderChainTips,
                api,
            });
        }

        function openNodeInfo() {
            const dialog = modal.open({
                id: 'node-info-modal',
                closeId: 'node-info-close',
                bodyId: 'node-info-body',
                title: 'Node Info',
                maxWidth: 640,
            });
            const info = getNodeInfo();
            let html = '<div class="modal-section-title">Node</div>';
            if (info) {
                const version = info.subversion || '\u2014';
                html += modal.row('Version', version, 'Node-reported user agent string', version);
                html += modal.row('Peers', info.connected != null ? info.connected : '\u2014', 'Total number of connected peers', info.connected != null ? `${info.connected} peers connected` : '');
                if (info.blockchain) {
                    html += modal.row('Size (Disk)', `${info.blockchain.size_gb} GB`, 'Total blockchain data stored on disk');
                    html += modal.row('Node Type', info.blockchain.pruned ? 'Pruned' : 'Full', 'Whether this node stores all blocks (Full) or only recent ones (Pruned)', info.blockchain.pruned ? 'Pruned node \u2014 older blocks deleted to save space' : 'Full node \u2014 all blocks stored');
                    html += modal.row('TX Index', info.blockchain.indexed ? 'Yes' : 'No', 'Transaction index allows looking up any TX by its hash', info.blockchain.indexed ? 'Enabled \u2014 all transactions are indexed' : 'Disabled');
                    const syncValue = info.blockchain.ibd ? 'Syncing (IBD)' : 'Synced';
                    html += modal.row('Status', syncValue, 'Whether the node has finished initial block download', syncValue, info.blockchain.ibd ? 'modal-val-warn' : 'modal-val-ok');
                }
                if (info.last_block) {
                    const time = info.last_block.time ? new Date(info.last_block.time * 1000).toLocaleTimeString() : '';
                    const height = info.last_block.height ? info.last_block.height.toLocaleString() : '\u2014';
                    const display = height + (time ? ` (${time})` : '');
                    html += modal.row('Block Height', display, 'Latest block height seen by this node');
                }
                if (info.mempool_size != null) {
                    html += modal.row('Mempool Size', `${info.mempool_size.toLocaleString()} tx`, 'Number of unconfirmed transactions in the mempool', `${info.mempool_size.toLocaleString()} transactions`);
                }
            } else {
                html += '<div style="color:var(--text-muted);padding:4px 0">No node data yet</div>';
            }
            html += '<div class="modal-section-title">Mempool</div>';
            html += '<div id="ni-mempool-section" style="color:var(--text-muted);padding:4px 0">Loading mempool data...</div>';
            html += '<div class="modal-section-title">Blockchain</div>';
            html += '<div id="ni-blockchain-section" style="color:var(--text-muted);padding:4px 0">Loading blockchain data...</div>';
            dialog.body.innerHTML = html;

            const currency = getCurrency();
            api.getJson(`/api/mempool?currency=${encodeURIComponent(currency)}`, { signal: dialog.signal }).then(data => {
                const section = dialog.overlay.querySelector('#ni-mempool-section');
                if (!section || !dialog.isOpen()) return;
                if (data.error) {
                    section.innerHTML = `<div style="color:var(--err)">${modal.escapeHtml(data.error)}</div>`;
                    return;
                }
                const mempool = data.mempool;
                if (!mempool) {
                    section.innerHTML = '<div style="color:var(--text-muted)">No data</div>';
                    return;
                }
                const price = Number(data.btc_price) || 0;
                let content = '';
                const pending = (mempool.size || 0).toLocaleString();
                content += modal.row('Pending TXs', pending, 'Unconfirmed transactions waiting to be mined', `${pending} transactions`);
                content += modal.row('Data Size', `${((mempool.bytes || 0) / 1e6).toFixed(2)} MB`, 'Raw serialized size of all mempool transactions');
                content += modal.row('Memory Usage', `${((mempool.usage || 0) / 1e6).toFixed(2)} MB`, 'Actual RAM used by the mempool');
                const fees = Number(mempool.total_fee) || 0;
                const meta = currencyMeta[currency] || { symbol: '$', decimals: 2 };
                const fiat = price ? ` (${meta.symbol}${(fees * price).toFixed(meta.decimals)})` : '';
                content += modal.row('Total Fees', `${fees.toFixed(8)} BTC${fiat}`, 'Sum of all fees from pending transactions');
                content += modal.row('Max Size', `${((mempool.maxmempool || 0) / 1e6).toFixed(0)} MB`, 'Maximum allowed mempool size before evicting low-fee transactions');
                if (mempool.mempoolminfee != null) {
                    content += modal.row('Min Accepted Fee', `${(mempool.mempoolminfee * 1e8 / 1000).toFixed(2)} sat/vB`, 'Minimum fee rate to enter the mempool (rises when mempool is full)');
                }
                if (mempool.minrelaytxfee != null) {
                    content += modal.row('Min Relay Fee', `${(mempool.minrelaytxfee * 1e8 / 1000).toFixed(2)} sat/vB`, 'Minimum fee rate for a transaction to be relayed to other nodes');
                }
                if (mempool.fullrbf != null) {
                    content += modal.row('Full RBF', mempool.fullrbf ? 'Enabled' : 'Disabled', 'Replace-by-fee policy \u2014 whether any transaction can be replaced by a higher-fee version', null, mempool.fullrbf ? 'modal-val-ok' : 'modal-val-warn');
                }
                if (mempool.unbroadcastcount != null) {
                    content += modal.row('Unbroadcast TXs', String(mempool.unbroadcastcount), 'Transactions submitted locally but not yet seen relayed back by any peer', `${mempool.unbroadcastcount} transactions`);
                }
                section.innerHTML = content;
            }).catch(error => renderSectionError(dialog, '#ni-mempool-section', error));

            api.getJson('/api/blockchain', { signal: dialog.signal }).then(data => {
                const section = dialog.overlay.querySelector('#ni-blockchain-section');
                if (!section || !dialog.isOpen()) return;
                if (data.error) {
                    section.innerHTML = `<div style="color:var(--err)">${modal.escapeHtml(data.error)}</div>`;
                    return;
                }
                const blockchain = data.blockchain;
                if (!blockchain) {
                    section.innerHTML = '<div style="color:var(--text-muted)">No data</div>';
                    return;
                }
                let content = '';
                content += modal.row('Chain', blockchain.chain || '\u2014', 'Bitcoin network this node is connected to');
                content += modal.row('Block Height', (blockchain.blocks || 0).toLocaleString(), 'Number of validated blocks in the local chain');
                if (blockchain.headers) {
                    const percent = blockchain.blocks && blockchain.headers
                        ? ((blockchain.blocks / blockchain.headers) * 100).toFixed(2)
                        : '100';
                    content += modal.row('Sync Progress', `${blockchain.blocks.toLocaleString()} / ${blockchain.headers.toLocaleString()} (${percent}%)`, 'Validated blocks vs known block headers \u2014 100% means fully synced');
                }
                if (blockchain.bestblockhash) {
                    content += modal.row('Best Block Hash', `${blockchain.bestblockhash.substring(0, 24)}\u2026`, 'Hash of the most recent validated block', blockchain.bestblockhash);
                }
                if (blockchain.difficulty) {
                    content += modal.row('Difficulty', fmtDifficulty(blockchain.difficulty), 'Current mining difficulty \u2014 adjusts every 2,016 blocks', String(blockchain.difficulty));
                }
                if (blockchain.mediantime) {
                    content += modal.row('Median Time', new Date(blockchain.mediantime * 1000).toLocaleString(), 'Median timestamp of the last 11 blocks \u2014 used for time-locked transactions');
                }
                content += modal.row('IBD Status', blockchain.initialblockdownload ? 'Yes' : 'No', 'Initial Block Download \u2014 whether the node is still catching up to the network', null, blockchain.initialblockdownload ? 'modal-val-warn' : 'modal-val-ok');
                if (blockchain.size_on_disk) {
                    content += modal.row('Size on Disk', `${(blockchain.size_on_disk / 1e9).toFixed(1)} GB`, 'Total blockchain data stored on disk');
                }
                content += modal.row('Pruning', blockchain.pruned ? 'Yes' : 'No', 'Whether old blocks are deleted to save disk space', blockchain.pruned ? 'Pruned \u2014 old blocks removed' : 'Not pruned \u2014 all blocks stored');
                if (blockchain.softforks && Object.keys(blockchain.softforks).length) {
                    content += '<div class="modal-section-title" style="margin-top:6px;padding-top:4px">Softforks</div>';
                    for (const [name, softfork] of Object.entries(blockchain.softforks)) {
                        const status = softfork.active ? 'Active' : (softfork.type || 'Defined');
                        content += modal.row(name, status, `Consensus rule upgrade: ${name}`, `${name}: ${status} (${softfork.type || 'bip9'})`, softfork.active ? 'modal-val-ok' : '');
                    }
                }
                section.innerHTML = content;
            }).catch(error => renderSectionError(dialog, '#ni-blockchain-section', error));
            return dialog;
        }

        return Object.freeze({ openNodeInfo, openRecentBlocks, openChainTips });
    }

    function renderSectionError(dialog, selector, error) {
        if (error && error.name === 'AbortError') return;
        const section = dialog.overlay.querySelector(selector);
        if (section && dialog.isOpen()) {
            section.innerHTML = `<div style="color:var(--err)">Error: ${modal.escapeHtml(error.message)}</div>`;
        }
    }

    global.BPMNodeMonitor = Object.freeze({
        create,
        renderRecentBlocks,
        renderChainTips,
    });
})(window);
