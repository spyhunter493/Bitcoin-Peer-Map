import * as modal from './modal.js';

const BITCOIN_ADDRESS = 'bc1qnngus06lk0e60e05yq902e9edx7kt4kcuuuy72';
/** @type {ReturnType<typeof modal.open> | null} */
let currentDialog = null;

/** Open the project's Bitcoin support details without contacting a service. */
export function open() {
    const revision = encodeURIComponent(document.body.dataset.assetRevision || '');
    const dialog = modal.open({
        id: 'support-modal',
        title: 'Support Bitcoin Peer Map',
        maxWidth: 420,
        onClose() { currentDialog = null; },
        initialHtml: `<div class="support-dialog">
            <p class="support-description">Send Bitcoin to support development of Bitcoin Peer Map.</p>
            <img id="support-qr" class="support-qr" src="/static/assets/support-bitcoin-qr.svg?v=${revision}" width="196" height="196" alt="Bitcoin support address QR code">
            <label for="support-address">Bitcoin address</label>
            <textarea id="support-address" class="support-address" aria-label="Bitcoin address" readonly rows="2" spellcheck="false">${BITCOIN_ADDRESS}</textarea>
            <div class="support-actions">
                <button type="button" id="support-copy" class="support-copy">Copy address</button>
                <a id="support-wallet" class="support-wallet" href="bitcoin:${BITCOIN_ADDRESS}">Open wallet</a>
            </div>
            <p id="support-status" class="support-status" role="status" aria-live="polite" aria-atomic="true"></p>
        </div>`,
    });
    currentDialog = dialog;
    const copy = /** @type {HTMLButtonElement} */ (dialog.body.querySelector('#support-copy'));
    const address = /** @type {HTMLTextAreaElement} */ (dialog.body.querySelector('#support-address'));
    const status = /** @type {HTMLElement} */ (dialog.body.querySelector('#support-status'));
    copy.addEventListener('click', async () => {
        copy.disabled = true;
        status.textContent = '';
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(BITCOIN_ADDRESS);
            if (dialog.isOpen()) status.textContent = 'Bitcoin address copied.';
        } catch {
            if (!dialog.isOpen()) return;
            address.focus();
            address.select();
            status.textContent = 'Copy unavailable. The Bitcoin address is selected; copy it manually.';
        } finally {
            if (dialog.isOpen()) copy.disabled = false;
        }
    }, { signal: dialog.signal });
}

/** Bind the persistent header entry point once, during page startup. */
export function init() {
    document.getElementById('support-button')?.addEventListener('click', open);
}

/** Close the support dialog when the viewing document is cleared. */
export function close() {
    currentDialog?.close(false);
}
