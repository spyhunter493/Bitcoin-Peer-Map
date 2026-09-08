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
    });
})(window);
