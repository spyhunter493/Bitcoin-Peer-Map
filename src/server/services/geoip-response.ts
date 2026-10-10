import { MAX_GEOIP_RESPONSE_BYTES } from './geoip-limits.ts';

/** Fetch exposes decoded bytes; encoded Content-Length is never the body limit. */
export async function readGeoipJson(response: Response, signal: AbortSignal): Promise<unknown> {
    if (!response.body) {
        signal.throwIfAborted();
        throw new Error('GeoIP response has no body');
    }
    const reader = response.body.getReader();
    let complete = false;
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        signal.throwIfAborted();
        const length = response.headers.get('Content-Length');
        const encoding = response.headers.get('Content-Encoding')?.trim().toLowerCase();
        if ((!encoding || encoding === 'identity') && length && /^\d+$/.test(length)
            && Number(length) > MAX_GEOIP_RESPONSE_BYTES) throw new Error('GeoIP response exceeds the size limit');
        const chunks: Buffer[] = [];
        let size = 0;
        while (true) {
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) { complete = true; break; }
            if (value.byteLength > MAX_GEOIP_RESPONSE_BYTES - size) throw new Error('GeoIP response exceeds the size limit');
            size += value.byteLength;
            chunks.push(Buffer.from(value));
        }
        const value: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
        signal.throwIfAborted();
        return value;
    } finally {
        signal.removeEventListener('abort', cancel);
        // Cleanup cannot extend the owned request lifetime if a stream ignores cancellation.
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
