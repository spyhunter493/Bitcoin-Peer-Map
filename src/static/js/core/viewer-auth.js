import { configureViewingAuthentication, requestJson, errorMessage } from './api.js';

/** @param {{onAuthorized(): void | Promise<void>, onLock(): void}} options */
export function create(options) {
    let token = '', mode = 'authenticated', resetting = false;
    let reads = new AbortController();
    const requests = new AbortController();
    /** @type {ReturnType<typeof setInterval> | null} */
    let aggregateTimer = null;
    /** @type {HTMLElement | null} */
    let accessPanel = null;
    /** @type {HTMLInputElement | null} */
    let tokenInput = null;

    /** Locking destroys the detailed document rather than reviving its old state.
     * @param {boolean} [navigate] */
    function lock(navigate = true) {
        if (resetting && navigate) { location.replace('/'); return; }
        if (resetting) return;
        resetting = true;
        token = '';
        if (tokenInput) tokenInput.value = '';
        reads.abort(new DOMException('Viewing locked', 'AbortError'));
        requests.abort();
        if (aggregateTimer !== null) clearInterval(aggregateTimer);
        configureViewingAuthentication(null);
        try { options.onLock(); }
        catch { /* A failed component cleanup must still destroy the private view. */ }
        finally {
            document.body.replaceChildren();
            const notice = document.createElement('p');
            notice.id = 'view-reset-notice';
            notice.className = 'view-access';
            notice.textContent = 'Viewing locked. Reopening the access page…';
            document.body.append(notice);
            if (navigate) location.replace('/');
        }
    }

    async function authorize() {
        configureViewingAuthentication({ getToken: () => token, getSignal: () => reads.signal,
            onAuthenticationFailure: () => lock() });
        accessPanel?.remove();
        accessPanel = null;
        document.body.classList.remove('view-locked');
        document.body.classList.add('view-unlocked');
        const lockButton = document.createElement('button');
        lockButton.id = 'view-lock';
        lockButton.className = 'admin-lock';
        lockButton.type = 'button';
        lockButton.textContent = 'Lock view';
        lockButton.addEventListener('click', () => lock());
        document.querySelector('.topbar-right')?.append(lockButton);
        if (aggregateTimer !== null) clearInterval(aggregateTimer);
        aggregateTimer = null;
        await options.onAuthorized();
    }

    /** @param {boolean} authenticationAvailable */
    function showAccess(authenticationAvailable) {
        document.body.classList.add('view-locked');
        accessPanel = document.createElement('section');
        accessPanel.id = 'view-access';
        accessPanel.className = 'view-access';
        accessPanel.setAttribute('aria-labelledby', 'view-access-title');
        accessPanel.innerHTML = '<h1 id="view-access-title">Bitcoin Peer Map</h1><p id="view-access-description">Enter a viewing or administrator token to view this dashboard.</p><div id="view-aggregate" hidden></div><form id="view-token-form"><label for="view-token-input">Viewing token</label><input id="view-token-input" type="password" class="connect-input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="256" required><div id="view-token-error" class="connect-result err" role="alert"></div><button id="view-token-submit" class="connect-btn" type="submit">Unlock view</button></form>';
        document.body.append(accessPanel);
        tokenInput = /** @type {HTMLInputElement} */ (accessPanel.querySelector('#view-token-input'));
        const input = tokenInput;
        const form = /** @type {HTMLFormElement} */ (accessPanel.querySelector('#view-token-form'));
        const submit = /** @type {HTMLButtonElement} */ (accessPanel.querySelector('#view-token-submit'));
        const error = /** @type {HTMLElement} */ (accessPanel.querySelector('#view-token-error'));
        let verifying = false;
        form.hidden = !authenticationAvailable;
        if (!authenticationAvailable) error.textContent = 'Viewing authentication is unavailable.';
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (verifying || !input.value || resetting) return;
            verifying = true;
            submit.disabled = true;
            const supplied = input.value;
            input.value = '';
            error.textContent = '';
            try {
                await requestJson('/api/view/verify', { method: 'POST', headers: { Authorization: `Bearer ${supplied}` }, signal: requests.signal });
                requests.signal.throwIfAborted();
                token = supplied;
                await authorize();
            } catch (failure) {
                if (requests.signal.aborted) return;
                error.textContent = errorMessage(failure);
                input.focus();
            } finally { verifying = false; submit.disabled = false; }
        });
        if (authenticationAvailable) input.focus();
    }

    async function refreshAggregate() {
        if (resetting || !accessPanel) return;
        const output = /** @type {HTMLElement} */ (accessPanel.querySelector('#view-aggregate'));
        output.hidden = false;
        try {
            /** @type {import('../../../shared/api.generated').ViewingAggregateResponse} */
            const summary = await requestJson('/api/view/aggregate', { signal: requests.signal, cache: 'no-store' });
            requests.signal.throwIfAborted();
            if (!accessPanel) return;
            output.replaceChildren();
            const status = document.createElement('p');
            status.textContent = `Node availability: ${summary.availability}`;
            output.append(status);
            const note = document.createElement('p');
            note.textContent = 'Counts are ranges of five from the cached peer snapshot. Connection gaps may retain earlier counts.';
            output.append(note);
            const list = document.createElement('dl');
            for (const [key, label] of /** @type {const} */ ([['ipv4', 'IPv4'], ['ipv6', 'IPv6'], ['onion', 'Tor'], ['i2p', 'I2P'], ['cjdns', 'CJDNS'], ['inbound', 'Inbound'], ['outbound', 'Outbound']])) {
                const count = key === 'inbound' || key === 'outbound' ? summary.directions[key] : summary.networks[key];
                const term = document.createElement('dt'), value = document.createElement('dd');
                term.textContent = label;
                value.textContent = `${count.min}–${count.max}`;
                list.append(term, value);
            }
            output.append(list);
        } catch {
            if (!requests.signal.aborted && accessPanel) output.textContent = 'Aggregate availability is unknown.';
        }
    }

    async function start() {
        globalThis.addEventListener('pagehide', () => { if (mode !== 'public') lock(false); });
        globalThis.addEventListener('pageshow', event => { if (event.persisted && mode !== 'public') lock(); });
        try {
            /** @type {{mode:'public'|'authenticated'|'redacted',authentication_available:boolean}} */
            const access = await requestJson('/api/access', { signal: requests.signal, cache: 'no-store' });
            requests.signal.throwIfAborted();
            if (!access || !['public', 'authenticated', 'redacted'].includes(access.mode)) throw new Error('Invalid access mode');
            mode = access.mode;
            if (mode === 'public') { await options.onAuthorized(); return; }
            showAccess(access.authentication_available);
            if (mode === 'redacted') {
                await refreshAggregate();
                if (!resetting && accessPanel) aggregateTimer = setInterval(() => { void refreshAggregate(); }, 10000);
            }
        } catch {
            if (requests.signal.aborted) return;
            document.body.replaceChildren();
            const failure = document.createElement('p');
            failure.className = 'view-access';
            failure.textContent = 'Dashboard access is unavailable. Reload to try again.';
            document.body.append(failure);
        }
    }

    return Object.freeze({ start, lock });
}
