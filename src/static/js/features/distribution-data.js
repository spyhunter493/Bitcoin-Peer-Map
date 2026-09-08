/* Pure parsing, aggregation, concentration scoring, and donut-segment data. */
(function (global) {
    'use strict';

    function parseAsNumber(asField) {
        if (!asField) return null;
        const match = asField.match(/^(AS\d+)/);
        return match ? match[1] : null;
    }

    function parseAsOrg(asField) {
        if (!asField) return '';
        const match = asField.match(/^AS\d+\s+(.+)/);
        return match ? match[1].trim() : asField;
    }

    function fmtBytes(bytes) {
        if (bytes == null || isNaN(bytes)) return '\u2014';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    function fmtDuration(seconds) {
        if (!seconds || seconds <= 0) return '\u2014';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return days + 'd ' + hours + 'h';
        if (hours > 0) return hours + 'h ' + minutes + 'm';
        return minutes + 'm';
    }

    function getHostingLabel(peers) {
        const hostingCount = peers.filter(peer => peer.hosting).length;
        const ratio = hostingCount / peers.length;
        if (ratio >= 0.7) return 'Cloud/Hosting';
        if (ratio <= 0.3) return 'Residential';
        return 'Mixed';
    }

    function getRisk(percentage) {
        if (percentage >= 50) return { level: 'critical', label: 'Critical \u2014 Dominates Peers' };
        if (percentage >= 30) return { level: 'high', label: 'High Concentration' };
        if (percentage >= 15) return { level: 'moderate', label: 'Moderate Concentration' };
        return { level: 'low', label: '' };
    }

    function countBy(peers, getKey, buildEntry) {
        const groups = Object.create(null);
        for (const peer of peers) {
            const key = getKey(peer);
            if (!key) continue;
            if (!groups[key]) groups[key] = buildEntry ? buildEntry(peer, key) : { count: 0, peers: [] };
            groups[key].count += 1;
            groups[key].peers.push(peer);
        }
        return Object.values(groups).sort((left, right) => right.count - left.count);
    }

    function buildDistributionGroup(base, peers, denominator, nowSeconds) {
        const count = peers.length;
        const percentage = denominator > 0 ? (count / denominator) * 100 : 0;
        const inboundCount = peers.filter(peer => peer.direction === 'IN').length;
        const pings = peers.filter(peer => peer.ping_ms > 0).map(peer => peer.ping_ms);
        const currentSeconds = nowSeconds == null ? Math.floor(Date.now() / 1000) : nowSeconds;
        const durations = peers
            .filter(peer => peer.conntime > 0 && currentSeconds - peer.conntime > 0)
            .map(peer => currentSeconds - peer.conntime);
        const totalBytesSent = peers.reduce((total, peer) => total + (peer.bytessent || 0), 0);
        const totalBytesRecv = peers.reduce((total, peer) => total + (peer.bytesrecv || 0), 0);
        const average = values => (
            values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
        );
        const connectionTypes = Object.create(null);
        for (const peer of peers) {
            const type = peer.connection_type || 'unknown';
            connectionTypes[type] = (connectionTypes[type] || 0) + 1;
        }
        const versions = countBy(
            peers,
            peer => peer.subver || 'Unknown',
            (peer, key) => ({ subver: key, count: 0, peers: [] })
        );
        const countries = countBy(
            peers,
            peer => peer.countryCode || '',
            (peer, key) => ({ code: key, name: peer.country || key, count: 0, peers: [] })
        );
        const servicesCombos = countBy(
            peers,
            peer => peer.services_abbrev || '\u2014',
            (peer, key) => ({ abbrev: key, count: 0, peers: [] })
        );
        const connTypesList = countBy(
            peers,
            peer => peer.connection_type || 'unknown',
            (peer, key) => ({ type: key, count: 0, peers: [] })
        );
        const averagePing = average(pings);
        const averageDuration = average(durations);
        const risk = getRisk(percentage);

        return {
            asNumber: base.asNumber,
            asName: base.asName,
            asShort: base.asShort,
            countryCode: base.countryCode || '',
            countryName: base.countryName || '',
            isCountryGroup: !!base.isCountryGroup,
            peerCount: count,
            percentage,
            inboundCount,
            outboundCount: count - inboundCount,
            connTypes: connectionTypes,
            connTypesList,
            avgPingMs: averagePing,
            avgDurationSecs: averageDuration,
            avgDurationFmt: fmtDuration(averageDuration),
            totalBytesSent,
            totalBytesRecv,
            totalBytesSentFmt: fmtBytes(totalBytesSent),
            totalBytesRecvFmt: fmtBytes(totalBytesRecv),
            versions,
            countries,
            servicesCombos,
            hostingLabel: getHostingLabel(peers),
            riskLevel: risk.level,
            riskLabel: risk.label,
            peers,
            peerIds: peers.map(peer => peer.id),
            color: '#6e7681',
        };
    }

    function aggregateProviders(peers, nowSeconds) {
        const groupedPeers = Object.create(null);
        let total = 0;
        for (const peer of peers) {
            const asNumber = parseAsNumber(peer.as);
            if (!asNumber) continue;
            total += 1;
            if (!groupedPeers[asNumber]) {
                groupedPeers[asNumber] = {
                    asNumber,
                    asName: parseAsOrg(peer.as),
                    asShort: peer.asname || '',
                    peers: [],
                };
            }
            groupedPeers[asNumber].peers.push(peer);
        }
        const groups = Object.values(groupedPeers).map(group => (
            buildDistributionGroup(group, group.peers, total, nowSeconds)
        ));
        groups.sort((left, right) => right.peerCount - left.peerCount);
        return { groups, total };
    }

    function aggregateCountries(peers, nowSeconds) {
        const groupedPeers = Object.create(null);
        let total = 0;
        for (const peer of peers) {
            const countryCode = (peer.countryCode || '').trim();
            if (!countryCode) continue;
            total += 1;
            const key = 'country:' + countryCode;
            if (!groupedPeers[key]) {
                groupedPeers[key] = {
                    asNumber: key,
                    asName: peer.country || countryCode,
                    asShort: peer.country || countryCode,
                    countryCode,
                    countryName: peer.country || countryCode,
                    isCountryGroup: true,
                    peers: [],
                };
            }
            groupedPeers[key].peers.push(peer);
        }
        const groups = Object.values(groupedPeers).map(group => (
            buildDistributionGroup(group, group.peers, total, nowSeconds)
        ));
        groups.sort((left, right) => right.peerCount - left.peerCount);
        return { groups, total };
    }

    function distributionScore(groups, denominator) {
        if (!denominator) return 0;
        const hhi = groups.reduce((total, group) => {
            const share = group.peerCount / denominator;
            return total + share * share;
        }, 0);
        return Math.round((1 - hhi) * 100) / 10;
    }

    function buildDonutSegments(groups, denominator, options) {
        const config = options || {};
        const maxSegments = config.maxSegments == null ? 8 : config.maxSegments;
        const palette = config.palette || [];
        const othersNoun = config.othersNoun || 'providers';
        const top = groups.slice(0, maxSegments);
        const rest = groups.slice(maxSegments);
        for (let index = 0; index < top.length; index += 1) {
            top[index].color = palette[index % palette.length] || '#6e7681';
        }
        const segments = top.slice();
        if (rest.length) {
            const peerIds = rest.flatMap(group => group.peerIds);
            const peerCount = rest.reduce((total, group) => total + group.peerCount, 0);
            segments.push({
                asNumber: 'Others',
                asName: rest.length + ' other ' + othersNoun,
                asShort: '',
                peerCount,
                percentage: denominator > 0 ? (peerCount / denominator) * 100 : 0,
                riskLevel: 'low',
                riskLabel: '',
                color: palette[palette.length - 1] || '#58a6ff',
                peerIds,
                isOthers: true,
                _othersGroups: rest,
            });
        }
        return segments;
    }

    function peersForSegment(segment, groups) {
        if (segment.isOthers && segment._othersGroups) {
            return segment._othersGroups.flatMap(group => group.peers);
        }
        const group = groups.find(item => item.asNumber === segment.asNumber);
        return group ? group.peers : [];
    }

    function colorForProvider(asNumber, segments, fallbackColor) {
        const fallback = fallbackColor || '#58a6ff';
        for (const segment of segments) {
            if (segment.asNumber === asNumber) return segment.color;
            if (
                segment.isOthers &&
                segment._othersGroups &&
                segment._othersGroups.some(group => group.asNumber === asNumber)
            ) {
                return segment.color;
            }
        }
        return fallback;
    }

    function aggregateSummaryByCategory(peers, getKey, getLabel, segments) {
        const categories = Object.create(null);
        for (const peer of peers) {
            const key = getKey(peer);
            if (!key) continue;
            const asNumber = parseAsNumber(peer.as);
            if (!asNumber) continue;
            const label = getLabel ? getLabel(peer, key) : key;
            if (!categories[key]) {
                categories[key] = {
                    key,
                    label,
                    peerCount: 0,
                    peerIds: [],
                    providers: Object.create(null),
                };
            }
            const category = categories[key];
            category.peerCount += 1;
            category.peerIds.push(peer.id);
            if (!category.providers[asNumber]) {
                category.providers[asNumber] = {
                    asNumber,
                    name: parseAsOrg(peer.as) || asNumber,
                    color: colorForProvider(asNumber, segments),
                    peerCount: 0,
                    peerIds: [],
                    peers: [],
                };
            }
            const provider = category.providers[asNumber];
            provider.peerCount += 1;
            provider.peerIds.push(peer.id);
            provider.peers.push(peer);
        }
        return Object.values(categories)
            .map(category => {
                const providers = Object.values(category.providers)
                    .sort((left, right) => right.peerCount - left.peerCount);
                return {
                    key: category.key,
                    label: category.label,
                    peerCount: category.peerCount,
                    providerCount: providers.length,
                    peerIds: category.peerIds,
                    providers,
                };
            })
            .sort((left, right) => right.peerCount - left.peerCount);
    }

    function aggregateSummaryNetworks(peers, segments) {
        const labels = { ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
        return aggregateSummaryByCategory(
            peers,
            peer => peer.network || 'ipv4',
            (peer, key) => labels[key] || key,
            segments
        );
    }

    function aggregateSummaryHosting(peers, segments) {
        const labels = {
            cloud: 'Cloud / Hosting',
            proxy: 'Proxy / VPN',
            mobile: 'Mobile',
            residential: 'Residential',
        };
        return aggregateSummaryByCategory(
            peers,
            peer => {
                if (peer.hosting) return 'cloud';
                if (peer.proxy) return 'proxy';
                if (peer.mobile) return 'mobile';
                return 'residential';
            },
            (peer, key) => labels[key] || key,
            segments
        );
    }

    function aggregateSummaryCountries(peers, segments) {
        return aggregateSummaryByCategory(
            peers,
            peer => peer.countryCode || null,
            (peer, key) => key + '  ' + (peer.country || key),
            segments
        );
    }

    function aggregateSummarySoftware(peers, segments) {
        return aggregateSummaryByCategory(
            peers,
            peer => peer.subver || 'Unknown',
            null,
            segments
        );
    }

    function aggregateSummaryServices(peers, segments) {
        return aggregateSummaryByCategory(
            peers,
            peer => peer.services_abbrev || '\u2014',
            null,
            segments
        );
    }

    function aggregateProvidersForPeers(peers, segments) {
        const providers = Object.create(null);
        for (const peer of peers) {
            const asNumber = parseAsNumber(peer.as);
            if (!asNumber) continue;
            if (!providers[asNumber]) {
                providers[asNumber] = {
                    asNumber,
                    name: parseAsOrg(peer.as) || asNumber,
                    color: colorForProvider(asNumber, segments),
                    peerCount: 0,
                    peerIds: [],
                    peers: [],
                };
            }
            providers[asNumber].peerCount += 1;
            providers[asNumber].peerIds.push(peer.id);
            providers[asNumber].peers.push(peer);
        }
        return Object.values(providers).sort((left, right) => right.peerCount - left.peerCount);
    }

    function buildConnectionGrid(segments, groups, connectionTypeLabels) {
        return segments.map(segment => {
            const peers = peersForSegment(segment, groups);
            const inboundPeers = peers.filter(peer => peer.connection_type === 'inbound');
            const outboundPeers = peers.filter(peer => peer.connection_type !== 'inbound');
            const subtypeGroups = Object.create(null);
            for (const peer of outboundPeers) {
                const type = peer.connection_type || 'unknown';
                if (!subtypeGroups[type]) subtypeGroups[type] = [];
                subtypeGroups[type].push(peer);
            }
            const outboundSubtypes = Object.entries(subtypeGroups).map(([type, subtypePeers]) => ({
                type,
                label: connectionTypeLabels[type] || type,
                count: subtypePeers.length,
                peerIds: subtypePeers.map(peer => peer.id),
            }));
            let name = segment.isOthers
                ? 'Others'
                : (segment.asShort || segment.asName || segment.asNumber);
            if (name.length > 16) name = name.substring(0, 15) + '\u2026';
            const item = {
                asNumber: segment.asNumber,
                name,
                color: segment.color,
                isOthers: segment.isOthers || false,
                inCount: inboundPeers.length,
                outCount: outboundPeers.length,
                inPeerIds: inboundPeers.map(peer => peer.id),
                outPeerIds: outboundPeers.map(peer => peer.id),
                totalPeerIds: peers.map(peer => peer.id),
                inPeers: inboundPeers,
                outPeers: outboundPeers,
                outSubtypes: outboundSubtypes,
                totalCount: peers.length,
            };
            if (segment.isOthers && segment._othersGroups) {
                item._othersGroups = segment._othersGroups;
            }
            return item;
        });
    }

    function rankProvidersByBytes(peers, groups, segments, field) {
        const providers = Object.create(null);
        for (const peer of peers) {
            const asNumber = parseAsNumber(peer.as);
            if (!asNumber || !(peer[field] > 0)) continue;
            if (!providers[asNumber]) {
                providers[asNumber] = { asNumber, totalBytes: 0, peers: [] };
            }
            providers[asNumber].totalBytes += peer[field];
            providers[asNumber].peers.push(peer);
        }
        return Object.values(providers)
            .map(provider => {
                provider.peers.sort((left, right) => (right[field] || 0) - (left[field] || 0));
                const group = groups.find(item => item.asNumber === provider.asNumber);
                provider.provName = group
                    ? (group.asShort || group.asName || group.asNumber)
                    : provider.asNumber;
                provider.color = colorForProvider(provider.asNumber, segments);
                return provider;
            })
            .sort((left, right) => right.totalBytes - left.totalBytes);
    }

    function computeInsights(groups, peers, segments, nowSeconds) {
        const insights = [];
        const currentSeconds = nowSeconds == null ? Math.floor(Date.now() / 1000) : nowSeconds;
        let mostStable = null;
        let longestAverage = 0;
        const pingProviders = [];

        for (const group of groups) {
            const durations = group.peers
                .filter(peer => peer.conntime > 0)
                .map(peer => currentSeconds - peer.conntime);
            const averageDuration = durations.length
                ? durations.reduce((total, duration) => total + duration, 0) / durations.length
                : 0;
            if (averageDuration > longestAverage) {
                longestAverage = averageDuration;
                mostStable = group;
            }

            const pingPeers = group.peers.filter(peer => peer.ping_ms > 0);
            if (pingPeers.length) {
                const averagePing = pingPeers.reduce((total, peer) => total + peer.ping_ms, 0)
                    / pingPeers.length;
                pingProviders.push({
                    asNumber: group.asNumber,
                    provName: group.asShort || group.asName || group.asNumber,
                    color: colorForProvider(group.asNumber, segments),
                    avgPing: averagePing,
                    peers: group.peers.slice().sort(
                        (left, right) => (left.ping_ms || 9999) - (right.ping_ms || 9999)
                    ),
                    peerIds: group.peerIds,
                });
            }
        }

        if (mostStable && longestAverage > 0) {
            insights.push({
                type: 'stable',
                icon: '\u23f3',
                asNumber: mostStable.asNumber,
                provName: mostStable.asShort || mostStable.asNumber,
                durText: fmtDuration(longestAverage),
                peerIds: mostStable.peers.map(peer => peer.id),
                peers: mostStable.peers,
            });
        }

        pingProviders.sort((left, right) => left.avgPing - right.avgPing);
        if (pingProviders.length) {
            insights.push({
                type: 'fastest',
                icon: '\u26a1',
                topProviders: pingProviders,
                field: 'ping',
            });
        }

        const sentProviders = rankProvidersByBytes(peers, groups, segments, 'bytessent');
        if (sentProviders.length) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b06\ufe0f',
                label: 'Most data sent to <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: sentProviders,
                field: 'bytessent',
            });
        }

        const receivedProviders = rankProvidersByBytes(peers, groups, segments, 'bytesrecv');
        if (receivedProviders.length) {
            insights.push({
                type: 'data-providers',
                icon: '\u2b07\ufe0f',
                label: 'Most data recv by <span style="color:var(--text-muted)">(by rank)</span>',
                topProviders: receivedProviders,
                field: 'bytesrecv',
            });
        }

        return insights;
    }

    function computeSummaryData(options) {
        return {
            score: options.score,
            uniqueProviders: options.groups.length,
            topProvider: options.groups.length ? options.groups[0] : null,
            insights: computeInsights(
                options.groups,
                options.peers,
                options.segments,
                options.nowSeconds
            ),
            connectionGrid: buildConnectionGrid(
                options.segments,
                options.groups,
                options.connectionTypeLabels
            ),
            networks: aggregateSummaryNetworks(options.peers, options.segments),
            hosting: aggregateSummaryHosting(options.peers, options.segments),
            countries: aggregateSummaryCountries(options.peers, options.segments),
            software: aggregateSummarySoftware(options.peers, options.segments),
            services: aggregateSummaryServices(options.peers, options.segments),
        };
    }

    function computeCountrySummaryData(groups, totalPeers, score) {
        return {
            score,
            uniqueCountries: groups.length,
            totalPeers,
            topCountry: groups.length ? groups[0] : null,
            countries: groups,
        };
    }

    global.BPMDistributionData = Object.freeze({
        parseAsNumber,
        parseAsOrg,
        fmtBytes,
        fmtDuration,
        getHostingLabel,
        getRisk,
        buildDistributionGroup,
        aggregateProviders,
        aggregateCountries,
        distributionScore,
        buildDonutSegments,
        peersForSegment,
        colorForProvider,
        aggregateSummaryByCategory,
        aggregateSummaryNetworks,
        aggregateSummaryHosting,
        aggregateSummaryCountries,
        aggregateSummarySoftware,
        aggregateSummaryServices,
        aggregateProvidersForPeers,
        buildConnectionGrid,
        computeInsights,
        computeSummaryData,
        computeCountrySummaryData,
    });
})(window);
