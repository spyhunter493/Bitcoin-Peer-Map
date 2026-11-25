import * as filters from './filters.js';
import { aggregateProviders, aggregateCountries } from '../distribution/data.js';

const kinds = new Set(['network', 'provider', 'country', 'software', 'services', 'conntype', 'direction', 'hosting', 'others', 'insight']);
/** @param {import('../types').PeerFilter | null} filter @param {number} [depth] */
export function validateFilter(filter, depth = 0) {
    if (filter === null) return;
    if (!filter || depth > 4) throw new Error('This saved view contains an unsupported filter.');
    if (filter.kind === 'all' && filter.filters) { if (!filter.filters.length || filter.filters.length > 16) throw new Error('This saved view contains an unsupported filter.'); for (const child of filter.filters) validateFilter(child, depth + 1); return; }
    if (!kinds.has(filter.kind) || typeof filter.key !== 'string') throw new Error('This saved view contains an unsupported filter.');
}
/** @param {import('../types').Peer[]} peers @param {import('../types').PeerFilter | null} filter */
export function resolveSavedFilter(peers, filter) {
    validateFilter(filter);
    if (!filter) return peers;
    const topGroups = {
        provider: aggregateProviders(peers).groups.slice(0, 8).map(group => group.asNumber),
        country: aggregateCountries(peers).groups.slice(0, 8).map(group => group.countryCode || ''),
    };
    return filters.resolve(peers, filter, topGroups);
}
/** @param {ReturnType<typeof import('../core/dashboard-state.js').create>} dashboard @returns {import('../types').PeerFilter | null} */
export function captureFilter(dashboard) {
    const state = dashboard.distribution, privateState = dashboard.privateNetwork;
    if (dashboard.interaction.mapFilterPeerIds !== null) throw new Error('Close the individual map selection before saving a view. Individual peer selections are not saved.');
    /** @type {import('../types').PeerFilter[]} */ const parts = [];
    if (privateState.privateNetMode) {
        if (privateState.pnSelectedNet) parts.push({ kind: 'network', key: privateState.pnSelectedNet });
        if (privateState.pnFilter) parts.push(privateState.pnFilter.filter);
    } else if (dashboard.interaction.asFilterPeerIds !== null) {
        if (state.peerDetailActive && !state.selectedProvider && !state.summarySelected && !state.activeNetwork) throw new Error('Close the individual peer details before saving a view.');
        if (state.activeNetwork) parts.push({ kind: 'network', key: state.activeNetwork });
        if (state.selectedProvider) parts.push(state.selectedProvider === 'Others' ? { kind: 'others', key: state.lens === 'country' ? 'country' : 'provider' } : { kind: state.lens === 'country' ? 'country' : 'provider', key: state.selectedProvider.replace(/^country:/, '') });
        const descriptor = state.filterCategory && state.filterCategory !== 'summary'
            ? filters.forCategory(state.filterCategory, state.filterLabel || '', dashboard.peers) : state.filterDescriptor;
        if (descriptor) parts.push(descriptor);
        if (state.subSubFilterProvider) parts.push({ kind: 'provider', key: state.subSubFilterProvider });
        if (!parts.length) throw new Error('This temporary selection cannot be saved. Choose a named provider, country, network, or category first.');
    }
    /** @type {import('../types').PeerFilter | null} */
    const result = parts.length > 1 ? { kind: 'all', filters: parts } : parts[0] || null;
    validateFilter(result); return result;
}
