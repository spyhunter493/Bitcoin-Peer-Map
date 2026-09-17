/* Semantic filters are stable across changing peer IDs and display labels. */
(function (global) {
    'use strict';
    const provider = peer => (peer.as || '').match(/^AS\d+/)?.[0] || '';
    const hosting = peer => peer.hosting ? 'cloud' : peer.proxy ? 'proxy' : peer.mobile ? 'mobile' : 'residential';
    const valueFor = {
        network: peer => peer.network || 'ipv4',
        provider,
        country: peer => peer.countryCode || '',
        software: peer => peer.subver || 'Unknown',
        services: peer => peer.services_abbrev || '\u2014',
        conntype: peer => peer.connection_type || 'unknown',
        direction: peer => peer.direction,
        hosting,
    };
    function resolve(peers, descriptor, topGroups = {}) {
        if (!descriptor) return peers;
        if (descriptor.kind === 'all') {
            return descriptor.filters.reduce((result, filter) => resolve(result, filter, topGroups), peers);
        }
        if (descriptor.kind === 'others') {
            const excluded = new Set(topGroups[descriptor.key] || []);
            const keyFor = valueFor[descriptor.key];
            return peers.filter(peer => keyFor(peer) && !excluded.has(keyFor(peer)));
        }
        if (descriptor.kind === 'insight') {
            if (descriptor.key === 'fastest') return peers.filter(peer => peer.ping_ms > 0);
            return peers.filter(peer => (peer[descriptor.key] || 0) > 0);
        }
        if (descriptor.kind === 'provider' && descriptor.key === '*') return peers.filter(peer => provider(peer));
        const keyFor = valueFor[descriptor.kind];
        return keyFor ? peers.filter(peer => keyFor(peer) === descriptor.key) : [];
    }
    function forCategory(category, label, peers = []) {
        if (category === 'country' || category === 'country-group') return { kind: 'country', key: label.split(' ')[0] };
        if (['provider', 'country-provider'].includes(category)) return { kind: 'provider', key: label.match(/^AS\d+/)?.[0] || '' };
        if (category === 'conntype') {
            const key = Object.keys(global.BPMFormat.connectionTypes).find(key => global.BPMFormat.connectionTypes[key] === label || global.BPMFormat.connectionLabels[key] === label);
            const sample = peers.find(peer => global.BPMFormat.connectionLabels?.[peer.connection_type] === label);
            return { kind: 'conntype', key: sample?.connection_type || key || label };
        }
        if (category === 'conn-in' || category === 'conn-out') return { kind: 'all', filters: [
            { kind: label === 'Others' ? 'others' : 'provider', key: label === 'Others' ? 'provider' : label }, { kind: 'direction', key: category === 'conn-in' ? 'IN' : 'OUT' },
        ] };
        if (category === 'conn-others') return { kind: 'others', key: 'provider' };
        if (category === 'insight-fastest') return { kind: 'insight', key: 'fastest' };
        if (category?.startsWith('insight-data-')) return { kind: 'insight', key: category.slice(13) };
        if (category === 'all-providers') return { kind: 'provider', key: '*' };
        if (category === 'conn-provider' || category === 'insight-stable') return { kind: 'provider', key: label };
        return valueFor[category] ? { kind: category, key: label } : null;
    }
    global.BPMPeerFilters = Object.freeze({ resolve, forCategory, valueFor });
})(window);
