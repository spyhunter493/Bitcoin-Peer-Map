/** Find an HTML element in a document or feature-owned subtree.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode | null} [root]
 * @returns {T | null}
 */
export function query(selector, root = document) {
    return root?.querySelector(selector) || null;
}

/** Require an element provided by the dashboard template or freshly rendered markup.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode | null} [root]
 * @returns {T}
 */
export function required(selector, root = document) {
    const element = /** @type {T | null} */ (root?.querySelector(selector) || null);
    if (!element) throw new Error(`Missing dashboard element: ${selector}`);
    return element;
}

/** @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode | null} [root]
 * @returns {T[]}
 */
export function queryAll(selector, root = document) {
    return Array.from(root?.querySelectorAll(selector) || []);
}

/** Find a delegated event's closest HTML control.
 * @param {string} selector
 * @param {EventTarget | null} element
 * @returns {HTMLElement | null}
 */
export function closest(selector, element) {
    return element instanceof Element ? element.closest(selector) : null;
}
