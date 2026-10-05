import timers from 'node:timers/promises';
import { errorMessage } from './types.ts';
import { createFailureReporter, createLogger, type Logger } from './logging.ts';

export async function sleep(milliseconds: number, signal?: AbortSignal) {
    try { await timers.setTimeout(milliseconds, undefined, { signal }); }
    catch (error) { if (!signal?.aborted) throw error; }
}
export async function repeat(task: () => Promise<unknown>, milliseconds: number, signal: AbortSignal, logger: Logger = createLogger('tasks')) {
    const failures = createFailureReporter(logger);
    while (!signal.aborted) {
        try {
            await task();
            if (!signal.aborted) failures.recovered('Background task recovered');
        } catch (error) { if (!signal.aborted) failures.failure(`Background task failed: ${errorMessage(error)}`, 'error'); }
        await sleep(milliseconds, signal);
    }
}

// Share in-flight reads between clients, including when the refresh exceeds its TTL.
export class CachedRequest<T> {
    private data: T | undefined;
    private started = -Infinity;
    private pending: Promise<T> | null = null;
    readonly ttl: number;
    constructor(ttl: number) { this.ttl = ttl; }
    get(load: () => Promise<T>): Promise<T> {
        if (this.pending) return this.pending;
        if (this.data !== undefined && performance.now() - this.started < this.ttl) return Promise.resolve(this.data);
        this.started = performance.now();
        this.pending = Promise.resolve().then(load).then(data => (this.data = data)).finally(() => { this.pending = null; });
        return this.pending;
    }
}
export class Lru<T> {
    private values = new Map<string, T>();
    readonly limit: number;
    constructor(limit: number) { this.limit = limit; }
    get(key: string): T | undefined {
        const value = this.values.get(key);
        if (value !== undefined) { this.values.delete(key); this.values.set(key, value); }
        return value;
    }
    set(key: string, value: T) {
        this.values.delete(key); this.values.set(key, value);
        while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value!);
        return value;
    }
}
