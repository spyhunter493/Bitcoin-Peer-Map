export type CachedValue<T> = { expires: number } & ({ ok: true; value: T } | { ok: false; error: unknown });
interface Flight<T> { controller: AbortController; promise: Promise<T>; subscribers: number; settled: boolean }

/** Each reader owns its wait; the shared load is cancelled only after its last reader leaves. */
export class SharedRead<T> {
    private cached: CachedValue<T> | null = null;
    private pending: Flight<T> | null = null;
    private generation = 0;
    readonly ttl: number;
    readonly failureTtl: number;
    readonly fromCompletion: boolean;
    readonly onIdle?: () => void;
    constructor(ttl: number, failureTtl = 1000, options: { fromCompletion?: boolean; onIdle?: () => void } = {}) {
        this.ttl = ttl; this.failureTtl = failureTtl;
        this.fromCompletion = options.fromCompletion ?? false; this.onIdle = options.onIdle;
    }
    get loading() { return this.pending !== null; }
    get cachedFailureExpires() { return this.cached && !this.cached.ok ? this.cached.expires : null; }
    invalidate() { this.generation++; this.cached = null; this.pending = null; }
    get(load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        const cached = this.cached;
        if (cached && performance.now() < cached.expires) {
            return Promise.resolve().then(() => {
                signal?.throwIfAborted();
                if (!cached.ok) throw cached.error;
                return structuredClone(cached.value);
            });
        }
        if (!this.pending) {
            const generation = this.generation, started = performance.now();
            const flight: Flight<T> = { controller: new AbortController(), subscribers: 0, settled: false, promise: Promise.resolve(undefined as T) };
            flight.promise = Promise.resolve().then(() => {
                flight.controller.signal.throwIfAborted();
                return load(flight.controller.signal);
            }).then(value => {
                if (generation === this.generation && !flight.controller.signal.aborted) {
                    this.cached = { ok: true, value, expires: (this.fromCompletion ? performance.now() : started) + this.ttl };
                }
                return value;
            }, error => {
                if (generation === this.generation && !flight.controller.signal.aborted) {
                    this.cached = { ok: false, error, expires: performance.now() + this.failureTtl };
                }
                flight.controller.abort(error);
                throw error;
            }).finally(() => {
                flight.settled = true;
                if (this.pending === flight) this.pending = null;
                this.onIdle?.();
            });
            // Readers can all leave before the transport settles.
            void flight.promise.catch(() => {});
            this.pending = flight;
        }
        const flight = this.pending;
        flight.subscribers++;
        return new Promise<T>((resolve, reject) => {
            let finished = false;
            const leave = () => {
                if (finished) return false;
                finished = true;
                signal?.removeEventListener('abort', abort);
                if (--flight.subscribers === 0 && !flight.settled) {
                    if (this.pending === flight) this.pending = null;
                    flight.controller.abort(new DOMException('The last reader disconnected', 'AbortError'));
                    this.onIdle?.();
                }
                return true;
            };
            const abort = () => { if (leave()) reject(signal!.reason); };
            signal?.addEventListener('abort', abort, { once: true });
            flight.promise.then(value => {
                if (!leave()) return;
                try { resolve(structuredClone(value)); } catch (error) { reject(error); }
            }, error => { if (leave()) reject(error); });
        });
    }
}

/** Active reads have their own lifetime; only settled failures consume bounded storage. */
export class KeyedSharedReads<Key, Value> {
    private active = new Map<Key, SharedRead<Value>>();
    private failures = new Map<Key, SharedRead<Value>>();
    private prune(now: number) {
        for (const [key, read] of this.failures) {
            if ((read.cachedFailureExpires ?? 0) <= now) this.failures.delete(key);
        }
    }
    get(key: Key, load: (signal: AbortSignal) => Promise<Value>, signal?: AbortSignal): Promise<Value> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        this.prune(performance.now());
        let read = this.active.get(key) || this.failures.get(key);
        if (!read) {
            const owned = new SharedRead<Value>(0, 1000, { onIdle: () => {
                // A cancelled transport may settle after a replacement has started.
                if (owned.loading || this.active.get(key) !== owned) return;
                this.active.delete(key);
                const now = performance.now();
                this.prune(now);
                if ((owned.cachedFailureExpires ?? 0) > now) {
                    this.failures.set(key, owned);
                    if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
                }
            } });
            read = owned;
            this.active.set(key, read);
        }
        const result = read.get(load, signal);
        // The cache may expire between pruning and SharedRead's own clock check.
        // A retry must own an active slot before another caller can join it.
        if (read.loading) {
            this.failures.delete(key);
            this.active.set(key, read);
        }
        return result;
    }
}

export function readDeadline(milliseconds: number, parent: AbortSignal) {
    const controller = new AbortController();
    const expire = () => controller.abort(new DOMException('Read time limit reached', 'TimeoutError'));
    const timer = milliseconds > 0 ? setTimeout(expire, milliseconds) : null;
    if (timer === null) expire();
    return {
        signal: AbortSignal.any([parent, controller.signal]),
        cancel: () => controller.abort(new DOMException('Read finished', 'AbortError')),
        dispose: () => { if (timer !== null) clearTimeout(timer); },
    };
}
