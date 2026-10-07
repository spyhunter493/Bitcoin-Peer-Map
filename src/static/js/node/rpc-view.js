/** Passthrough RPC extensions are unknown on the wire. Views use only values with the expected primitive type. */
const finite = /** @param {unknown} value */ value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const object = /** @param {unknown} value @returns {value is Record<string, unknown>} */ value =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {import('../../../shared/api.generated').MempoolData | null} data */
export function mempoolView(data) {
    return data && {
        size: data.size,
        bytes: finite(data.bytes), usage: finite(data.usage), total_fee: finite(data.total_fee),
        maxmempool: finite(data.maxmempool), mempoolminfee: finite(data.mempoolminfee), minrelaytxfee: finite(data.minrelaytxfee),
        fullrbf: typeof data.fullrbf === 'boolean' ? data.fullrbf : null,
        unbroadcastcount: finite(data.unbroadcastcount),
    };
}

/** @param {import('../../../shared/api.generated').BlockchainData | null} data */
export function blockchainView(data) {
    if (!data) return null;
    /** @type {Record<string, { active: boolean | null; type: string | null }>} */
    const softforks = Object.create(null);
    if (object(data.softforks)) for (const [name, entry] of Object.entries(data.softforks)) {
        if (object(entry)) softforks[name] = {
            active: typeof entry.active === 'boolean' ? entry.active : null,
            type: typeof entry.type === 'string' ? entry.type : null,
        };
    }
    return {
        chain: data.chain, blocks: data.blocks, bestblockhash: data.bestblockhash,
        initialblockdownload: data.initialblockdownload, size_on_disk: data.size_on_disk, pruned: data.pruned,
        headers: finite(data.headers), difficulty: finite(data.difficulty), mediantime: finite(data.mediantime), softforks,
    };
}
