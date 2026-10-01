import { readFile, statfs } from 'node:fs/promises';
import { repeat } from '../tasks.ts';
import { type Data, round, nowSeconds } from '../types.ts';

export class DualEma {
    private fast: number | null = null;
    private slow: number | null = null;
    readonly fastSeconds: number;
    readonly slowSeconds: number;
    constructor(fast: number, slow: number) { this.fastSeconds = fast; this.slowSeconds = slow; }
    update(value: number, elapsed: number) {
        if (this.fast === null || this.slow === null) { this.fast = this.slow = value; return value; }
        this.fast += (1 - Math.exp(-elapsed / this.fastSeconds)) * (value - this.fast);
        this.slow += (1 - Math.exp(-elapsed / this.slowSeconds)) * (value - this.slow);
        const blend = Math.min(Math.abs(value - this.slow) / Math.max(this.slow, 1) * 2, 1);
        return this.slow + blend * (this.fast - this.slow);
    }
}
export class SystemMetrics {
    private snapshot: Data | null = null;
    private previousNetwork: [number, number, number] | null = null;
    private previousCpu: [number, number] | null = null;
    private rx = new DualEma(0.8, 2.5);
    private tx = new DualEma(0.8, 2.5);
    private cpu = new DualEma(0.6, 1.5);
    private memory = new DualEma(0.5, 2);
    private controller = new AbortController();
    private task: Promise<void> | null = null;
    start() { this.task ||= repeat(() => this.sample(), 200, this.controller.signal); }
    async stop() { this.controller.abort(); await this.task; }
    latest(): Data | null { return this.snapshot ? { ...this.snapshot } : null; }
    async sample() {
        const now = nowSeconds();
        let rxRate = 0, txRate = 0, cpuPercent: number | null = null, memoryPercent: number | null = null;
        let usedMemory: number | null = null, totalMemory: number | null = null;
        const [network, cpu, memory] = await Promise.allSettled(['/proc/net/dev', '/proc/stat', '/proc/meminfo'].map(path => readFile(path, 'utf8')));
        if (network.status === 'fulfilled') {
            let received = 0, sent = 0;
            for (const line of network.value.split('\n')) {
                if (!line.includes(':')) continue;
                const [device, raw] = line.split(':'); if (device.trim() === 'lo') continue;
                const fields = raw.trim().split(/\s+/).map(Number);
                if (fields.length >= 9) { received += fields[0]; sent += fields[8]; }
            }
            if (this.previousNetwork) {
                const elapsed = now - this.previousNetwork[2];
                if (elapsed > 0) { rxRate = Math.max(0, (received - this.previousNetwork[0]) / elapsed); txRate = Math.max(0, (sent - this.previousNetwork[1]) / elapsed); }
            }
            this.previousNetwork = [received, sent, now];
        }
        if (cpu.status === 'fulfilled') {
            const fields = cpu.value.split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
            const idle = fields[3] + fields[4], total = fields.reduce((a, b) => a + b, 0);
            if (this.previousCpu && total > this.previousCpu[1]) cpuPercent = 100 * (1 - (idle - this.previousCpu[0]) / (total - this.previousCpu[1]));
            this.previousCpu = [idle, total];
        }
        if (memory.status === 'fulfilled') {
            const entries = Object.fromEntries(memory.value.trim().split('\n').map(line => { const [key, value] = line.split(/\s+/); return [key, Number(value)]; }));
            const total = entries['MemTotal:'], available = entries['MemAvailable:'];
            if (total > 0 && Number.isFinite(available)) { memoryPercent = (1 - available / total) * 100; usedMemory = round((total - available) / 1024); totalMemory = round(total / 1024); }
        }
        this.snapshot = { rx_bps: round(this.rx.update(rxRate, 0.2), 1), tx_bps: round(this.tx.update(txRate, 0.2), 1), cpu_pct: cpuPercent === null ? null : round(this.cpu.update(cpuPercent, 0.2), 1), mem_pct: memoryPercent === null ? null : round(this.memory.update(memoryPercent, 0.2), 1), mem_used_mb: usedMemory, mem_total_mb: totalMemory, ts: now };
    }
    async summary(): Promise<Data> {
        const snapshot = this.latest() || {};
        const result: Data = { cpu_pct: snapshot.cpu_pct ?? null, mem_pct: snapshot.mem_pct ?? null, cpu_breakdown: null, mem_used_mb: snapshot.mem_used_mb ?? null, mem_total_mb: snapshot.mem_total_mb ?? null };
        const [uptime, load, disk] = await Promise.allSettled([readFile('/proc/uptime', 'utf8'), readFile('/proc/loadavg', 'utf8'), statfs('/')]);
        if (uptime.status === 'fulfilled') {
            const seconds = Math.floor(Number(uptime.value.split(' ')[0]));
            const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
            result.uptime = days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
            result.uptime_sec = seconds;
        }
        if (load.status === 'fulfilled') { const values = load.value.split(' ').map(Number); Object.assign(result, { load_1: values[0], load_5: values[1], load_15: values[2] }); }
        if (disk.status === 'fulfilled') {
            const fs = disk.value, total = fs.blocks * fs.bsize, free = fs.bavail * fs.bsize, used = total - fs.bfree * fs.bsize;
            Object.assign(result, { disk_total_gb: round(total / 1e9, 1), disk_used_gb: round(used / 1e9, 1), disk_free_gb: round(free / 1e9, 1), disk_pct: total ? round(used / total * 100, 1) : 0 });
        }
        return result;
    }
}
