class HttpError extends Error {
    /** @param {string} message @param {number} status @param {unknown} data @param {number | null} [retryAfterSeconds] */
    constructor(message, status, data, retryAfterSeconds = null) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.data = data;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** @type {import('../types').AdminAuthentication | null} */
let adminAuthentication = null;
/** @type {import('../types').ViewingAuthentication | null} */
let viewingAuthentication = null;

/** @param {import('../types').AdminAuthentication | null} authentication */
export function configureAdminAuthentication(authentication) {
    adminAuthentication = authentication;
}
/** @param {import('../types').ViewingAuthentication | null} authentication */
export function configureViewingAuthentication(authentication) {
    viewingAuthentication = authentication;
}

/**
 * @template T
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
async function requestJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = timeoutMs === undefined ? null : setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
    const requestOptions = timeoutMs === undefined ? options : { ...options, signal: options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal };
    try {
        const response = await globalThis.fetch(url, requestOptions);
        let data = null;
        try {
            data = await response.json();
        } catch (error) {
            requestOptions?.signal?.throwIfAborted();
            if (response.ok) {
                throw new HttpError('The server returned an invalid JSON response', response.status, null);
            }
        }

        if (!response.ok) {
            const detail = data && (data.detail || data.error || data.message);
            const retryAfter = response.headers.get('Retry-After');
            const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter)
                : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : NaN;
            const retryAfterSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : null;
            const cooldown = response.status === 429 && data?.code === 'admin_rate_limited';
            const message = detail || `Request failed (${response.status})`;
            throw new HttpError(cooldown ? `${message} Try again in ${retryAfterSeconds ?? 60} seconds.` : message, response.status, data, retryAfterSeconds);
        }
        return /** @type {T} */ (data);
    } finally {
        if (timer !== null) clearTimeout(timer);
    }
}

/**
 * @template T
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
async function getJson(url, options, timeoutMs) {
    const target = new URL(url, globalThis.location?.href || 'http://localhost/');
    const authentication = target.origin === (globalThis.location?.origin || 'http://localhost') && target.pathname.startsWith('/api/') ? viewingAuthentication : null;
    const requestOptions = Object.assign({}, options, { method: 'GET' });
    const signal = authentication?.getSignal();
    if (authentication && signal) {
        const headers = new Headers(options?.headers);
        const token = authentication.getToken();
        if (token) headers.set('Authorization', `Bearer ${token}`);
        requestOptions.headers = headers;
        requestOptions.cache = 'no-store';
        requestOptions.signal = options?.signal ? AbortSignal.any([options.signal, signal]) : signal;
    }
    try {
        const result = await requestJson(url, requestOptions, timeoutMs);
        // Abort can happen after headers/JSON arrived; never apply a locked generation.
        signal?.throwIfAborted();
        return /** @type {T} */ (result);
    } catch (error) {
        const viewingCooldown = error instanceof HttpError && error.status === 429 && error.data !== null && typeof error.data === 'object' && 'code' in error.data && error.data.code === 'view_rate_limited';
        if (error instanceof HttpError && authentication && !signal?.aborted && (error.status === 401 || viewingCooldown)) authentication.onAuthenticationFailure();
        throw error;
    }
}

/**
 * @template T
 * @param {string} url
 * @param {unknown} [body]
 * @param {RequestInit} [options]
 * @returns {Promise<T>}
 */
async function postJson(url, body, options) {
    const requestOptions = Object.assign({}, options, { method: 'POST' });
    const headers = new Headers(options && options.headers);
    if (body !== undefined) {
        headers.set('Content-Type', 'application/json');
        requestOptions.body = JSON.stringify(body);
    }
    requestOptions.headers = headers;
    const target = new URL(url, globalThis.location?.href || 'http://localhost/');
    const authentication = target.origin === (globalThis.location?.origin || 'http://localhost') && target.pathname.startsWith('/api/') ? adminAuthentication : null;
    const previousToken = authentication?.getToken() || '';
    if (previousToken) headers.set('Authorization', `Bearer ${previousToken}`);
    try {
        return await requestJson(url, requestOptions);
    } catch (error) {
        if (!(error instanceof HttpError) || !authentication) throw error;
        const anonymousCooldown = error.status === 429 && !previousToken && error.data !== null && typeof error.data === 'object' && 'code' in error.data && error.data.code === 'admin_rate_limited';
        if (error.status !== 401 && !anonymousCooldown) throw error;
        if (error.status === 401 && authentication.getToken() === previousToken) authentication.clearToken();
        const cooldownDeadline = anonymousCooldown ? Date.now() + (error.retryAfterSeconds ?? 60) * 1000 : undefined;
        const token = await authentication.requestToken(options?.signal || undefined, cooldownDeadline);
        options?.signal?.throwIfAborted();
        headers.set('Authorization', `Bearer ${token}`);
        try {
            // Authentication failures execute no action. Retry only that request, once.
            return await requestJson(url, requestOptions);
        } catch (retryError) {
            if (retryError instanceof HttpError && retryError.status === 401 && authentication.getToken() === token) authentication.clearToken();
            throw retryError;
        }
    }
}

export { HttpError };
export { requestJson };
export { getJson };
export { postJson };

/** @param {unknown} error */
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
