import { CachedRequest } from '../tasks.ts';
import { parseNetTotals, parseUptime } from '../rpc-types.ts';
import { type Rpc, nowSeconds, round } from '../types.ts';

export const NODE_METRICS_INTERVAL_MS = 5000;
export type { NodeMetrics as NodeMetricsSnapshot } from '../../shared/api.generated.d.ts';
import type { NodeMetrics as NodeMetricsSnapshot } from '../../shared/api.generated.d.ts';

/** Share RPC reads across dashboard, stats, and legacy stream consumers. */
export class NodeMetrics {
    readonly rpc: Rpc;
    private cache = new CachedRequest<NodeMetricsSnapshot>(NODE_METRICS_INTERVAL_MS);
    private snapshot: NodeMetricsSnapshot | null = null;
    private previous: { received: number; sent: number; uptime: number | null; time: number } | null = null;
    constructor(rpc: Rpc) { this.rpc = rpc; }
    latest(): NodeMetricsSnapshot | null { return this.snapshot ? { ...this.snapshot } : null; }
    async summary(): Promise<NodeMetricsSnapshot> {
        return { ...await this.cache.get(() => this.sample()) };
    }
    private async sample(): Promise<NodeMetricsSnapshot> {
        const [observation, uptime] = await Promise.all([
            this.rpc.call('getnettotals', [], 10).then(value => ({
                totals: parseNetTotals(value), time: performance.now() / 1000,
            })).catch(() => null),
            this.rpc.call('uptime', [], 10).then(parseUptime).catch(() => null),
        ]);
        const totals = observation?.totals ?? null;
        let rx: number | null = null, tx: number | null = null;
        if (observation && totals) {
            const time = observation.time;
            const received = totals.totalbytesrecv, sent = totals.totalbytessent;
            const previous = this.previous;
            const restarted = previous && uptime !== null && previous.uptime !== null && uptime < previous.uptime;
            if (previous && !restarted && time > previous.time && received >= previous.received && sent >= previous.sent) {
                const elapsed = time - previous.time;
                rx = round((received - previous.received) / elapsed, 1);
                tx = round((sent - previous.sent) / elapsed, 1);
            }
            this.previous = { received, sent, uptime, time };
        } else {
            // A recovered connection needs a fresh baseline, not a rate across the outage.
            this.previous = null;
        }
        const days = uptime === null ? 0 : Math.floor(uptime / 86400);
        const hours = uptime === null ? 0 : Math.floor(uptime % 86400 / 3600);
        const minutes = uptime === null ? 0 : Math.floor(uptime % 3600 / 60);
        this.snapshot = {
            uptime: uptime === null ? null : days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`,
            uptime_sec: uptime, download_bytes: totals?.totalbytesrecv ?? null, upload_bytes: totals?.totalbytessent ?? null,
            rx_bps: rx, tx_bps: tx, ts: nowSeconds(),
        };
        return this.snapshot;
    }
}
