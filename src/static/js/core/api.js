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

/** @param {import('../types').AdminAuthentication | null} authentication */
export function configureAdminAuthentication(authentication) {
    adminAuthentication = authentication;
}

/**
 * @template T
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<T>}
 */
async function requestJson(url, options) {
    const response = await globalThis.fetch(url, options);
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
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
}

/**
 * @template T
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<T>}
 */
function getJson(url, options) {
    return requestJson(url, Object.assign({}, options, { method: 'GET' }));
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
        if (error.status !== 401) throw error;
        if (authentication.getToken() === previousToken) authentication.clearToken();
        const token = await authentication.requestToken(options?.signal || undefined);
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
