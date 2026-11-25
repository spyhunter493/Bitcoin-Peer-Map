import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { HttpError } from '../http.ts';

interface Job {
    id: number;
    op: string;
    data: Record<string, unknown>;
    bytes: number;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
}
/** SQLite is owned by one worker; optional history cannot starve control work. */
export class MonitoringStore {
    private worker: Worker | null = null;
    private control: Job[] = [];
    private data: Job[] = [];
    private active: Job | null = null;
    private nextId = 0;
    private bytes = 0;
    private ready: Promise<void> | null = null;
    private stopped = false;
    private failed = false;
    private activeTimeout: ReturnType<typeof setTimeout> | null = null;
    error: string | null = null;
    dropped = 0;
    readonly path: string;
    readonly scope: string;
    readonly limits?: { events?: number; buckets?: number };
    constructor(dataDir: string, scope: string, limits?: { events?: number; buckets?: number }) {
        this.path = join(dataDir, 'history.db');
        this.scope = scope;
        this.limits = limits;
    }
    get queued() {
        return this.control.length + this.data.length + (this.active ? 1 : 0);
    }
    start(): Promise<void> {
        if (this.ready) return this.ready;
        this.ready = new Promise<void>((resolve, reject) => {
            // Node's test runner may expand process.execArgv with process-only
            // flags. This worker needs only Node 26's built-in TS/SQLite support.
            const worker = (this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
                workerData: { path: this.path, scope: this.scope, limits: this.limits },
                execArgv: []
            }));
            const timeout = setTimeout(() => {
                this.fail();
                reject(this.failure());
                void worker.terminate();
            }, 10000);
            worker.on(
                'message',
                (message: { ready?: boolean; error?: string; status?: number; id?: number; result?: unknown }) => {
                    if (message.ready !== undefined) {
                        clearTimeout(timeout);
                        if (message.ready) {
                            resolve();
                            this.dispatch();
                        } else {
                            this.fail();
                            reject(this.failure());
                        }
                        return;
                    }
                    if (!this.active || message.id !== this.active.id) return;
                    if (this.activeTimeout) clearTimeout(this.activeTimeout);
                    this.activeTimeout = null;
                    const job = this.active;
                    this.active = null;
                    this.bytes -= job.bytes;
                    if (message.error) {
                        if (message.status !== 409) this.error = message.error;
                        job.reject(new HttpError(message.status ?? 503, message.error, 'monitoring_unavailable'));
                    } else {
                        if (['append', 'prune', 'incident'].includes(job.op)) this.error = null;
                        job.resolve(message.result);
                    }
                    this.dispatch();
                }
            );
            worker.on('error', () => {
                clearTimeout(timeout);
                this.fail();
                reject(this.failure());
            });
            worker.on('exit', (code) => {
                clearTimeout(timeout);
                if (!this.stopped && code !== 0) this.fail();
            });
        });
        return this.ready;
    }
    private failure() {
        return new HttpError(
            503,
            'Monitoring storage is unavailable. Check saved data and permissions.',
            'monitoring_unavailable'
        );
    }
    private fail() {
        this.failed = true;
        if (this.activeTimeout) clearTimeout(this.activeTimeout);
        this.activeTimeout = null;
        this.error = 'Monitoring storage is unavailable. Check saved data and permissions.';
        if (this.active) this.active.reject(this.failure());
        for (const job of [...this.control, ...this.data]) job.reject(this.failure());
        this.active = null;
        this.control = [];
        this.data = [];
        this.bytes = 0;
    }
    private dispatch() {
        if (this.active || !this.worker || this.failed) return;
        const job = this.control.shift() ?? this.data.shift();
        if (!job) return;
        if (job.signal?.aborted) {
            this.bytes -= job.bytes;
            job.reject(job.signal.reason);
            this.dispatch();
            return;
        }
        this.active = job;
        this.activeTimeout = setTimeout(() => {
            this.fail();
            void this.worker?.terminate();
        }, 5000);
        try {
            this.worker.postMessage({ id: job.id, op: job.op, data: job.data });
        } catch {
            this.fail();
        }
    }
    async request<T>(
        op: string,
        data: Record<string, unknown> = {},
        optional = false,
        signal?: AbortSignal
    ): Promise<T> {
        signal?.throwIfAborted();
        if (this.stopped || this.failed) throw this.failure();
        await this.start();
        signal?.throwIfAborted();
        const bytes = Buffer.byteLength(JSON.stringify(data));
        if (
            (optional && (this.data.length >= 256 || this.bytes + bytes > 4 * 1024 * 1024)) ||
            (!optional && this.control.length >= 64)
        ) {
            if (optional) {
                this.dropped += Array.isArray(data.events) ? data.events.length : 1;
                throw new HttpError(503, 'History queue is full; coverage is incomplete.', 'history_overflow');
            }
            throw new HttpError(503, 'Monitoring is busy; try again shortly.', 'monitoring_busy');
        }
        return await new Promise<T>((resolve, reject) => {
            const job: Job = {
                id: ++this.nextId,
                op,
                data,
                bytes,
                signal,
                resolve: (value) => resolve(value as T),
                reject
            };
            this.bytes += bytes;
            (optional ? this.data : this.control).push(job);
            this.dispatch();
        });
    }
    /** Wait behind previously accepted history writes without promoting them over controls. */
    async flush(): Promise<void> {
        await this.request('coverage', {}, true);
    }
    async close(): Promise<void> {
        if (!this.worker) {
            this.stopped = true;
            return;
        }
        if (this.failed) {
            this.stopped = true;
            await this.worker.terminate();
            this.worker = null;
            return;
        }
        const deadline = performance.now() + 5000;
        while (this.queued && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
        if (this.queued) this.fail();
        try {
            await this.request('close');
        } catch {
            /* Existing data is retained for diagnosis. */
        }
        this.stopped = true;
        await this.worker.terminate();
        this.worker = null;
    }
}
