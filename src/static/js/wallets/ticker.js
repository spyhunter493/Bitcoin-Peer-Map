import { getAdminJson, postAdminJson, errorMessage } from '../core/api.js';
import { compareNames, copyPreferences, formatAmount, nextWallet, readyWallets } from './model.js';

/** @typedef {import('../../../shared/api.generated').WalletTickerPreferences} Preferences */
/** @typedef {import('../../../shared/api.generated').WalletPreferencesResponse} PreferencesResponse */
/** @typedef {import('../../../shared/api.generated').WalletRow} WalletRow */
/** @typedef {import('../../../shared/api.generated').WalletSnapshot} WalletSnapshot */
/** @typedef {ReturnType<typeof import('../core/admin-auth.js').create>} Management */

/** The header owns no wallet data until management is unlocked. All private work
 * belongs to one authentication generation, independently of the viewing role.
 * @param {{management: Management; document?: Document}} options */
export function create({ management, document = globalThis.document }) {
    const view = document.defaultView;
    const clock = view || globalThis;
    let initialized = false;
    let generation = 0;
    let reads = new AbortController();
    let state = management.getState();
    /** @type {HTMLButtonElement | null} */
    let button = null;
    /** @type {HTMLElement | null} */
    let amount = null;
    /** @type {HTMLElement | null} */
    let popup = null;
    /** @type {(() => void) | null} */
    let unsubscribe = null;
    /** @type {Preferences | null} */
    let preferences = null;
    /** @type {Preferences | null} */
    let committed = null;
    let preferenceRevision = -1;
    let editRevision = 0;
    /** @type {Preferences | null} */
    let queuedSave = null;
    /** @type {Promise<void> | null} */
    let saving = null;
    /** @type {Promise<void> | null} */
    let preferenceRead = null;
    /** @type {Promise<void> | null} */
    let walletRead = null;
    /** @type {WalletRow[]} */
    let wallets = [];
    /** @type {WalletSnapshot['state'] | 'loading'} */
    let catalogState = 'loading';
    /** @type {string | null} */
    let currentName = null;
    let message = '';
    let saveError = '';
    let masked = document.hidden;
    let hovered = false;
    let focused = false;
    /** @type {number | null} */
    let pollTimer = null;
    /** @type {number | null} */
    let rotationTimer = null;
    let rotationSeconds = 0;
    /** @type {ResizeObserver | null} */
    let resizeObserver = null;
    const motion = view?.matchMedia('(prefers-reduced-motion: reduce)');
    /** @type {Map<string, {element: HTMLLabelElement; input: HTMLInputElement; name: HTMLElement; balance: HTMLElement; pending: HTMLElement; status: HTMLElement}>} */
    const rows = new Map();

    /** @param {number} current */
    function isCurrent(current) {
        return initialized && generation === current && state.authenticated && !reads.signal.aborted;
    }

    function available() { return readyWallets(wallets, preferences); }

    function stopTimers() {
        if (pollTimer !== null) clock.clearInterval(pollTimer);
        if (rotationTimer !== null) clock.clearInterval(rotationTimer);
        pollTimer = rotationTimer = null;
        rotationSeconds = 0;
    }

    function positionPopup() {
        if (!popup || !button || !view) return;
        const anchor = button.getBoundingClientRect();
        const width = Math.min(400, Math.max(0, view.innerWidth - 16));
        popup.style.width = `${width}px`;
        popup.style.maxHeight = `${Math.max(80, view.innerHeight - anchor.bottom - 16)}px`;
        popup.style.left = `${Math.max(8, Math.min(anchor.right - width, view.innerWidth - width - 8))}px`;
        popup.style.top = `${anchor.bottom + 8}px`;
    }

    function fitHeader() {
        if (!button || !view) return;
        const right = button.parentElement;
        if (button.hidden) { right?.classList.remove('wallet-header-tight'); return; }
        const left = document.querySelector('.topbar-left');
        if (!right || !left) return;
        const center = document.querySelector('.topbar-center');
        const style = view.getComputedStyle(button);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) context.font = `${style.fontSize} ${style.fontFamily}`;
        const fullWidth = preferences?.selected_wallets.length && state.authenticated && !masked
            ? (context?.measureText('0000000000000000 sats').width || 150) + 12 : 26;
        const rightRect = right.getBoundingClientRect();
        const clockElement = document.getElementById('clock');
        let clockWidth = 0;
        if (clockElement && view.innerWidth > 800) {
            const clockStyle = view.getComputedStyle(clockElement);
            if (context) context.font = `${clockStyle.fontSize} ${clockStyle.fontFamily}`;
            clockWidth = (context?.measureText('00:00:00').width || 58) + (Number.parseFloat(view.getComputedStyle(right).columnGap) || 0);
        }
        const naturalLeft = rightRect.left - (right.classList.contains('wallet-header-tight') ? clockWidth : 0);
        const buttonWidth = button.getBoundingClientRect().width;
        const targetLeft = naturalLeft - (fullWidth - buttonWidth);
        const centerVisible = center && view.getComputedStyle(center).display !== 'none';
        const minimumLeft = Math.max(left.getBoundingClientRect().right, centerVisible ? center.getBoundingClientRect().right : 0) + 12;
        const compact = view.innerWidth <= 800 || targetLeft < minimumLeft;
        right.classList.toggle('wallet-header-tight', compact && naturalLeft - (26 - buttonWidth) < minimumLeft && clockWidth > 0);
        button.classList.toggle('compact', compact);
        positionPopup();
    }

    function renderButton() {
        if (!button || !amount) return;
        button.hidden = !state.available;
        button.classList.toggle('is-locked', !state.authenticated || masked);
        button.classList.toggle('is-empty', !preferences?.selected_wallets.length);
        const ready = available();
        currentName = nextWallet(ready.map(wallet => wallet.name), currentName);
        const current = ready.find(wallet => wallet.name === currentName);
        const text = state.authenticated && !masked && current && preferences
            ? formatAmount(current.balance_sats, preferences.unit) : '—';
        amount.textContent = text;
        button.setAttribute('aria-label', state.authenticated && !masked
            ? `Wallet balance ${text}. Open wallet options` : 'Unlock wallet balances');
        button.setAttribute('aria-expanded', String(Boolean(popup)));
        fitHeader();
    }

    function closePopup(restoreFocus = false) {
        if (!popup) return;
        popup.remove();
        popup = null;
        rows.clear();
        button?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && button && !button.hidden) button.focus();
    }

    function wipe() {
        generation++;
        reads.abort();
        reads = new AbortController();
        stopTimers();
        closePopup();
        preferences = committed = queuedSave = null;
        preferenceRead = walletRead = saving = null;
        preferenceRevision = -1;
        editRevision = 0;
        wallets = [];
        currentName = null;
        message = '';
        saveError = '';
        catalogState = 'loading';
        hovered = focused = false;
        renderButton();
    }

    /** @param {WalletRow} wallet */
    function rowStatus(wallet) {
        if (wallet.state === 'scanning') return wallet.scanning_progress === null ? 'Scanning…'
            : `Scanning ${Math.round(wallet.scanning_progress * 100)}%`;
        if (wallet.state === 'ineligible') return 'Not a watch-only wallet';
        if (wallet.state === 'unloaded') return 'Unloaded';
        if (wallet.state === 'unavailable') return 'Unavailable';
        return wallet.name === currentName ? 'Currently displayed' : '';
    }

    function renderPopup() {
        if (!popup || !state.authenticated || masked) return;
        const list = popup.querySelector('.wallet-options-list');
        if (!list) return;
        const unit = preferences?.unit || 'BTC';
        const selected = new Set(preferences?.selected_wallets || []);
        const byName = new Map(wallets.map(wallet => [wallet.name, wallet]));
        for (const name of selected) {
            if (!byName.has(name)) byName.set(name, { name, state: 'unavailable', balance_sats: null,
                pending_incoming_sats: null, immature_sats: null, scanning_progress: null, updated_at: null });
        }
        const ordered = [...byName.values()].sort((left, right) => compareNames(left.name, right.name));
        for (const [name, row] of rows) {
            if (!byName.has(name)) { row.element.remove(); rows.delete(name); }
        }
        ordered.forEach((wallet, index) => {
            let row = rows.get(wallet.name);
            if (!row) {
                const element = document.createElement('label');
                element.className = 'wallet-options-row';
                const input = document.createElement('input');
                input.type = 'checkbox';
                const details = document.createElement('span');
                details.className = 'wallet-options-details';
                const name = document.createElement('span');
                name.className = 'wallet-options-name';
                const balance = document.createElement('span');
                const pending = document.createElement('span');
                pending.className = 'wallet-options-pending';
                const status = document.createElement('span');
                status.className = 'wallet-options-status';
                details.append(name, balance, pending, status);
                element.append(input, details);
                input.addEventListener('change', () => {
                    if (!preferences) return;
                    const next = copyPreferences(preferences);
                    next.selected_wallets = next.selected_wallets.filter(value => value !== wallet.name);
                    if (input.checked) next.selected_wallets.push(wallet.name);
                    next.selected_wallets.sort(compareNames);
                    queueSave(next);
                });
                row = { element, input, name, balance, pending, status };
                rows.set(wallet.name, row);
            }
            row.name.textContent = wallet.name || 'Default wallet';
            row.input.checked = selected.has(wallet.name);
            row.input.disabled = !preferences || (!selected.has(wallet.name) && !['ready', 'scanning'].includes(wallet.state));
            row.element.classList.toggle('current', wallet.name === currentName);
            row.balance.textContent = `Balance: ${formatAmount(wallet.balance_sats, unit)}`;
            row.pending.textContent = `Pending incoming: ${formatAmount(wallet.pending_incoming_sats, unit)}`;
            row.status.textContent = rowStatus(wallet);
            const existing = list.children[index];
            if (existing !== row.element) list.insertBefore(row.element, existing || null);
        });
        const empty = popup.querySelector('.wallet-options-empty');
        if (empty) {
            empty.textContent = catalogState === 'loading' ? 'Loading wallets…' : catalogState === 'empty'
                ? 'No loaded watch-only wallets.' : 'Wallet data unavailable. Check wallet RPC access on your node.';
            empty.toggleAttribute('hidden', ordered.length > 0);
        }
        const unitInput = /** @type {HTMLSelectElement | null} */ (popup.querySelector('#wallet-unit'));
        const speedInput = /** @type {HTMLSelectElement | null} */ (popup.querySelector('#wallet-rotation'));
        const pauseInput = /** @type {HTMLInputElement | null} */ (popup.querySelector('#wallet-paused'));
        if (unitInput) { unitInput.disabled = !preferences; unitInput.value = unit; }
        if (speedInput) { speedInput.disabled = !preferences; speedInput.value = String(preferences?.rotation_seconds || 8); }
        if (pauseInput) { pauseInput.disabled = !preferences; pauseInput.checked = preferences?.paused || false; }
        for (const control of popup.querySelectorAll('button[data-wallet-step]')) {
            /** @type {HTMLButtonElement} */ (control).disabled = available().length < 2;
        }
        const result = popup.querySelector('.wallet-options-result');
        if (result) result.textContent = saveError || message || (saving ? 'Saving…' : '');
        positionPopup();
    }

    function render() { renderButton(); renderPopup(); }

    function scheduleRotation() {
        if (rotationTimer !== null && initialized && state.authenticated && !document.hidden
            && preferences?.rotation_seconds === rotationSeconds) return;
        if (rotationTimer !== null) clock.clearInterval(rotationTimer);
        rotationTimer = null;
        rotationSeconds = 0;
        if (!initialized || !state.authenticated || document.hidden || !preferences) return;
        rotationSeconds = preferences.rotation_seconds;
        rotationTimer = clock.setInterval(() => {
            if (masked || popup || hovered || focused || preferences?.paused || motion?.matches) return;
            step(1);
        }, preferences.rotation_seconds * 1000);
    }

    /** @param {number} direction */
    function step(direction) {
        currentName = nextWallet(available().map(wallet => wallet.name), currentName, direction);
        render();
    }

    async function readPreferences() {
        if (preferenceRead) return preferenceRead;
        const current = generation;
        const edit = editRevision;
        const task = (async () => {
            try {
                const response = /** @type {PreferencesResponse} */ (await getAdminJson('/api/wallets/preferences', { signal: reads.signal }, 20000));
                if (!isCurrent(current) || response.revision < preferenceRevision) return;
                preferenceRevision = response.revision;
                committed = copyPreferences(response.preferences);
                if (!saving && edit === editRevision) preferences = copyPreferences(response.preferences);
                message = '';
                render();
                scheduleRotation();
            } catch (error) {
                if (!isCurrent(current)) return;
                message = errorMessage(error);
                wallets = wallets.map(wallet => ({ ...wallet, state: 'unavailable', balance_sats: null,
                    pending_incoming_sats: null, immature_sats: null }));
                catalogState = 'unavailable';
                render();
                throw error;
            } finally { if (generation === current) preferenceRead = null; }
        })();
        preferenceRead = task;
        return task;
    }

    async function readWallets() {
        if (walletRead) return walletRead;
        const current = generation;
        const task = (async () => {
            try {
                const response = /** @type {WalletSnapshot} */ (await getAdminJson('/api/wallets', { signal: reads.signal }, 20000));
                if (!isCurrent(current)) return;
                wallets = response.wallets;
                catalogState = response.state;
                message = response.reason || '';
                render();
            } catch (error) {
                if (!isCurrent(current)) return;
                wallets = wallets.map(wallet => ({ ...wallet, state: 'unavailable', balance_sats: null,
                    pending_incoming_sats: null, immature_sats: null }));
                catalogState = 'unavailable';
                message = errorMessage(error);
                render();
            } finally { if (generation === current) walletRead = null; }
        })();
        walletRead = task;
        return task;
    }

    async function refresh() {
        if (!initialized || !state.authenticated || document.hidden || masked) return;
        try {
            await readPreferences();
            if (state.authenticated && !document.hidden && !masked && (popup || preferences?.selected_wallets.length)) await readWallets();
        } catch { /* The owner renders a local error; background work never prompts. */ }
    }

    /** @param {Preferences} next */
    function queueSave(next) {
        if (!state.authenticated || !committed) return;
        preferences = copyPreferences(next);
        queuedSave = copyPreferences(next);
        editRevision++;
        message = '';
        saveError = '';
        render();
        scheduleRotation();
        if (saving) return;
        const current = generation;
        const task = (async () => {
            while (queuedSave && isCurrent(current)) {
                const requested = queuedSave;
                queuedSave = null;
                const edit = editRevision;
                try {
                    const response = /** @type {PreferencesResponse} */ (await postAdminJson('/api/wallets/preferences', requested, { signal: reads.signal }, 20000));
                    if (!isCurrent(current)) return;
                    if (response.revision >= preferenceRevision) {
                        preferenceRevision = response.revision;
                        committed = copyPreferences(response.preferences);
                    }
                    if (edit === editRevision && committed) preferences = copyPreferences(committed);
                    saveError = '';
                } catch (error) {
                    if (!isCurrent(current)) return;
                    if (edit === editRevision && committed) preferences = copyPreferences(committed);
                    saveError = `Could not save wallet settings: ${errorMessage(error)}`;
                }
                render();
                scheduleRotation();
            }
        })().finally(() => {
            if (generation !== current) return;
            saving = null;
            renderPopup();
            if (preferences?.selected_wallets.length || popup) void readWallets();
        });
        saving = task;
        renderPopup();
    }

    function openPopup() {
        if (popup || !state.authenticated || masked) return;
        popup = document.createElement('section');
        popup.id = 'wallet-options';
        popup.className = 'wallet-options';
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-labelledby', 'wallet-options-title');
        popup.innerHTML = '<div class="wallet-options-heading"><strong id="wallet-options-title">Wallets</strong><button type="button" class="wallet-options-close" aria-label="Close wallet options">×</button></div>'
            + '<p class="wallet-options-help">Balance follows your node’s trusted balance. Pending incoming funds are shown separately.</p>'
            + '<div class="wallet-options-list"></div><p class="wallet-options-empty">Loading wallets…</p>'
            + '<div class="wallet-options-controls"><label>Display unit <select id="wallet-unit"><option value="BTC">BTC</option><option value="sats">sats</option></select></label>'
            + '<label>Rotate every <select id="wallet-rotation"><option value="5">5 seconds</option><option value="8">8 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label>'
            + '<label class="wallet-options-pause"><input type="checkbox" id="wallet-paused"> Pause rotation</label></div>'
            + '<div class="wallet-options-navigation"><button type="button" data-wallet-step="-1">Previous</button><button type="button" data-wallet-step="1">Next</button></div>'
            + '<p class="wallet-options-result" role="status"></p>';
        popup.querySelector('.wallet-options-close')?.addEventListener('click', () => closePopup(true));
        popup.querySelector('#wallet-unit')?.addEventListener('change', event => {
            if (!preferences) return;
            const value = /** @type {HTMLSelectElement} */ (event.target).value;
            if (value === 'BTC' || value === 'sats') queueSave({ ...copyPreferences(preferences), unit: value });
        });
        popup.querySelector('#wallet-rotation')?.addEventListener('change', event => {
            if (!preferences) return;
            const value = Number(/** @type {HTMLSelectElement} */ (event.target).value);
            if (value === 5 || value === 8 || value === 15 || value === 30) queueSave({ ...copyPreferences(preferences), rotation_seconds: value });
        });
        popup.querySelector('#wallet-paused')?.addEventListener('change', event => {
            if (preferences) queueSave({ ...copyPreferences(preferences), paused: /** @type {HTMLInputElement} */ (event.target).checked });
        });
        for (const control of popup.querySelectorAll('button[data-wallet-step]')) {
            control.addEventListener('click', () => step(Number(control.getAttribute('data-wallet-step'))));
        }
        document.body.append(popup);
        render();
        /** @type {HTMLButtonElement | null} */ (popup.querySelector('.wallet-options-close'))?.focus();
        void refresh();
    }

    async function click() {
        if (popup) { closePopup(true); return; }
        const current = generation;
        try {
            if (!state.authenticated) await management.unlock();
            if (!initialized || (!state.authenticated && generation !== current)) return;
            openPopup();
        } catch { /* Cancelling the explicit unlock leaves the ticker locked. */ }
    }

    /** @param {ReturnType<Management['getState']>} next */
    function onManagement(next) {
        const changed = state.revision !== next.revision || state.authenticated !== next.authenticated;
        state = next;
        if (changed || !next.authenticated) wipe();
        masked = document.hidden;
        render();
        if (next.authenticated && !document.hidden) {
            if (pollTimer === null) pollTimer = clock.setInterval(() => { void refresh(); }, 30000);
            scheduleRotation();
            void refresh();
        }
    }

    /** @param {PointerEvent} event */
    function onOutside(event) {
        const target = /** @type {Node | null} */ (event.target);
        if (popup && target && !popup.contains(target) && !button?.contains(target)) closePopup();
    }

    /** @param {KeyboardEvent} event */
    function onKey(event) {
        if (popup && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePopup(true); }
    }

    function onHover() { hovered = true; }
    function onLeave() { hovered = false; }
    function onFocus() { focused = true; }
    function onBlur() { focused = false; }
    function onPageHide() { wipe(); masked = true; renderButton(); }
    async function onVisibility() {
        masked = true;
        stopTimers();
        closePopup();
        renderButton();
        if (document.hidden || !state.authenticated) return;
        try {
            if (await management.revalidate()) {
                if (!initialized || document.hidden) return;
                masked = false;
                render();
                if (pollTimer === null) pollTimer = clock.setInterval(() => { void refresh(); }, 30000);
                scheduleRotation();
                void refresh();
            }
        } catch { /* Remain masked until management is revalidated. */ }
    }

    function init() {
        if (initialized) return;
        initialized = true;
        button = /** @type {HTMLButtonElement | null} */ (document.getElementById('wallet-ticker'));
        amount = button?.querySelector('.wallet-ticker-amount') || null;
        if (!button || !amount) { initialized = false; return; }
        button.addEventListener('click', click);
        button.addEventListener('mouseenter', onHover);
        button.addEventListener('mouseleave', onLeave);
        button.addEventListener('focus', onFocus);
        button.addEventListener('blur', onBlur);
        document.addEventListener('pointerdown', onOutside);
        document.addEventListener('keydown', onKey);
        document.addEventListener('visibilitychange', onVisibility);
        view?.addEventListener('resize', fitHeader);
        view?.addEventListener('pagehide', onPageHide);
        view?.addEventListener('pageshow', onVisibility);
        motion?.addEventListener('change', renderButton);
        if (view?.ResizeObserver) {
            resizeObserver = new view.ResizeObserver(fitHeader);
            for (const element of document.querySelectorAll('.topbar-left, .topbar-right, .topbar-center')) resizeObserver.observe(element);
        }
        unsubscribe = management.subscribe(onManagement);
    }

    function dispose() {
        if (!initialized) return;
        initialized = false;
        unsubscribe?.(); unsubscribe = null;
        resizeObserver?.disconnect(); resizeObserver = null;
        button?.removeEventListener('click', click);
        button?.removeEventListener('mouseenter', onHover);
        button?.removeEventListener('mouseleave', onLeave);
        button?.removeEventListener('focus', onFocus);
        button?.removeEventListener('blur', onBlur);
        document.removeEventListener('pointerdown', onOutside);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
        view?.removeEventListener('resize', fitHeader);
        view?.removeEventListener('pagehide', onPageHide);
        view?.removeEventListener('pageshow', onVisibility);
        motion?.removeEventListener('change', renderButton);
        wipe();
        if (button) button.hidden = true;
    }

    return Object.freeze({ init, dispose });
}
