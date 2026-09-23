import { query, queryAll } from './dom.js';

/**
 * @param {Element} element
 */
function key(element) {
    if (element.id) return '#' + element.id;
    const attributes = ['data-peer-id', 'data-as', 'data-filter', 'data-category', 'data-cat-label', 'data-insight-type'];
    return (
        element.tagName +
        ':' +
        String(element.className)
            .split(' ')
            .filter(
                (name) =>
                    !['sub-filter-active', 'pn-sub-filter-active', 'as-provider-row-selected', 'as-sub-tt-peer-selected'].includes(name)
            )
            .join(' ') +
        ':' +
        attributes.map((name) => element.getAttribute(name) || '').join('|')
    );
}
/**
 * @param {HTMLElement | null} element
 */
function capture(element) {
    if (!element) return () => {};
    const nodes = [element, ...queryAll('*', element)];
    /** @type {[string, number, number][]} */
    const scroll = nodes.filter((node) => node.scrollTop || node.scrollLeft).map((node) => [key(node), node.scrollTop, node.scrollLeft]);
    const focused = document.activeElement && element.contains(document.activeElement) ? key(document.activeElement) : null;
    const expanded = !!query('.as-sub-tt-expanded', element);
    return () => {
        const current = [element, ...queryAll('*', element)];
        if (expanded) {
            query('.as-sub-tt-scroll', element)?.classList.add('as-sub-tt-expanded');
            queryAll('.as-sub-tt-peer-extra', element).forEach((node) => {
                node.style.display = '';
            });
            const more = query('.as-sub-tt-show-more', element),
                less = query('.as-sub-tt-show-less', element);
            if (more) more.style.display = 'none';
            if (less) less.style.display = '';
        }
        if (focused) current.find((node) => key(node) === focused)?.focus({ preventScroll: true });
        for (const [id, top, left] of scroll) {
            const node = current.find((node) => key(node) === id);
            if (node) {
                node.scrollTop = top;
                node.scrollLeft = left;
            }
        }
    };
}
export { key };
export { capture };
