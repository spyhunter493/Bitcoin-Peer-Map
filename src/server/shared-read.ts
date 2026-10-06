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
