import { query } from './dom.js';

/** @param {import('../types').UpdateStatus | undefined} status @param {Document} [document] */
export function renderUpdateStatus(status, document = globalThis.document) {
    const link = /** @type {HTMLAnchorElement | null} */ (query('#revision-update', document));
    if (!link) return;
    link.hidden = !status?.update_available || !status.changes_url;
    if (link.hidden || !status?.changes_url) return;
    link.href = status.changes_url;
    const label = `Update available${status.latest_version ? ` — ${status.latest_version}` : ''}. View release notes on GitHub`;
    link.title = label;
    link.setAttribute('aria-label', label);
}
