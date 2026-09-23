class HttpError extends Error {
    /** @param {string} message @param {number} status @param {unknown} data */
    constructor(message, status, data) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.data = data;
    }
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
        throw new HttpError(detail || `Request failed (${response.status})`, response.status, data);
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
function postJson(url, body, options) {
    const requestOptions = Object.assign({}, options, { method: 'POST' });
    if (body !== undefined) {
        requestOptions.headers = Object.assign({}, options && options.headers, { 'Content-Type': 'application/json' });
        requestOptions.body = JSON.stringify(body);
    }
    return requestJson(url, requestOptions);
}

export { HttpError };
export { requestJson };
export { getJson };
export { postJson };

/** @param {unknown} error */
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
