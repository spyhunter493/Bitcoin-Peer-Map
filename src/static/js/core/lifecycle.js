/** A component owns every listener, timer and render scope it creates.
 * Disposing a render scope releases detached DOM nodes immediately.
 * @param {Pick<Window, 'setTimeout' | 'clearTimeout' | 'requestAnimationFrame' | 'cancelAnimationFrame'>} [clock]
 */
export function create(clock = globalThis.window) {
    let active = true;
    /** @type {Set<() => void>} */
    const cleanups = new Set();
    /** @type {Map<string, ReturnType<typeof create>>} */
    const children = new Map();
    /** @template {keyof HTMLElementEventMap} K
     * @param {EventTarget | null} target
     * @param {K} type
     * @param {(event: HTMLElementEventMap[K]) => void} handler
     */
    function listen(target, type, handler) {
        if (!active || !target) return;
        const listener = /** @type {EventListener} */ (handler);
        target.addEventListener(type, listener);
        cleanups.add(() => target.removeEventListener(type, listener));
    }
    /** @param {() => void} task @param {number} ms */
    function timeout(task, ms) {
        if (!active) return;
        const handle = clock.setTimeout(() => { cleanups.delete(cancel); if (active) task(); }, ms);
        const cancel = () => clock.clearTimeout(handle);
        cleanups.add(cancel);
    }
    /** @param {() => void} task */
    function frame(task) {
        if (!active) return;
        const handle = clock.requestAnimationFrame(() => { cleanups.delete(cancel); if (active) task(); });
        const cancel = () => clock.cancelAnimationFrame(handle);
        cleanups.add(cancel);
    }
    /** @param {string} key */
    function replace(key) {
        children.get(key)?.dispose();
        const child = create(clock);
        if (!active) child.dispose();
        else children.set(key, child);
        return child;
    }
    function dispose() {
        if (!active) return;
        active = false;
        for (const child of children.values()) child.dispose();
        children.clear();
        for (const cleanup of cleanups) cleanup();
        cleanups.clear();
    }
    return Object.freeze({ listen, timeout, frame, replace, dispose, isActive: () => active });
}
