/* Donut SVG, center, legend, animation, and insight-rectangle rendering. */
(function (global) {
    'use strict';

    const distributionData = global.BPMDistributionData;
    const escapeHtml = global.BPMModal.escapeHtml;

    function describeArc(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
        const sweep = endAngle - startAngle;
        const actualEnd = sweep >= 2 * Math.PI
            ? startAngle + 2 * Math.PI - 0.001
            : endAngle;
        const largeArc = sweep > Math.PI ? 1 : 0;
        const outerStartX = cx + outerRadius * Math.cos(startAngle);
        const outerStartY = cy + outerRadius * Math.sin(startAngle);
        const outerEndX = cx + outerRadius * Math.cos(actualEnd);
        const outerEndY = cy + outerRadius * Math.sin(actualEnd);
        const innerStartX = cx + innerRadius * Math.cos(actualEnd);
        const innerStartY = cy + innerRadius * Math.sin(actualEnd);
        const innerEndX = cx + innerRadius * Math.cos(startAngle);
        const innerEndY = cy + innerRadius * Math.sin(startAngle);
        return [
            'M ' + outerStartX + ' ' + outerStartY,
            'A ' + outerRadius + ' ' + outerRadius + ' 0 ' + largeArc + ' 1 ' +
                outerEndX + ' ' + outerEndY,
            'L ' + innerStartX + ' ' + innerStartY,
            'A ' + innerRadius + ' ' + innerRadius + ' 0 ' + largeArc + ' 0 ' +
                innerEndX + ' ' + innerEndY,
            'Z',
        ].join(' ');
    }

    function eased(progress) {
        return progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    }

    function buildDonutSvg(options) {
        const segments = options.segments || [];
        const totalPeers = options.totalPeers || 0;
        const size = options.size;
        const radius = options.radius;
        const width = options.width;
        const selectedWidth = options.selectedWidth;
        const dimmedWidth = options.dimmedWidth;
        const expandedRatio = options.expandedRatio;
        const selectedProvider = options.selectedProvider;
        const animation = options.animation || { state: 'idle', target: null, progress: 0 };
        const innerRadius = radius - width;
        const center = size / 2;
        const gap = 0.03;
        let html = '<defs>' +
            '<filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">' +
            '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" ' +
            'flood-opacity="0.55"/></filter>' +
            '<filter id="donut-inner-shadow" x="-10%" y="-10%" width="120%" height="120%">' +
            '<feGaussianBlur in="SourceAlpha" stdDeviation="3" result="shadow"/>' +
            '<feOffset dx="0" dy="2" result="shadow-offset"/>' +
            '<feComposite in="SourceGraphic" in2="shadow-offset" operator="over"/></filter>' +
            '<linearGradient id="donut-highlight" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>' +
            '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>' +
            '<stop offset="100%" stop-color="rgba(0,0,0,0.12)"/>' +
            '</linearGradient></defs>';
        html += '<circle cx="' + center + '" cy="' + center + '" r="' +
            (radius - width / 2) + '" fill="none" stroke="rgba(88,166,255,0.04)" ' +
            'stroke-width="' + width + '" />';
        html += '<circle cx="' + center + '" cy="' + center + '" r="' +
            (radius + 3) + '" fill="none" stroke="rgba(88,166,255,0.08)" stroke-width="1" />';
        html += '<circle cx="' + center + '" cy="' + center + '" r="' +
            (innerRadius - 3) + '" fill="none" stroke="rgba(88,166,255,0.06)" ' +
            'stroke-width="0.5" />';

        if (!segments.length) {
            return html + '<circle cx="' + center + '" cy="' + center + '" r="' +
                (radius - width / 2) + '" fill="none" stroke="#2d333b" stroke-width="' +
                width + '" opacity="0.5" />';
        }
        if (segments.length === 1) {
            const segment = segments[0];
            const singleLabel = (segment.asShort || segment.asName || segment.asNumber) +
                ', ' + segment.peerCount + ' peers';
            return html + '<circle cx="' + center + '" cy="' + center + '" r="' +
                (radius - width / 2) + '" fill="none" stroke="' + escapeHtml(segment.color) +
                '" stroke-width="' + width + '" class="as-donut-segment" data-as="' +
                escapeHtml(segment.asNumber) + '" filter="url(#donut-shadow)" tabindex="0" ' +
                'role="button" aria-label="' + escapeHtml(singleLabel) + '" />';
        }

        const available = 2 * Math.PI - gap * segments.length;
        const normalSweeps = segments.map(segment => (
            totalPeers > 0 ? segment.peerCount / totalPeers * available : 0
        ));
        let sweeps = normalSweeps.slice();
        const animating = animation.state !== 'idle' && !!animation.target;
        if (animating) {
            const targetIndex = segments.findIndex(segment => segment.asNumber === animation.target);
            const expandedSweeps = normalSweeps.slice();
            if (targetIndex >= 0) {
                const expandedSweep = available * expandedRatio;
                const remaining = available - expandedSweep;
                const otherTotal = totalPeers - segments[targetIndex].peerCount;
                for (let index = 0; index < segments.length; index += 1) {
                    expandedSweeps[index] = index === targetIndex
                        ? expandedSweep
                        : (otherTotal > 0
                            ? segments[index].peerCount / otherTotal
                            : 1 / (segments.length - 1)) * remaining;
                }
            }
            let progress = animation.state === 'reverting'
                ? 1 - animation.progress
                : animation.progress;
            progress = eased(progress);
            sweeps = normalSweeps.map((sweep, index) => (
                sweep + (expandedSweeps[index] - sweep) * progress
            ));
        }

        const order = [];
        let targetIndex = -1;
        if (animating) {
            segments.forEach((segment, index) => {
                if (segment.asNumber === animation.target) targetIndex = index;
                else order.push(index);
            });
            if (targetIndex >= 0) order.push(targetIndex);
        } else {
            segments.forEach((segment, index) => order.push(index));
        }

        let angle = -Math.PI / 2;
        const angles = [];
        for (const index of order) {
            const sweep = sweeps[index];
            if (sweep <= 0) {
                angles[index] = { start: angle, end: angle };
                continue;
            }
            angles[index] = { start: angle + gap / 2, end: angle + sweep + gap / 2 };
            angle += sweep + gap;
        }

        let animationProgress = 0;
        if (animating) {
            animationProgress = animation.state === 'reverting'
                ? 1 - animation.progress
                : animation.progress;
            animationProgress = eased(animationProgress);
        }
        const widths = segments.map(segment => {
            if (!animationProgress || !animation.target) return width;
            return segment.asNumber === animation.target
                ? width + (selectedWidth - width) * animationProgress
                : width + (dimmedWidth - width) * animationProgress;
        });

        html += '<g filter="url(#donut-shadow)">';
        segments.forEach((segment, index) => {
            if (!angles[index] || sweeps[index] <= 0) return;
            const segmentWidth = widths[index];
            const outerRadius = radius - (width - segmentWidth) / 2;
            const path = describeArc(
                center,
                center,
                outerRadius,
                outerRadius - segmentWidth,
                angles[index].start,
                angles[index].end
            );
            const classes = ['as-donut-segment'];
            if (selectedProvider && selectedProvider !== segment.asNumber) classes.push('dimmed');
            if (selectedProvider === segment.asNumber) classes.push('selected');
            const segmentLabel = (segment.asShort || segment.asName || segment.asNumber) +
                ', ' + segment.peerCount + ' peers';
            html += '<path d="' + path + '" fill="' + escapeHtml(segment.color) +
                '" class="' + classes.join(' ') + '" data-as="' +
                escapeHtml(segment.asNumber) + '" tabindex="0" role="button" aria-label="' +
                escapeHtml(segmentLabel) + '" />';
        });
        return html + '</g><circle cx="' + center + '" cy="' + center + '" r="' +
            (radius - width / 2) + '" fill="none" stroke="url(#donut-highlight)" ' +
            'stroke-width="' + width + '" pointer-events="none" />';
    }

    function getQuality(score) {
        if (score >= 8) return { word: 'Excellent', cls: 'q-excellent' };
        if (score >= 6) return { word: 'Good', cls: 'q-good' };
        if (score >= 4) return { word: 'Moderate', cls: 'q-moderate' };
        if (score >= 2) return { word: 'Poor', cls: 'q-poor' };
        return { word: 'Critical', cls: 'q-critical' };
    }

    function buildScoreTooltip(score) {
        const quality = getQuality(score);
        return 'Distribution Score: ' + score.toFixed(1) + '/10 (' + quality.word + ')\n' +
            'Based on Herfindahl–Hirschman Index (HHI)\n' +
            'Higher = more evenly distributed peers across providers';
    }

    function formatNameForDonut(name) {
        if (!name) return '';
        if (name.length <= 12) return name;
        const delimiter = name.includes('-') ? '-' : (name.includes(' ') ? ' ' : null);
        if (!delimiter) return name.length > 16 ? name.substring(0, 15) + '…' : name;
        const limit = delimiter === '-' ? 12 : 14;
        const parts = name.split(delimiter);
        const lines = [];
        let current = parts[0];
        for (let index = 1; index < parts.length; index += 1) {
            if ((current + delimiter + parts[index]).length <= limit) {
                current += delimiter + parts[index];
            } else {
                lines.push(current);
                current = parts[index];
            }
        }
        lines.push(current);
        return lines.join('\n');
    }

    function legendItem(segment, className, totalPeers, color) {
        const displayName = segment.isOthers
            ? segment.asName
            : (segment.asShort || segment.asName || segment.asNumber);
        const shortName = displayName.length > 18
            ? displayName.substring(0, 17) + '…'
            : displayName;
        const percentage = segment.percentage == null
            ? (totalPeers > 0 ? segment.peerCount / totalPeers * 100 : 0)
            : segment.percentage;
        const itemLabel = displayName + ', ' + segment.peerCount + ' peers, ' +
            percentage.toFixed(0) + ' percent';
        return '<div class="as-legend-item' + (className ? ' ' + className : '') +
            '" data-as="' + escapeHtml(segment.asNumber) + '" role="button" tabindex="0" ' +
            'aria-label="' + escapeHtml(itemLabel) + '">' +
            '<span class="as-legend-dot" style="background:' + escapeHtml(color || segment.color) +
            '"></span><span class="as-legend-name" title="' + escapeHtml(displayName) + '">' +
            escapeHtml(shortName) + '</span><span class="as-legend-count">' +
            escapeHtml(segment.peerCount) + '</span><span class="as-legend-pct">' +
            percentage.toFixed(0) + '%</span></div>';
    }

    function buildLegendHtml(options) {
        const segments = options.segments || [];
        const groups = options.groups || [];
        const totalPeers = options.totalPeers || 0;
        const focusProvider = options.focusProvider;
        const selectedProvider = options.selectedProvider;
        const findItem = provider => (
            segments.find(segment => segment.asNumber === provider) ||
            groups.find(group => group.asNumber === provider)
        );
        if (focusProvider) {
            const item = findItem(focusProvider);
            return item
                ? legendItem(item, 'highlighted', totalPeers, options.getColor(focusProvider))
                : '';
        }
        if (selectedProvider) {
            const item = findItem(selectedProvider);
            return item
                ? legendItem(item, 'selected', totalPeers, options.getColor(selectedProvider))
                : '';
        }
        let html = '<div class="as-legend-header">TOP ' +
            Math.min(options.maxSegments, segments.length) + ' ' +
            (options.countryLens ? 'COUNTRIES' : 'PROVIDERS') + '</div>';
        for (const segment of segments) html += legendItem(segment, '', totalPeers);
        return html;
    }

    function insightPresentation(type, data) {
        const peerIds = data.peerIds || [];
        const peers = data.peers || [];
        const presentation = {
            icon: '',
            title: '',
            providerName: data.provName || '',
            metadata: '',
            statistic: '',
            rank: data.rank ? 'Rank #' + data.rank : '',
            color: data.color || '#d29922',
        };
        if (type === 'stable') {
            presentation.icon = '⏳';
            presentation.title = 'Most Stable Network';
            presentation.metadata = peerIds.length + ' peer' + (peerIds.length !== 1 ? 's' : '') +
                ' · ' + (data.asNumber || '');
            presentation.statistic = 'avg ' + (data.durText || '');
        } else if (type === 'fastest') {
            presentation.icon = '⚡';
            presentation.title = 'Fastest Connection';
            presentation.metadata = peerIds.length + ' peer' + (peerIds.length !== 1 ? 's' : '') +
                ' · ' + (data.asNumber || '');
            presentation.statistic = data.avgPing ? data.avgPing.toFixed(1) + ' ms avg' : '';
        } else {
            presentation.icon = type === 'data-bytessent' ? '⬆️' : '⬇️';
            presentation.title = type === 'data-bytessent' ? 'Most Data Sent To' : 'Most Data Recv By';
            presentation.metadata = peers.length + ' peer' + (peers.length !== 1 ? 's' : '') +
                ' · ' + (data.asNumber || '');
            presentation.statistic = distributionData.fmtBytes(data.totalBytes || 0);
        }
        return presentation;
    }

    function buildInsightHtml(type, data) {
        const presentation = insightPresentation(type, data);
        return '<div class="as-insight-rect-inner"><div class="as-insight-rect-badge">' +
            'Score &amp; Insights</div><button type="button" class="as-insight-rect-close" ' +
            'title="Back" aria-label="Back to distribution summary">←</button>' +
            '<div class="as-insight-rect-content"><div class="as-insight-rect-icon">' +
            presentation.icon + '</div><div class="as-insight-rect-title">' +
            escapeHtml(presentation.title) + '</div>' +
            (presentation.rank
                ? '<div class="as-insight-rect-rank" style="color:#d4a017">' +
                    escapeHtml(presentation.rank) + '</div>'
                : '') +
            '<div class="as-insight-rect-provider" style="color:' +
            escapeHtml(presentation.color) + '" title="' +
            escapeHtml(presentation.providerName) + '">' +
            escapeHtml(presentation.providerName) + '</div><div class="as-insight-rect-meta">' +
            escapeHtml(presentation.metadata) + '</div>' +
            (presentation.statistic
                ? '<div class="as-insight-rect-stat" style="color:' +
                    escapeHtml(presentation.color) + '">' +
                    escapeHtml(presentation.statistic) + '</div>'
                : '') +
            '</div><div class="as-insight-rect-origin" style="background:' +
            escapeHtml(presentation.color) + ';border-color:' +
            escapeHtml(presentation.color) + '"></div></div>';
    }

    function create(options) {
        const state = options.state;
        const config = Object.assign({
            size: 260,
            radius: 116,
            width: 28,
            selectedWidth: 40,
            dimmedWidth: 14,
            expandedRatio: 0.70,
            duration: 400,
            maxSegments: 8,
        }, options.config || {});
        let elements = {};
        let hasRendered = false;
        let insightVisible = false;
        let animationFrame = null;
        let safetyTimer = null;
        let animation = { state: 'idle', target: null, progress: 0, startedAt: 0 };

        function init(nextElements) {
            elements = Object.assign({}, nextElements);
        }

        function bindSegmentEvents(root) {
            if (!root) return;
            root.querySelectorAll('.as-donut-segment, .as-legend-item').forEach(element => {
                element.addEventListener('mouseenter', options.onSegmentHover);
                element.addEventListener('mouseleave', options.onSegmentLeave);
                element.addEventListener('click', options.onSegmentClick);
                element.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    options.onSegmentClick(event);
                });
            });
        }

        function renderDonut() {
            if (!elements.svg) return;
            const view = options.getView();
            elements.svg.innerHTML = buildDonutSvg(Object.assign({}, config, {
                segments: view.segments,
                totalPeers: view.totalPeers,
                selectedProvider: state.selectedProvider,
                animation,
            }));
            if (view.segments.length && elements.loading) {
                elements.loading.style.display = 'none';
                hasRendered = true;
            }
            bindSegmentEvents(elements.svg);
        }

        function animationStep(now) {
            animation.progress = Math.min(1, (now - animation.startedAt) / config.duration);
            renderDonut();
            if (animation.progress < 1) {
                animationFrame = global.requestAnimationFrame(animationStep);
                return;
            }
            animationFrame = null;
            if (animation.state === 'expanding') {
                animation.state = 'expanded';
                animation.progress = 1;
            } else if (animation.state === 'reverting') {
                animation = { state: 'idle', target: null, progress: 0, startedAt: 0 };
                renderDonut();
            }
        }

        function clearAnimationHandles() {
            if (animationFrame) global.cancelAnimationFrame(animationFrame);
            if (safetyTimer) global.clearTimeout(safetyTimer);
            animationFrame = null;
            safetyTimer = null;
        }

        function animateExpand(provider) {
            if (animation.state === 'expanded' && animation.target === provider) {
                renderDonut();
                return;
            }
            clearAnimationHandles();
            animation = {
                state: 'expanding',
                target: provider,
                progress: 0,
                startedAt: global.performance.now(),
            };
            animationFrame = global.requestAnimationFrame(animationStep);
            safetyTimer = global.setTimeout(() => {
                if (animation.state !== 'expanding') return;
                animation.state = 'expanded';
                animation.progress = 1;
                animationFrame = null;
                safetyTimer = null;
                renderDonut();
            }, config.duration + 200);
        }

        function animateRevert() {
            clearAnimationHandles();
            animation = {
                state: 'reverting',
                target: animation.target,
                progress: 0,
                startedAt: global.performance.now(),
            };
            animationFrame = global.requestAnimationFrame(animationStep);
            safetyTimer = global.setTimeout(() => {
                if (animation.state !== 'reverting') return;
                animation = { state: 'idle', target: null, progress: 0, startedAt: 0 };
                animationFrame = null;
                safetyTimer = null;
                renderDonut();
            }, config.duration + 200);
        }

        function stopAnimation() {
            clearAnimationHandles();
            animation = { state: 'idle', target: null, progress: 0, startedAt: 0 };
        }

        function renderLegend() {
            if (!elements.legend) return;
            const view = options.getView();
            const focusProvider = state.legendFocusProvider || (
                state.summarySelected && state.subSubTooltipPinned
                    ? state.subSubFilterProvider
                    : null
            );
            elements.legend.innerHTML = buildLegendHtml({
                segments: view.segments,
                groups: view.groups,
                totalPeers: view.totalPeers,
                countryLens: view.countryLens,
                maxSegments: config.maxSegments,
                focusProvider,
                selectedProvider: state.selectedProvider,
                getColor: options.getColor,
            });
            bindSegmentEvents(elements.legend);
        }

        function centerParts() {
            if (!elements.center) return null;
            return {
                distribution: elements.center.querySelector('.as-score-distribution'),
                heading: elements.center.querySelector('.as-score-heading'),
                value: elements.center.querySelector('.as-score-value'),
                quality: elements.center.querySelector('.as-score-quality'),
                label: elements.center.querySelector('.as-score-label'),
            };
        }

        function renderFilterCenter(peerCount, label, totalPeers) {
            const parts = centerParts();
            if (!parts) return;
            if (parts.distribution) parts.distribution.style.display = 'none';
            if (parts.heading) {
                parts.heading.textContent = peerCount + ' PEER' + (peerCount !== 1 ? 'S' : '');
                parts.heading.style.color = 'var(--accent)';
                parts.heading.style.display = '';
            }
            if (parts.value) {
                parts.value.textContent = label;
                parts.value.className = 'as-score-value as-selected-mode';
                parts.value.style.color = 'var(--text-primary)';
                parts.value.title = label + ' — ' + peerCount + ' peers';
            }
            if (parts.quality) {
                const percentage = totalPeers > 0 ? peerCount / totalPeers * 100 : 0;
                parts.quality.textContent = percentage.toFixed(1) + '% of peers';
                parts.quality.className = 'as-score-quality';
                parts.quality.style.color = 'var(--text-secondary)';
            }
            if (parts.label) parts.label.textContent = '';
        }

        function renderNetworkCenter(network, peerCount, totalPeers) {
            const label = network === 'ipv4' ? 'IPv4' : 'IPv6';
            const color = network === 'ipv4'
                ? 'var(--net-ipv4, #e3b341)'
                : 'var(--net-ipv6, #f07178)';
            renderFilterCenter(peerCount, label, totalPeers);
            const parts = centerParts();
            if (!parts || !parts.value) return;
            parts.value.style.color = color;
            parts.value.title = label + ' Network — ' + peerCount + ' peers';
        }

        function setProviderCenter(segment, settings) {
            const parts = centerParts();
            if (!parts || !segment) return;
            const opts = Object.assign({
                focused: false,
                legendHover: false,
                isSubProvider: false,
                countryLens: false,
                entityKind: 'ISP',
                rank: 0,
                onBack: null,
            }, settings || {});
            if (opts.legendHover && elements.center) {
                elements.center.classList.add('legend-hover-active');
            }
            if (parts.distribution) {
                if (opts.isSubProvider && opts.focused) {
                    parts.distribution.innerHTML = '<span class="as-others-back-link">← Others</span>';
                    parts.distribution.style.color = '';
                } else if (opts.legendHover) {
                    parts.distribution.textContent = segment.isOthers
                        ? 'Bucket:'
                        : 'Rank #' + opts.rank;
                    parts.distribution.style.color = '#d4a017';
                } else {
                    parts.distribution.textContent = segment.isOthers ? 'Bucket:' : opts.entityKind;
                    parts.distribution.style.color = 'var(--logo-primary)';
                }
                parts.distribution.style.display = '';
            }
            if (parts.heading) {
                parts.heading.textContent = opts.legendHover && !segment.isOthers
                    ? opts.entityKind
                    : '';
                parts.heading.style.color = opts.legendHover ? 'var(--logo-primary)' : '';
                parts.heading.style.display = opts.legendHover && !segment.isOthers ? '' : 'none';
            }
            const name = segment.isOthers
                ? 'Others'
                : (segment.asShort || segment.asName || segment.asNumber);
            let displayName = opts.focused || opts.legendHover
                ? formatNameForDonut(name)
                : name;
            if (!opts.focused && !opts.legendHover && displayName.length > 14) {
                displayName = displayName.substring(0, 13) + '…';
            }
            if (parts.value) {
                parts.value.textContent = displayName;
                parts.value.className = 'as-score-value ' + (
                    opts.legendHover
                        ? 'as-legend-hover-provider'
                        : (opts.focused ? 'as-focused-provider' : 'as-selected-mode')
                );
                parts.value.style.color = segment.color;
                parts.value.title = (segment.asName || segment.asNumber) + '\n' +
                    segment.peerCount + ' peers (' + segment.percentage.toFixed(1) + '%)';
            }
            if (parts.quality) {
                parts.quality.textContent = segment.asNumber === 'Others'
                    ? (opts.focused || opts.legendHover ? (segment.asName || '') : '')
                    : (opts.countryLens ? (segment.countryCode || '') : segment.asNumber);
                parts.quality.className = 'as-score-quality';
                parts.quality.style.color = segment.color;
            }
            if (parts.label) {
                parts.label.textContent = segment.peerCount + ' PEER' +
                    (segment.peerCount !== 1 ? 'S' : '');
                parts.label.className = 'as-score-label as-provider-peers';
                parts.label.style.color = '';
                parts.label.classList.remove('as-summary-link');
            }
            const backLink = elements.center && elements.center.querySelector('.as-others-back-link');
            if (backLink && opts.onBack) {
                backLink.addEventListener('click', event => {
                    event.stopPropagation();
                    opts.onBack();
                });
            }
        }

        function renderSelectedCenter(segment, settings) {
            const opts = settings || {};
            setProviderCenter(segment, Object.assign({}, opts, { focused: !!opts.focused }));
        }

        function renderProviderCenter(segment, settings) {
            setProviderCenter(segment, Object.assign({}, settings, { focused: true }));
        }

        function renderLegendHoverCenter(segment, settings) {
            setProviderCenter(segment, Object.assign({}, settings, { legendHover: true }));
        }

        function renderScoreCenter(score, totalPeers, settings) {
            const parts = centerParts();
            if (!parts || !parts.value || !parts.label) return;
            const opts = Object.assign({ countryLens: false, tooltip: '' }, settings || {});
            parts.value.className = 'as-score-value';
            parts.value.style.color = '';
            if (parts.distribution) {
                parts.distribution.textContent = 'DISTRIBUTION';
                parts.distribution.style.display = '';
                parts.distribution.style.color = '';
            }
            if (parts.heading) {
                parts.heading.style.color = '';
                parts.heading.style.display = '';
            }
            if (parts.quality) parts.quality.style.color = '';
            parts.label.className = 'as-score-label';
            parts.label.style.color = '';

            if (totalPeers === 0) {
                if (parts.distribution) parts.distribution.style.display = 'none';
                if (parts.heading) parts.heading.textContent = '';
                if (parts.quality) {
                    parts.quality.textContent = '';
                    parts.quality.className = 'as-score-quality q-nodata';
                }
                parts.value.textContent = '—';
                parts.value.title = opts.countryLens
                    ? 'No country data available for public peers'
                    : 'No AS data available — all peers are on private or anonymous networks';
                parts.label.textContent = 'NO DATA';
                parts.label.classList.remove('as-summary-link');
                return;
            }

            const quality = getQuality(score);
            if (parts.heading) parts.heading.textContent = 'SCORE:';
            parts.value.textContent = score.toFixed(1);
            parts.value.title = opts.tooltip || buildScoreTooltip(score);
            parts.value.classList.remove(
                'as-score-excellent',
                'as-score-good',
                'as-score-moderate',
                'as-score-poor',
                'as-score-critical'
            );
            parts.value.classList.add('as-score-' + quality.cls.substring(2));
            if (parts.quality) {
                parts.quality.textContent = quality.word;
                parts.quality.className = 'as-score-quality ' + quality.cls;
            }
            parts.label.textContent = '';
            parts.label.classList.remove('as-summary-link');
            parts.label.classList.remove('as-summary-active');
        }

        function renderPeerCenter(peer, color) {
            const parts = centerParts();
            if (!parts) return;
            if (parts.distribution) parts.distribution.style.display = 'none';
            if (parts.heading) {
                parts.heading.textContent = 'PEER #' + peer.id;
                parts.heading.style.color = color;
                parts.heading.style.display = '';
            }
            if (parts.value) {
                const providerName = peer.asname || distributionData.parseAsOrg(peer.as) || '';
                parts.value.textContent = formatNameForDonut(providerName);
                parts.value.className = 'as-score-value as-focused-provider';
                parts.value.style.color = color;
            }
            if (parts.quality) {
                parts.quality.textContent = distributionData.parseAsNumber(peer.as) || '';
                parts.quality.className = 'as-score-quality';
                parts.quality.style.color = color;
            }
            if (parts.label) {
                parts.label.textContent = '';
                parts.label.classList.remove('as-summary-link');
            }
        }

        function clearLegendHover() {
            if (elements.center) elements.center.classList.remove('legend-hover-active');
        }

        function showInsight(type, data) {
            if (!elements.insight) return;
            elements.insight.innerHTML = buildInsightHtml(type, data);
            if (elements.svg) elements.svg.style.opacity = '0';
            if (elements.center) elements.center.style.opacity = '0';
            elements.insight.classList.add('visible');
            insightVisible = true;
            if (global.document && global.document.body) {
                global.document.body.classList.add('insight-rect-active');
            }
            const closeButton = elements.insight.querySelector('.as-insight-rect-close');
            if (closeButton && options.onInsightClose) {
                closeButton.addEventListener('click', event => {
                    event.stopPropagation();
                    options.onInsightClose();
                });
            }
        }

        function updateInsightPeer(peer, color, type) {
            if (!elements.insight || !insightVisible) return;
            const provider = elements.insight.querySelector('.as-insight-rect-provider');
            const metadata = elements.insight.querySelector('.as-insight-rect-meta');
            const statistic = elements.insight.querySelector('.as-insight-rect-stat');
            const rank = elements.insight.querySelector('.as-insight-rect-rank');
            if (rank) rank.style.display = 'none';
            if (provider) {
                provider.textContent = 'Peer #' + peer.id;
                provider.title = 'Peer #' + peer.id;
                provider.style.color = color;
            }
            if (metadata) {
                const providerName = peer.asname || distributionData.parseAsOrg(peer.as) || '';
                const asNumber = distributionData.parseAsNumber(peer.as) || '';
                metadata.textContent = providerName + ' · ' + asNumber;
            }
            if (statistic) {
                if (type === 'fastest') {
                    statistic.textContent = peer.ping_ms > 0
                        ? Math.round(peer.ping_ms) + ' ms'
                        : '—';
                } else if (type === 'data-bytessent') {
                    statistic.textContent = distributionData.fmtBytes(peer.bytessent || 0) + ' sent';
                } else if (type === 'data-bytesrecv') {
                    statistic.textContent = distributionData.fmtBytes(peer.bytesrecv || 0) + ' recv';
                } else {
                    const connectedSeconds = peer.conntime
                        ? Math.floor(Date.now() / 1000) - peer.conntime
                        : 0;
                    statistic.textContent = 'Uptime: ' + distributionData.fmtDuration(connectedSeconds);
                }
                statistic.style.color = color;
            }
        }

        function hideInsight() {
            if (!elements.insight) return;
            elements.insight.classList.remove('visible');
            insightVisible = false;
            if (global.document && global.document.body) {
                global.document.body.classList.remove('insight-rect-active');
            }
            if (elements.svg) elements.svg.style.opacity = '';
            if (elements.center) elements.center.style.opacity = '';
        }

        function updateLoading(pendingCount, isLoading) {
            if (!elements.loading) return;
            if (isLoading) {
                elements.loading.textContent = 'Locating ' + pendingCount + ' peer' +
                    (pendingCount !== 1 ? 's' : '') + '…';
                elements.loading.style.display = '';
            } else if (hasRendered) {
                elements.loading.style.display = 'none';
            }
        }

        function getDonutCenterPosition() {
            if (!elements.wrap) return null;
            const rect = elements.wrap.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }

        function getLegendDotPosition(provider) {
            if (!elements.legend) return null;
            const items = elements.legend.querySelectorAll('.as-legend-item');
            for (const item of items) {
                if (item.dataset.as !== provider) continue;
                const dot = item.querySelector('.as-legend-dot');
                if (!dot) return null;
                const rect = dot.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return null;
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
            return null;
        }

        function getInsightOrigin() {
            if (!elements.insight || !insightVisible) return null;
            const dot = elements.insight.querySelector('.as-insight-rect-origin');
            if (!dot) return null;
            const rect = dot.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return null;
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }

        function highlightLegend(provider) {
            if (!elements.legend) return;
            elements.legend.querySelectorAll('.as-legend-item').forEach(item => {
                item.classList.add(item.dataset.as === provider ? 'highlighted' : 'dimmed');
            });
        }

        function clearLegendHighlight() {
            if (!elements.legend) return;
            elements.legend.querySelectorAll('.as-legend-item').forEach(item => {
                item.classList.remove('highlighted', 'dimmed');
            });
        }

        return {
            init,
            renderDonut,
            renderLegend,
            renderFilterCenter,
            renderNetworkCenter,
            renderSelectedCenter,
            renderProviderCenter,
            renderLegendHoverCenter,
            renderScoreCenter,
            renderPeerCenter,
            clearLegendHover,
            showInsight,
            updateInsightPeer,
            hideInsight,
            isInsightVisible: () => insightVisible,
            animateExpand,
            animateRevert,
            stopAnimation,
            getAnimationState: () => animation.state,
            getAnimationTarget: () => animation.target,
            updateLoading,
            getDonutCenterPosition,
            getLegendDotPosition,
            getInsightOrigin,
            highlightLegend,
            clearLegendHighlight,
            getCenterElement: () => elements.center || null,
            getLegendElement: () => elements.legend || null,
            appendToWrap: element => {
                if (!elements.wrap) return false;
                elements.wrap.appendChild(element);
                return true;
            },
        };
    }

    global.BPMDistributionDonut = {
        buildDonutSvg,
        buildInsightHtml,
        buildLegendHtml,
        buildScoreTooltip,
        create,
        describeArc,
        formatNameForDonut,
        getQuality,
        insightPresentation,
    };
})(window);
