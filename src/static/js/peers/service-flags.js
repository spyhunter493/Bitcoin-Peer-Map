const blake2b = Object.freeze({
    abbr: 'BL',
    label: 'BLAKE2b fork support',
    rpc: 'NODE_BLAKE2B',
});

/** @type {Readonly<Record<string, import('../types').ServiceFlag>>} */
const flags = Object.freeze({
    NETWORK: { abbr: 'N', label: 'Full chain history', rpc: 'NODE_NETWORK' },
    WITNESS: { abbr: 'W', label: 'Segregated Witness', rpc: 'NODE_WITNESS' },
    NETWORK_LIMITED: { abbr: 'NL', label: 'Limited chain history', rpc: 'NODE_NETWORK_LIMITED' },
    P2P_V2: { abbr: 'P', label: 'BIP324 v2 transport', rpc: 'P2P_V2' },
    COMPACT_FILTERS: { abbr: 'CF', label: 'Compact block filters', rpc: 'NODE_COMPACT_FILTERS' },
    BLOOM: { abbr: 'B', label: 'Bloom filters', rpc: 'NODE_BLOOM' },
    // Knots currently reports the name with "?"; accept either form.
    'BLAKE2B?': blake2b,
    BLAKE2B: blake2b,
});

export default flags;
