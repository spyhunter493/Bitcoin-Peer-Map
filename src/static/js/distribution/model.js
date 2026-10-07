import * as distributionData from './data.js';
import { getQuality } from './donut.js';
import * as providerPanel from './provider-panel.js';

/** Owns derived data for one dashboard without importing application state or DOM.
 * @param {{
 * dashboard: ReturnType<typeof import('../core/dashboard-state.js').create>;
 * palette: readonly string[];
 * maxSegments: number;
 * connectionTypeLabels: Readonly<Record<string, string>>;
 * nowSeconds?: () => number;
 * }} options
 */
export function create({ dashboard, palette: PALETTE, maxSegments: MAX_SEGMENTS,
    connectionTypeLabels: CONN_TYPE_LABELS, nowSeconds = () => Math.floor(Date.now() / 1000) }) {
    const distributionState = dashboard.distribution;
    /** @type {string | null} */
    let snapshotSignature = null;
    /** @type {import('../types').DistributionGroup[]} */
    let asGroups = [];
    /** @type {import('../types').DistributionSegment[]} */
    let donutSegments = [];
    /** @type {import('../types').DistributionGroup[]} */
    let countryGroups = [];
    /** @type {import('../types').DistributionSegment[]} */
    let countryDonutSegments = [];
    let distributionScore = 0, totalPeers = 0;
    let countryDistributionScore = 0, countryTotalPeers = 0;

    /** Apply each changed snapshot once per instance. Replacement still happens
     * for identical snapshots so current peer objects remain authoritative.
     * @param {import('../types').Peer[]} peers
     */
    function update(peers) {
        dashboard.replace(peers);
        const signature = JSON.stringify(peers);
        if (signature === snapshotSignature) return false;
        snapshotSignature = signature;
        const now = nowSeconds();
        const providers = distributionData.aggregateProviders(peers, now);
        asGroups = providers.groups;
        totalPeers = providers.total;
        distributionScore = distributionData.distributionScore(asGroups, totalPeers);
        donutSegments = distributionData.buildDonutSegments(asGroups, totalPeers, {
            maxSegments: MAX_SEGMENTS, palette: PALETTE, othersNoun: 'providers',
        });
        const countries = distributionData.aggregateCountries(peers, now);
        countryGroups = countries.groups;
        countryTotalPeers = countries.total;
        countryDistributionScore = distributionData.distributionScore(countryGroups, countryTotalPeers);
        countryDonutSegments = distributionData.buildDonutSegments(countryGroups, countryTotalPeers, {
            maxSegments: MAX_SEGMENTS, palette: PALETTE, othersNoun: 'countries',
        });
        return true;
    }
    function isCountryLens() {
        return distributionState.lens === 'country';
    }

    function getActiveGroups() {
        return isCountryLens() ? countryGroups : asGroups;
    }

    function getActiveSegments() {
        return isCountryLens() ? countryDonutSegments : donutSegments;
    }

    function getActiveTotalPeers() {
        return isCountryLens() ? countryTotalPeers : totalPeers;
    }

    function getActiveDistributionScore() {
        return isCountryLens() ? countryDistributionScore : distributionScore;
    }

    function getActiveEntityKind() {
        return isCountryLens() ? 'Country' : 'ISP';
    }

    /** @param {string} asNum */
    function findActiveSegment(asNum) {
        var segments = getActiveSegments();
        return (
            segments.find(function (s) {
                return s.asNumber === asNum;
            }) || null
        );
    }

    /** @param {string | null} asNum */
    function findActiveGroup(asNum) {
        var groups = getActiveGroups();
        return (
            groups.find(function (g) {
                return g.asNumber === asNum;
            }) || null
        );
    }

    /** @param {string} asNum */
    function findActiveSegmentOrGroup(asNum) {
        var seg = findActiveSegment(asNum);
        if (seg) return seg;
        var grp = findActiveGroup(asNum);
        if (!grp) return null;
        const othersSeg = getActiveSegments().find(function (s) {
            return s.isOthers;
        });
        return {
            asNumber: grp.asNumber,
            asName: grp.asName,
            asShort: grp.asShort,
            countryCode: grp.countryCode || '',
            countryName: grp.countryName || '',
            isCountryGroup: !!grp.isCountryGroup,
            peerCount: grp.peerCount,
            percentage: grp.percentage,
            color: othersSeg ? othersSeg.color : '#58a6ff',
            riskLevel: grp.riskLevel,
            riskLabel: grp.riskLabel,
            peerIds: grp.peerIds,
            isOthers: false,
        };
    }

    /** @param {string} asNum */
    function getPeerIdsForActiveEntity(asNum) {
        var seg = findActiveSegment(asNum);
        if (seg) return seg.peerIds;
        var grp = findActiveGroup(asNum);
        return grp ? grp.peerIds : [];
    }

    /** @param {import('../types').DistributionSegment} seg */
    function getAllPeersForActiveSegment(seg) {
        if (!seg) return [];
        if (seg.isOthers && seg._othersGroups) {
            var all = [];
            for (var i = 0; i < seg._othersGroups.length; i++) {
                for (var j = 0; j < seg._othersGroups[i].peers.length; j++) {
                    all.push(seg._othersGroups[i].peers[j]);
                }
            }
            return all;
        }
        var grp = findActiveGroup(seg.asNumber);
        return grp ? grp.peers : [];
    }

    /** @param {string | null} asNum */
    function getColorForActiveEntity(asNum) {
        var segments = getActiveSegments();
        for (var i = 0; i < segments.length; i++) {
            if (segments[i].asNumber === asNum) return segments[i].color;
            const otherGroups = segments[i]._othersGroups;
            if (segments[i].isOthers && otherGroups) {
                for (var j = 0; j < otherGroups.length; j++) {
                    if (otherGroups[j].asNumber === asNum) return segments[i].color;
                }
            }
        }
        return PALETTE[PALETTE.length - 1];
    }

    /** @param {number} score */
    function buildActiveScoreTooltip(score) {
        var q = getQuality(score);
        var noun = isCountryLens() ? 'countries and territories' : 'providers';
        return (
            'Distribution Score: ' +
            score.toFixed(1) +
            '/10 (' +
            q.word +
            ')\n' +
            'Based on Herfindahl\u2013Hirschman Index (HHI)\n' +
            'Higher = more evenly distributed peers across ' +
            noun + '\nAmong public peers with known ' + (isCountryLens() ? 'country' : 'provider') + ' only.\n' +
            distributionData.coverageLabel(distributionData.distributionCoverage(dashboard.peers, isCountryLens() ? 'country' : 'provider'))
        );
    }

    /** Resolve transient row IDs against the current snapshot.
     * @param {number[]} peerIds
     * @param {import('../types').Peer[]} [peers]
     */
    function peersByIds(peerIds, peers = dashboard.peers) {
        const ids = new Set(peerIds);
        return peers.filter((peer) => ids.has(peer.id));
    }

    /** @param {string | null} asNum */
    function getColorForAsNum(asNum) {
        return distributionData.colorForProvider(asNum, donutSegments, PALETTE[PALETTE.length - 1]);
    }

    /** @param {import('../types').Peer[]} peers */
    function aggregateProvidersForPeers(peers) {
        return distributionData.aggregateProvidersForPeers(peers, donutSegments);
    }

    function computeSummaryData() {
        const data = distributionData.computeSummaryData({
            score: distributionScore,
            groups: asGroups,
            segments: donutSegments,
            peers: dashboard.peers,
            connectionTypeLabels: CONN_TYPE_LABELS,
            nowSeconds: nowSeconds(),
        });
        return { ...data, quality: data.coverage.known ? getQuality(distributionScore) : { word: 'Unavailable', cls: '' } };
    }

    function computeCountrySummaryData() {
        const data = distributionData.computeCountrySummaryData(countryGroups, countryTotalPeers, countryDistributionScore, dashboard.peers);
        return { ...data, quality: data.coverage.known ? getQuality(countryDistributionScore) : { word: 'Unavailable', cls: '' } };
    }

    function getInsightDataForActive() {
        if (!distributionState.insightActiveAsNum || !distributionState.insightActiveType) return null;
        var sumData = computeSummaryData();
        for (var i = 0; i < sumData.insights.length; i++) {
            const insightItem = sumData.insights[i];
            var insight = insightItem;
            if (distributionState.insightActiveType === 'stable' && insight.type === 'stable') {
                return {
                    provName: insight.provName,
                    asNumber: insight.asNumber,
                    peerIds: insight.peerIds,
                    durText: insight.durText,
                    color: getColorForAsNum(insight.asNumber),
                };
            }
            if (distributionState.insightActiveType === 'fastest' && insight.type === 'fastest' && insight.topProviders) {
                for (var j = 0; j < insight.topProviders.length; j++) {
                    if (insight.topProviders[j].asNumber === distributionState.insightActiveAsNum) {
                        return {
                            provName: insight.topProviders[j].provName,
                            asNumber: insight.topProviders[j].asNumber,
                            peerIds: insight.topProviders[j].peerIds,
                            avgPing: insight.topProviders[j].avgPing,
                            rank: j + 1,
                            color: insight.topProviders[j].color || getColorForAsNum(insight.topProviders[j].asNumber),
                        };
                    }
                }
            }
            if (insight.type === 'data-providers' && insight.topProviders) {
                var matchesField =
                    (distributionState.insightActiveType === 'data-bytessent' && insight.field === 'bytessent') ||
                    (distributionState.insightActiveType === 'data-bytesrecv' && insight.field === 'bytesrecv');
                if (!matchesField) continue;
                for (var k = 0; k < insight.topProviders.length; k++) {
                    if (insight.topProviders[k].asNumber === distributionState.insightActiveAsNum) {
                        return {
                            provName: insight.topProviders[k].provName,
                            asNumber: insight.topProviders[k].asNumber,
                            peerIds: insight.topProviders[k].peers.map((peer) => peer.id),
                            totalBytes: insight.topProviders[k].totalBytes,
                            rank: k + 1,
                            color: insight.topProviders[k].color || getColorForAsNum(insight.topProviders[k].asNumber),
                        };
                    }
                }
            }
        }
        return null;
    }

    /** Check if an AS number belongs to an Others sub-provider (not in top-8 donut segments)
     * @param {string} asNum */
    function isOthersSubProvider(asNum) {
        if (!asNum) return false;
        var inDonut = findActiveSegment(asNum);
        if (inDonut) return false;
        // Check if it exists in the active groups (real item, just not top-8)
        var grp = findActiveGroup(asNum);
        return !!grp;
    }

    /** Get peer IDs for any provider, including those inside Others.
     * @param {string} asNum */
    function getPeerIdsForAnyAs(asNum) {
        return providerPanel.peerIdsFor(asNum, donutSegments, asGroups);
    }

    /** Get the color for a given AS number
     * @param {string | null} asNum */
    function getColorForAs(asNum) {
        var seg = donutSegments.find(function (s) {
            return s.asNumber === asNum;
        });
        return seg ? seg.color : null;
    }

    return Object.freeze({
        update,
        isCountryLens,
        getActiveGroups,
        getActiveSegments,
        getActiveTotalPeers,
        getActiveDistributionScore,
        getActiveEntityKind,
        findActiveSegment,
        findActiveGroup,
        findActiveSegmentOrGroup,
        getPeerIdsForActiveEntity,
        getAllPeersForActiveSegment,
        getColorForActiveEntity,
        buildActiveScoreTooltip,
        peersByIds,
        getColorForAsNum,
        aggregateProvidersForPeers,
        computeSummaryData,
        computeCountrySummaryData,
        getInsightDataForActive,
        isOthersSubProvider,
        getPeerIdsForAnyAs,
        getColorForAs,
        get providerGroups() { return asGroups; },
        get providerSegments() { return donutSegments; },
        get providerTotal() { return totalPeers; },
        get providerScore() { return distributionScore; },
        get countryGroups() { return countryGroups; },
        get countrySegments() { return countryDonutSegments; },
        get countryTotal() { return countryTotalPeers; },
        get countryScore() { return countryDistributionScore; },
    });
}
