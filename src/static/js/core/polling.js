/** @param {import('../types').PollingOptions & {clock?: Pick<Window, 'setInterval' | 'clearInterval'>}} options
 *  @returns {import('../types').PollingController} */
function create(options) {
    const clock = options.clock || globalThis;
    let intervalMs = options.intervalMs;
    /** @type {number | null} */
    let timer = null;
    /** @type {Promise<void> | null} */
    let pending = null;

    function run() {
        if (!pending) {
            pending = Promise.resolve()
                .then(options.task)
                .finally(() => {
                    pending = null;
                });
        }
        return pending;
    }

    function stop() {
        if (timer !== null) clock.clearInterval(timer);
        timer = null;
    }

    function start() {
        stop();
        timer = clock.setInterval(() => {
            run().catch(options.onError || console.error);
        }, intervalMs);
    }

    /** @param {number} value */
    function setIntervalMs(value) {
        if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid polling interval');
        intervalMs = value;
        if (timer !== null) start();
    }

    return Object.freeze({ run, start, stop, setIntervalMs });
}

/** @param {number} intervalMs */
function effectiveInterval(intervalMs) {
    return document.hidden ? Math.max(intervalMs, 60000) : intervalMs;
}
export { create };
export { effectiveInterval };
