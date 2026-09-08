/* Shared JSON API client for dashboard feature modules. */
(function (global) {
    'use strict';

    class HttpError extends Error {
        constructor(message, status, data) {
            super(message);
            this.name = 'HttpError';
            this.status = status;
            this.data = data;
        }
    }

    async function requestJson(url, options) {
        const response = await global.fetch(url, options);
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
        return data;
    }

    function getJson(url, options) {
        return requestJson(url, Object.assign({}, options, { method: 'GET' }));
    }

    function postJson(url, body, options) {
        const requestOptions = Object.assign({}, options, { method: 'POST' });
        if (body !== undefined) {
            requestOptions.headers = Object.assign(
                {},
                options && options.headers,
                { 'Content-Type': 'application/json' }
            );
            requestOptions.body = JSON.stringify(body);
        }
        return requestJson(url, requestOptions);
    }

    global.BPMApi = Object.freeze({
        HttpError,
        requestJson,
        getJson,
        postJson,
    });
})(window);
