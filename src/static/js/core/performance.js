/** Browser display policy. Presets override effective effects, never saved appearance values. */
export const STORAGE_KEY = 'bpm.performancePreset';
export const PRESETS = Object.freeze({ full: 'Full visuals', reduced: 'Reduced effects', static: 'Static map' });
/** @typedef {'full' | 'reduced' | 'static'} Preset */
/** @typedef {{preset: Preset; systemReducedMotion: boolean; staticMap: boolean; heavyEffects: boolean;
 * idleFps: number; interactionFps: number; revision: number; persistent: boolean}} State */
/** @param {unknown} value @returns {value is Preset} */
const valid = value => value === 'full' || value === 'reduced' || value === 'static';

/** Create an independently owned policy, also usable with an injected browser in tests.
 * @param {{document?: Document | null; view?: Window | null; storage?: Pick<Storage, 'getItem' | 'setItem'> | null}} [options]
 */
export function create(options = {}) {
    const document = options.document === undefined ? globalThis.document : options.document;
    const view = options.view === undefined ? globalThis.window : options.view;
    let storage = options.storage;
    if (storage === undefined) {
        try { storage = view?.localStorage ?? null; } catch { storage = null; }
    }
    const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
    /** @type {Preset} */
    let preset = 'full';
    let persistent = Boolean(storage), revision = 0;
    try { const saved = storage?.getItem(STORAGE_KEY); if (valid(saved)) preset = saved; }
    catch { persistent = false; }
    /** @type {Set<(state: Readonly<State>) => void>} */
    const listeners = new Set();

    /** @returns {Readonly<State>} */
    function snapshot() {
        const systemReducedMotion = Boolean(media?.matches);
        return Object.freeze({ preset, systemReducedMotion,
            staticMap: preset === 'static' || systemReducedMotion,
            heavyEffects: preset === 'full' && !systemReducedMotion,
            idleFps: preset === 'reduced' ? 15 : 30,
            interactionFps: preset === 'reduced' ? 30 : 60,
            revision, persistent });
    }
    let state = snapshot();
    function getState() { return state; }
    function publish() {
        revision++;
        state = snapshot();
        const root = document?.documentElement;
        if (root) {
            root.dataset.performancePreset = state.preset;
            root.dataset.performanceEffects = state.heavyEffects ? 'full' : 'reduced';
            root.dataset.performanceMotion = state.staticMap ? 'static' : 'animated';
        }
        for (const listener of listeners) listener(state);
    }
    /** @param {string} value */
    function setPreset(value) {
        if (!valid(value)) throw new RangeError('Unknown performance preset');
        preset = value;
        try { storage?.setItem(STORAGE_KEY, value); persistent = Boolean(storage); }
        catch { persistent = false; }
        publish();
        return getState();
    }
    /** @param {StorageEvent} event */
    function onStorage(event) {
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        preset = valid(event.newValue) ? event.newValue : 'full';
        publish();
    }
    media?.addEventListener?.('change', publish);
    view?.addEventListener?.('storage', onStorage);
    publish();
    return Object.freeze({ getState, setPreset,
        /** @param {(state: Readonly<State>) => void} listener */
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() {
            media?.removeEventListener?.('change', publish);
            view?.removeEventListener?.('storage', onStorage);
            listeners.clear();
        },
    });
}

/** @type {ReturnType<typeof create> | null} */
let current = null;
export function init() { return current ||= create(); }

/** Non-browser consumers can inspect the OS policy without retaining browser state. */
export function getState() {
    if (globalThis.document?.documentElement) return init().getState();
    const systemReducedMotion = Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    return Object.freeze({ preset: /** @type {Preset} */ ('full'), systemReducedMotion, staticMap: systemReducedMotion,
        heavyEffects: !systemReducedMotion, idleFps: 30, interactionFps: 60, revision: 0, persistent: false });
}
/** @param {string} value */
export function setPreset(value) { return init().setPreset(value); }
/** @param {(state: Readonly<State>) => void} listener */
export function subscribe(listener) {
    if (globalThis.document?.documentElement) return init().subscribe(listener);
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => listener(getState());
    media?.addEventListener?.('change', change);
    return () => media?.removeEventListener?.('change', change);
}
