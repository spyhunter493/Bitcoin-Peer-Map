import { query } from './dom.js';

/** @param {import('../types').UpdateStatus | undefined} status */
export function renderUpdateStatus(status) {
    const link = /** @type {HTMLAnchorElement | null} */ (query('#revision-update'));
    if (!link) return;
    link.hidden = !status?.update_available || !status.changes_url;
    if (link.hidden || !status?.changes_url) return;
    link.href = status.changes_url;
    const count = status.commits_behind;
    const label = `Update available${count ? ` — ${count} ${count === 1 ? 'commit' : 'commits'} behind` : ''}. View changes on GitHub`;
    link.title = label;
    link.setAttribute('aria-label', label);
}
