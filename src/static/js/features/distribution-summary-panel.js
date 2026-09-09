/* Summary panel markup and provider/peer drill-down lists. */
(function (global) {
    'use strict';

    const escapeHtml = global.BPMModal.escapeHtml;

    function create(options) {
        const elements = options.elements;
        const actions = options.actions;
        const distributionData = global.BPMDistributionData;

        function buildPeerSummaryHtml(matchedPeers, category, label) {
            var html = '';

            // For services category, show full service name expansion at the top
            if (category === 'services' && label && label !== '\u2014') {
                html += '<div class="as-sub-tt-section">';
                var abbrs = label.split(/\s+/);
                for (var ai = 0; ai < abbrs.length; ai++) {
                    var found = false;
                    for (var fk in options.serviceFlags) {
                        if (options.serviceFlags.hasOwnProperty(fk) && options.serviceFlags[fk].abbr === abbrs[ai]) {
                            html += '<div class="as-sub-tt-flag">' + global.BPMModal.escapeHtml(abbrs[ai]) + ' = ' + global.BPMModal.escapeHtml(serviceFlagDescription(options.serviceFlags[fk])) + '</div>';
                            found = true;
                            break;
                        }
                    }
                    if (!found) html += '<div class="as-sub-tt-flag">' + global.BPMModal.escapeHtml(abbrs[ai]) + '</div>';
                }
                html += '</div>';
            }

            // Show first 6 peers, rest hidden behind expandable "+N more (show)"
            var initialShow = 6;
            var hasMore = matchedPeers.length > initialShow;

            html += '<div class="as-sub-tt-scroll">';
            for (var pi = 0; pi < matchedPeers.length; pi++) {
                var p = matchedPeers[pi];
                var ct = p.connection_type || 'unknown';
                var ctLabel = (Object.hasOwn(options.connectionTypeLabels, ct) ? options.connectionTypeLabels[ct] : null) || ct;
                var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
                // Truncate location to keep layout tight
                if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
                var peerAs = distributionData.parseAsNumber(p.as) || '';
                var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
                html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + escapeHtml(p.id) + '" data-as="' + escapeHtml(peerAs) + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
                html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + escapeHtml(p.id) + '">ID\u00a0' + escapeHtml(p.id) + '</span>';
                html += '<span class="as-sub-tt-type">' + escapeHtml(ctLabel) + '</span>';
                if (loc) html += '<span class="as-sub-tt-loc">' + escapeHtml(loc) + '</span>';
                html += '</div>';
            }
            html += '</div>';
            if (hasMore) {
                var remaining = matchedPeers.length - initialShow;
                html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
                html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
            }
            return html;
        }

        function countrySummaryRow(group) {
            var label = (group.countryCode || group.asShort || '') + '  ' + (group.countryName || group.asName || group.asNumber);
            return '<div class="as-detail-sub-row as-country-summary-row" data-as="' + global.BPMModal.escapeHtml(group.asNumber) + '">'
                 + '<span class="as-detail-sub-label">' + global.BPMModal.escapeHtml(label) + '</span>'
                 + '<span class="as-detail-sub-val">' + group.peerCount + 'p / ' + group.percentage.toFixed(0) + '%</span>'
                 + '</div>';
        }

        function summaryInteractiveRow(label, value, catData) {
            var providersJson = global.BPMModal.escapeHtml(JSON.stringify(catData.providers.map(function (prov) {
                return {
                    a: prov.asNumber,
                    n: prov.name,
                    c: prov.color,
                    pc: prov.peerCount,
                    pi: prov.peerIds
                };
            })));
            var peerIdsJson = global.BPMModal.escapeHtml(JSON.stringify(catData.peerIds));
            var safeLabel = global.BPMModal.escapeHtml(label);
            var safeValue = global.BPMModal.escapeHtml(value);
            return '<div class="as-detail-sub-row as-interactive-row as-summary-row" ' +
                'role="button" tabindex="0" aria-label="' + safeLabel + ': ' + safeValue + '" ' +
                'data-peer-ids="' + peerIdsJson + '" data-providers="' + providersJson +
                '" data-cat-label="' + safeLabel + '">' +
                '<span class="as-detail-sub-label">' + safeLabel + '</span>' +
                '<span class="as-detail-sub-val">' + safeValue + '</span></div>';
        }

        function row(label, value) {
            return '<div class="modal-row"><span class="modal-label">' + escapeHtml(label) + '</span><span class="modal-val">' + escapeHtml(value) + '</span></div>';
        }

        function interactiveRow(label, value, peerIds, category) {
            var peerIdsJson = escapeHtml(JSON.stringify(peerIds));
            return '<div class="as-detail-sub-row as-interactive-row" data-peer-ids="' + peerIdsJson + '" data-category="' + escapeHtml(category) + '">'
                 + '<span class="as-detail-sub-label">' + escapeHtml(label) + '</span>'
                 + '<span class="as-detail-sub-val">' + escapeHtml(value) + '</span>'
                 + '</div>';
        }

        function buildProviderListHtml(providers, catLabel, navAsNum) {
            var privateNetMap = { 'Tor': 'onion', 'I2P': 'i2p', 'CJDNS': 'cjdns' };
            var html = '';
            html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
            html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + escapeHtml(catLabel) + '</div>';
            // For private network categories, add link to private network panel
            if (Object.hasOwn(privateNetMap, catLabel)) {
                html += '<div class="as-sub-tt-nav as-private-net-link" data-net="' + privateNetMap[catLabel] + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open ' + escapeHtml(catLabel) + ' Network panel</div>';
            }
            // Optional nav link to open a provider/segment panel
            if (navAsNum) {
                html += '<div class="as-sub-tt-nav as-grid-provider-click" data-as="' + escapeHtml(navAsNum) + '" style="font-size:9px; color:var(--accent); cursor:pointer; margin-top:2px">\u25B6 Open ' + escapeHtml(catLabel) + ' panel</div>';
            }
            // For service flag categories, expand abbreviations to full descriptions
            if (catLabel) {
                var abbrs = catLabel.split(/\s+/);
                for (var ai = 0; ai < abbrs.length; ai++) {
                    for (var fk in options.serviceFlags) {
                        if (options.serviceFlags.hasOwnProperty(fk) && options.serviceFlags[fk].abbr === abbrs[ai]) {
                            html += '<div class="as-sub-tt-flag" style="font-size:10px; color:var(--text-secondary)">' + global.BPMModal.escapeHtml(abbrs[ai]) + ' = ' + global.BPMModal.escapeHtml(serviceFlagDescription(options.serviceFlags[fk])) + '</div>';
                            break;
                        }
                    }
                }
            }
            html += '</div>';

            html += '<div class="as-sub-tt-scroll">';
            for (var i = 0; i < providers.length; i++) {
                var prov = providers[i];
                var peerIdsJson = global.BPMModal.escapeHtml(JSON.stringify(prov.peerIds || prov.pi));
                html += '<div class="as-sub-tt-peer as-provider-row" data-as="' + escapeHtml((prov.asNumber || prov.a)) + '" data-peer-ids="' + peerIdsJson + '">';
                html += '<span class="as-grid-dot" style="background:' + (prov.color || prov.c) + '"></span>';
                html += '<span class="as-sub-tt-id as-provider-click" style="cursor:pointer">' + escapeHtml((prov.asNumber || prov.a)) + '</span>';
                var name = (prov.name || prov.n || '');
                if (name.length > 18) name = name.substring(0, 17) + '\u2026';
                html += '<span class="as-sub-tt-loc" title="' + escapeHtml((prov.name || prov.n || '')) + '">' + escapeHtml(name) + '</span>';
                html += '<span class="as-sub-tt-type">' + (prov.peerCount || prov.pc) + '</span>';
                html += '</div>';
            }
            html += '</div>';
            return html;
        }

        function buildPeerListHtmlForSubSub(peers) {
            var html = '';
            var initialShow = 6;
            var hasMore = peers.length > initialShow;

            html += '<div class="as-sub-tt-scroll">';
            for (var pi = 0; pi < peers.length; pi++) {
                var p = peers[pi];
                var ct = p.connection_type || 'unknown';
                var ctLabel = (Object.hasOwn(options.connectionTypeLabels, ct) ? options.connectionTypeLabels[ct] : null) || ct;
                var loc = (p.city || '') + (p.city && p.country ? ', ' : '') + (p.country || '');
                if (loc.length > 16) loc = loc.substring(0, 15) + '\u2026';
                var peerAs = distributionData.parseAsNumber(p.as) || '';
                var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
                html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + escapeHtml(p.id) + '" data-as="' + escapeHtml(peerAs) + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
                html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + escapeHtml(p.id) + '">ID\u00a0' + escapeHtml(p.id) + '</span>';
                html += '<span class="as-sub-tt-type">' + escapeHtml(ctLabel) + '</span>';
                if (loc) html += '<span class="as-sub-tt-loc">' + escapeHtml(loc) + '</span>';
                html += '</div>';
            }
            html += '</div>';
            if (hasMore) {
                var remaining = peers.length - initialShow;
                html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
                html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
            }
            return html;
        }

        function buildPingPeerListHtml(peers) {
            var html = '';
            var initialShow = 8;
            var hasMore = peers.length > initialShow;

            html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
            html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">Peers \u2014 By Ping</div>';
            html += '</div>';
            html += '<div class="as-sub-tt-scroll">';
            for (var pi = 0; pi < peers.length; pi++) {
                var p = peers[pi];
                var peerAs = distributionData.parseAsNumber(p.as) || '';
                var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
                html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + escapeHtml(p.id) + '" data-as="' + escapeHtml(peerAs) + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
                html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + escapeHtml(p.id) + '">ID\u00a0' + escapeHtml(p.id) + '</span>';
                html += '<span class="as-sub-tt-type">' + (p.ping_ms > 0 ? Math.round(p.ping_ms) + 'ms' : '\u2014') + '</span>';
                var ct = p.connection_type || 'unknown';
                html += '<span class="as-sub-tt-loc">' + escapeHtml(((Object.hasOwn(options.connectionTypeLabels, ct) ? options.connectionTypeLabels[ct] : null) || ct)) + '</span>';
                html += '</div>';
            }
            html += '</div>';
            if (hasMore) {
                var remaining = peers.length - initialShow;
                html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
                html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
            }
            return html;
        }

        function buildDataPeerListHtml(peers, field) {
            var html = '';
            var initialShow = 8;
            var hasMore = peers.length > initialShow;
            var isRecv = field === 'bytesrecv';
            var title = isRecv ? 'Top Peers \u2014 Bytes Received' : 'Top Peers \u2014 Bytes Sent';

            html += '<div class="as-sub-tt-section" style="border-bottom:none; margin-bottom:2px">';
            html += '<div class="as-sub-tt-flag" style="font-weight:700; color:var(--text-primary)">' + title + '</div>';
            html += '</div>';
            html += '<div class="as-sub-tt-scroll">';
            for (var pi = 0; pi < peers.length; pi++) {
                var p = peers[pi];
                var peerAs = distributionData.parseAsNumber(p.as) || '';
                var extraClass = pi >= initialShow ? ' as-sub-tt-peer-extra' : '';
                html += '<div class="as-sub-tt-peer' + extraClass + '" data-peer-id="' + escapeHtml(p.id) + '" data-as="' + escapeHtml(peerAs) + '"' + (pi >= initialShow ? ' style="display:none"' : '') + '>';
                html += '<span class="as-sub-tt-rank">#' + (pi + 1) + '</span>';
                html += '<span class="as-sub-tt-id as-sub-tt-id-link" data-peer-id="' + escapeHtml(p.id) + '">ID\u00a0' + escapeHtml(p.id) + '</span>';
                html += '<span class="as-sub-tt-type">' + distributionData.fmtBytes(p[field]) + '</span>';
                var ct = p.connection_type || 'unknown';
                html += '<span class="as-sub-tt-loc">' + escapeHtml(((Object.hasOwn(options.connectionTypeLabels, ct) ? options.connectionTypeLabels[ct] : null) || ct)) + '</span>';
                html += '</div>';
            }
            html += '</div>';
            if (hasMore) {
                var remaining = peers.length - initialShow;
                html += '<div class="as-sub-tt-more as-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
                html += '<div class="as-sub-tt-more as-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
            }
            return html;
        }

        function serviceFlagDescription(flag) {
            return flag.rpc ? flag.label + ' (' + flag.rpc + ')' : flag.label;
        }

        function renderProvider(data) {
            if (!elements.panel) return;

            // --- Header ---
            var asnEl = elements.panel.querySelector('.as-detail-asn');
            var orgEl = elements.panel.querySelector('.as-detail-org');
            var metaEl = elements.panel.querySelector('.as-detail-meta');
            var barFill = elements.panel.querySelector('.as-detail-bar-fill');
            var pctEl = elements.panel.querySelector('.as-detail-pct');
            var riskEl = elements.panel.querySelector('.as-detail-risk');

            if (asnEl) {
                asnEl.innerHTML = '<span style="color:var(--logo-primary, #4a90d9)">PEER ISP</span><br><span style="color:var(--logo-accent, #7ec8e3)">DISTRIBUTION</span> <span style="color:var(--logo-primary, #4a90d9)">SUMMARY</span>';
                asnEl.classList.add('as-summary-title');
            }
            // Clickable provider count in header (no peer count)
            if (orgEl) {
                orgEl.innerHTML = '<span class="as-panel-link as-all-providers-link" title="View all providers">'
                    + data.uniqueProviders + ' unique providers</span>';
            }

            if (metaEl) {
                metaEl.innerHTML = '<span class="as-detail-type-badge">' + data.quality.word + '</span>';
            }

            // Score bar (distribution score 0-10 → percentage 0-100)
            var scorePct = (data.score / 10) * 100;
            var scoreTooltip = actions.buildScoreTooltip(data.score);
            if (barFill) {
                barFill.style.width = scorePct.toFixed(1) + '%';
                barFill.style.background = data.score >= 8 ? 'var(--ok)' : data.score >= 6 ? 'var(--ok-bright)' : data.score >= 4 ? 'var(--warn)' : 'var(--err)';
            }
            if (pctEl) { pctEl.textContent = 'Score: ' + data.score.toFixed(1) + ' / 10'; pctEl.title = scoreTooltip; }
            if (riskEl) {
                riskEl.className = 'as-detail-risk';
                riskEl.textContent = '';
            }

            // --- Body ---
            var bodyEl = elements.panel.querySelector('.as-detail-body');
            if (!bodyEl) return;

            var html = '';

            // ── Section 1: Score + Insights ──
            html += '<div class="modal-section-title" title="Distribution score based on Herfindahl\u2013Hirschman Index (HHI). Higher score = more evenly distributed peers across providers.">Score &amp; Insights</div>';
            html += '<div class="modal-row"><span class="modal-label" title="' + global.BPMModal.escapeHtml(scoreTooltip) + '">Distribution Score</span><span class="modal-val">' + data.score.toFixed(1) + ' / 10</span></div>';
            html += '<div class="modal-row"><span class="modal-label" title="Quality rating based on the distribution score">Quality</span><span class="modal-val">' + data.quality.word + '</span></div>';
            html += '<div class="modal-row"><span class="modal-label" title="Number of distinct Autonomous Systems (AS/ISPs) your peers connect through">Unique Providers</span>'
                 + '<span class="modal-val as-panel-link as-all-providers-link" title="View all providers">' + data.uniqueProviders + '</span></div>';
            if (data.topProvider) {
                var topName = data.topProvider.asShort || data.topProvider.asNumber;
                html += '<div class="modal-row"><span class="modal-label" title="The AS provider with the most peers connected to your node">Top Provider</span>'
                     + '<span class="modal-val as-panel-link as-navigate-provider" data-as="' + escapeHtml(data.topProvider.asNumber) + '" title="View ' + escapeHtml(topName) + ' panel">'
                     + escapeHtml(topName) + ' (' + data.topProvider.peerCount + ')</span></div>';
            }

            // Dynamic insights — each is a simple label row with hover/click sub-panel
            for (var ii = 0; ii < data.insights.length; ii++) {
                var ins = data.insights[ii];
                html += '<div class="as-summary-insight">';
                html += '<span class="as-insight-icon">' + ins.icon + '</span>';
                if (ins.type === 'stable') {
                    var stablePeerJson = global.BPMModal.escapeHtml(JSON.stringify(ins.peerIds));
                    html += '<span class="as-insight-text as-panel-link as-stable-link" data-as="' + escapeHtml(ins.asNumber) + '" data-peer-ids="' + stablePeerJson + '">Most stable: ' + escapeHtml(ins.provName) + ' (avg ' + escapeHtml(ins.durText) + ')</span>';
                } else if (ins.type === 'fastest') {
                    html += '<span class="as-insight-text as-panel-link as-fastest-link" title="Providers ranked by average ping time">Fastest connection <span style="color:var(--text-muted)">(by rank)</span></span>';
                } else if (ins.type === 'data-providers') {
                    html += '<span class="as-insight-text as-panel-link as-data-providers-link" data-field="' + ins.field + '" title="Providers ranked by total bytes">' + escapeHtml(ins.label) + '</span>';
                } else {
                    html += '<span class="as-insight-text">' + escapeHtml(ins.text) + '</span>';
                }
                html += '</div>';
            }

            // ── Section 2: Connections by Provider (3 rows per provider) ──
            html += '<div class="modal-section-title" title="Inbound and outbound peer connections grouped by AS provider. Click provider name to view its panel, click IN/OUT to see peer lists.">Connections by Provider</div>';
            for (var gi = 0; gi < data.connectionGrid.length; gi++) {
                var gItem = data.connectionGrid[gi];
                var totalJson = global.BPMModal.escapeHtml(JSON.stringify(gItem.totalPeerIds));
                var inJson = global.BPMModal.escapeHtml(JSON.stringify(gItem.inPeerIds));
                var outJson = global.BPMModal.escapeHtml(JSON.stringify(gItem.outPeerIds));
                var outSubJson = global.BPMModal.escapeHtml(JSON.stringify(gItem.outSubtypes));

                if (gItem.isOthers && gItem._othersGroups) {
                    // Others row — 3-level: click shows provider list, then provider → peer list
                    var othersProvJson = global.BPMModal.escapeHtml(JSON.stringify(gItem._othersGroups.map(function (g) {
                        return { a: g.asNumber, n: g.asShort || g.asName || g.asNumber, c: g.color || actions.getColorForAsNum(g.asNumber), pc: g.peerCount, pi: g.peerIds };
                    })));
                    html += '<div class="as-detail-sub-row as-conn-others-row" data-peer-ids="' + totalJson + '" data-providers="' + othersProvJson + '" data-as="' + escapeHtml(gItem.asNumber) + '" style="cursor:pointer">';
                    html += '<span class="as-detail-sub-label"><span class="as-grid-dot" style="background:' + gItem.color + '; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle"></span>';
                    html += '<span style="color:' + gItem.color + '">' + escapeHtml(gItem.name) + '</span></span>';
                    html += '<span class="as-detail-sub-val">' + gItem.totalCount + '</span>';
                    html += '</div>';
                } else {
                    // Provider name row (total) — click pins sub-tooltip, "Open provider panel" link inside navigates
                    html += '<div class="as-detail-sub-row as-conn-prov-row" data-peer-ids="' + totalJson + '" data-as="' + escapeHtml(gItem.asNumber) + '" style="cursor:pointer">';
                    html += '<span class="as-detail-sub-label"><span class="as-grid-dot" style="background:' + gItem.color + '; display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle"></span>';
                    html += '<span style="color:' + gItem.color + '">' + escapeHtml(gItem.name) + '</span></span>';
                    html += '<span class="as-detail-sub-val">' + gItem.totalCount + '</span>';
                    html += '</div>';
                }
                // In row
                if (gItem.inCount > 0) {
                    html += '<div class="as-detail-sub-row as-interactive-row as-conn-dir-row" data-peer-ids="' + inJson + '" data-as="' + escapeHtml(gItem.asNumber) + '" data-category="conntype" style="padding-left:22px">';
                    html += '<span class="as-detail-sub-label">In</span>';
                    html += '<span class="as-detail-sub-val">' + gItem.inCount + '</span>';
                    html += '</div>';
                }
                // Out row
                if (gItem.outCount > 0) {
                    html += '<div class="as-detail-sub-row as-conn-out-row" data-peer-ids="' + outJson + '" data-as="' + escapeHtml(gItem.asNumber) + '" data-out-subtypes="' + outSubJson + '" data-category="conntype" style="padding-left:22px; cursor:pointer">';
                    html += '<span class="as-detail-sub-label">Out</span>';
                    html += '<span class="as-detail-sub-val">' + gItem.outCount + '</span>';
                    html += '</div>';
                }
            }

            // ── Section 3: Networks ──
            html += '<div class="modal-section-title" title="Peer connections grouped by network protocol. IPv4/IPv6 are clearnet, Tor/I2P/CJDNS are anonymous overlay networks.">Networks</div>';
            for (var ni = 0; ni < data.networks.length; ni++) {
                var net = data.networks[ni];
                html += summaryInteractiveRow(net.label, net.peerCount + 'p / ' + net.providerCount + 'prov', net);
            }
            // "Private Networks" link at bottom of Networks section
            html += '<div class="as-detail-sub-row as-interactive-row as-show-private-nets" style="cursor:pointer" title="Close the public network panel and switch to the Private Networks panel (Tor, I2P, CJDNS)">';
            html += '<span class="as-detail-sub-label">* Private Networks</span>';
            html += '</div>';

            // ── Section 4: Hosting ──
            html += '<div class="modal-section-title" title="Peer connections grouped by hosting type. Cloud/Hosting = datacenter, Residential = home ISP, Proxy/VPN = anonymizing relay, Mobile = cellular.">Hosting</div>';
            for (var hi = 0; hi < data.hosting.length; hi++) {
                var host = data.hosting[hi];
                html += summaryInteractiveRow(host.label, host.peerCount + 'p / ' + host.providerCount + 'prov', host);
            }

            // ── Section 5: Countries ──
            html += '<div class="modal-section-title" title="Geographic distribution of peers by country, with provider count showing how many distinct AS providers operate in each country.">Countries</div>';
            for (var ci = 0; ci < data.countries.length; ci++) {
                var country = data.countries[ci];
                html += summaryInteractiveRow(country.label, country.peerCount + 'p / ' + country.providerCount + 'prov', country);
            }

            // ── Section 6: Software ──
            html += '<div class="modal-section-title" title="Bitcoin Core client versions running on your peers, grouped by user agent string. Multiple versions is healthy for network resilience.">Software</div>';
            for (var si = 0; si < data.software.length; si++) {
                var sw = data.software[si];
                html += summaryInteractiveRow(sw.label, sw.peerCount + 'p / ' + sw.providerCount + 'prov', sw);
            }

            // ── Section 7: Services ──
            html += '<div class="modal-section-title" title="Service flag combinations advertised by peers. N=Full Chain, W=SegWit, NL=Pruned, P=BIP324 v2, CF=Compact Filters, B=Bloom.">Services</div>';
            for (var svi = 0; svi < data.services.length; svi++) {
                var svc = data.services[svi];
                html += summaryInteractiveRow(svc.label, svc.peerCount + 'p / ' + svc.providerCount + 'prov', svc);
            }

            bodyEl.innerHTML = html;
            bodyEl.scrollTop = 0;

            // Show panel
            elements.panel.classList.remove('hidden');
            void elements.panel.offsetWidth;
            elements.panel.classList.add('visible');
            document.body.classList.add('as-panel-open');
            document.body.classList.add('panel-focus-as');
            document.body.classList.remove('panel-focus-peers');
            return bodyEl;
        }

        function renderCountry(data) {
            if (!elements.panel) return;

            var asnEl = elements.panel.querySelector('.as-detail-asn');
            var orgEl = elements.panel.querySelector('.as-detail-org');
            var metaEl = elements.panel.querySelector('.as-detail-meta');
            var barFill = elements.panel.querySelector('.as-detail-bar-fill');
            var pctEl = elements.panel.querySelector('.as-detail-pct');
            var riskEl = elements.panel.querySelector('.as-detail-risk');

            if (asnEl) {
                asnEl.innerHTML = '<span style="color:var(--logo-primary, #4a90d9)">PEER COUNTRY</span><br><span style="color:var(--logo-accent, #7ec8e3)">DISTRIBUTION</span> <span style="color:var(--logo-primary, #4a90d9)">SUMMARY</span>';
                asnEl.classList.add('as-summary-title');
            }
            if (orgEl) {
                orgEl.textContent = data.uniqueCountries + ' countries / territories';
            }
            if (metaEl) {
                metaEl.innerHTML = '<span class="as-detail-type-badge">' + data.quality.word + '</span>';
            }
            var scorePct = (data.score / 10) * 100;
            if (barFill) {
                barFill.style.width = scorePct.toFixed(1) + '%';
                barFill.style.background = data.score >= 8 ? 'var(--ok)' : data.score >= 6 ? 'var(--ok-bright)' : data.score >= 4 ? 'var(--warn)' : 'var(--err)';
            }
            if (pctEl) {
                pctEl.textContent = 'Score: ' + data.score.toFixed(1) + ' / 10';
                pctEl.title = actions.buildActiveScoreTooltip(data.score);
            }
            if (riskEl) {
                riskEl.className = 'as-detail-risk';
                riskEl.textContent = '';
            }

            var bodyEl = elements.panel.querySelector('.as-detail-body');
            if (!bodyEl) return;

            var html = '';
            html += '<div class="modal-section-title" title="Distribution score based on Herfindahl-Hirschman Index (HHI). Higher score = more evenly distributed peers across countries and territories.">Score &amp; Concentration</div>';
            html += row('Jurisdiction Score', data.score.toFixed(1) + ' / 10');
            html += row('Quality', data.quality.word);
            html += row('Geolocated Peers', data.totalPeers);
            html += row('Countries', data.uniqueCountries);
            if (data.topCountry) {
                var topLabel = (data.topCountry.countryCode || data.topCountry.asShort || '') + '  ' + (data.topCountry.countryName || data.topCountry.asName);
                html += row('Top Country', topLabel + ' (' + data.topCountry.peerCount + ')');
            }

            html += '<div class="modal-section-title" title="Click a country to inspect the providers, connection types, software, and services behind that slice.">Countries &amp; Territories</div>';
            if (data.countries.length === 0) {
                html += '<div class="pn-panel-empty">No country data available</div>';
            } else {
                for (var ci = 0; ci < data.countries.length; ci++) {
                    html += countrySummaryRow(data.countries[ci]);
                }
            }

            bodyEl.innerHTML = html;
            bodyEl.scrollTop = 0;

            elements.panel.classList.remove('hidden');
            void elements.panel.offsetWidth;
            elements.panel.classList.add('visible');
            document.body.classList.add('as-panel-open');
            document.body.classList.add('panel-focus-as');
            document.body.classList.remove('panel-focus-peers');
            return bodyEl;
        }

        return Object.freeze({
            buildPeerSummaryHtml,
            summaryInteractiveRow,
            row,
            interactiveRow,
            buildProviderListHtml,
            buildPeerListHtmlForSubSub,
            buildPingPeerListHtml,
            buildDataPeerListHtml,
            renderProvider,
            renderCountry,
        });
    }

    global.BPMDistributionSummaryPanel = Object.freeze({ create });
})(window);
