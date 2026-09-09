/* Peer snapshot polling and freshness, independent of map and table rendering. */
(function (global) {
    'use strict';

    /** @param {import('../types').PeerRefreshOptions} options
     *  @returns {import('../types').PeerRefreshController} */
    function create(options) {
        const api = options.api || global.BPMApi;
        const now = options.now || Date.now;
        /** @type {Promise<void> | null} */
        let pending = null;
        /** @type {boolean | null} */
        let connected = null;
        let dashboardUnavailable = false;
        /** @type {number | null} */
        let lastSuccessAt = null;
        /** @type {number | null} */
        let ageAtReceipt = null;
        /** @type {number | null} */
        let receivedAt = null;
        let staleAfterSeconds = 30;

        /** @returns {import('../types').PeerDataStatus} */
        function getStatus() {
            const ageSeconds = ageAtReceipt === null ? null
                : ageAtReceipt + Math.max(0, now() - (receivedAt ?? now())) / 1000;
            /** @type {import('../types').PeerDataStatus['state']} */
            let state = 'live';
            if (dashboardUnavailable) state = 'dashboard-unavailable';
            else if (connected === false) state = 'node-unavailable';
            else if (connected === null) state = 'connecting';
            else if (ageSeconds !== null && ageSeconds > staleAfterSeconds) state = 'delayed';
            return {
                state,
                ageSeconds,
                lastSuccessAt,
                stale: lastSuccessAt !== null && state !== 'live',
            };
        }

        function renderStatus() {
            options.onStatus(getStatus());
        }

        function refresh() {
            // A slow request must finish before a timer or peer action starts another.
            if (pending) return pending;
            pending = Promise.resolve().then(async () => {
                const controller = new global.AbortController();
                const timeout = global.setTimeout(() => controller.abort(), options.timeoutMs || 15000);
                /** @type {import('../types').Peer[] | null} */
                let peersToApply = null;
                try {
                    const snapshot = await api.getJson('/api/peers?include_status=true', {
                        signal: controller.signal,
                        cache: 'no-store',
                    });
                    const status = snapshot && snapshot.status;
                    if (!snapshot || !Array.isArray(snapshot.peers) || !status ||
                        ![true, false, null].includes(status.connected) ||
                        (status.last_success_at !== null &&
                            (!Number.isFinite(status.last_success_at) ||
                             !Number.isFinite(status.age_seconds) || status.age_seconds === null ||
                             status.age_seconds < 0)) ||
                        (status.connected === true && status.last_success_at === null)) {
                        throw new Error('Invalid peer snapshot');
                    }

                    if (status.last_success_at !== null) {
                        // An initial page load may legitimately receive a cached snapshot.
                        // Repeated failures preserve the existing map, table, and drill-down DOM.
                        if (status.connected || lastSuccessAt !== status.last_success_at) {
                            peersToApply = snapshot.peers;
                        }
                        lastSuccessAt = status.last_success_at;
                        ageAtReceipt = status.age_seconds;
                        receivedAt = now();
                    }
                    connected = status.connected;
                    staleAfterSeconds = status.stale_after_seconds > 0
                        ? status.stale_after_seconds : 30;
                    dashboardUnavailable = false;
                } catch (error) {
                    dashboardUnavailable = true;
                } finally {
                    global.clearTimeout(timeout);
                }
                if (peersToApply !== null) options.onPeers(peersToApply);
                renderStatus();
            }).finally(() => { pending = null; });
            return pending;
        }

        return Object.freeze({ refresh, getStatus, renderStatus });
    }

    global.BPMPeerRefresh = Object.freeze({ create });
})(window);
