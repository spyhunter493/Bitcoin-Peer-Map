import { query, queryAll } from '../core/dom.js';

/** @typedef {{container: HTMLElement | null; title: HTMLElement | null; lensToggle: HTMLElement | null; panel: HTMLElement | null}} ControlElements */

/** Own the distribution's persistent controls and their DOM listener lifecycle.
 * @param {{
 * document: Document;
 * state: ReturnType<typeof import('./state.js').create>;
 * donut: ReturnType<typeof import('./donut.js').create>;
 * getNavigation(): import('../types').DistributionNavigation;
 * getElements(): ControlElements;
 * onElements(elements: ControlElements): void;
 * updateLensChrome(): void;
 * renderCenter(): void;
 * }} options
 */
export function create(options) {
    const document = options.document;
    const state = options.state;
    /** @type {Array<() => void>} */
    const removals = [];
    /** @type {MutationObserver | null} */
    let observer = null;
    let initialized = false;

    /** @param {EventTarget | null} target
     * @param {string} type
     * @param {EventListener} listener
     * @param {boolean} [capture]
     */
    function listen(target, type, listener, capture = false) {
        if (!target) return;
        target.addEventListener(type, listener, capture);
        removals.push(() => target.removeEventListener(type, listener, capture));
    }

    function init() {
        if (initialized) return;
        initialized = true;
        options.onElements({
            container: document.getElementById('as-distribution-container'),
            title: document.getElementById('as-donut-title'),
            lensToggle: document.getElementById('as-lens-toggle'),
            panel: document.getElementById('as-detail-panel'),
        });
        const { container, title, lensToggle, panel } = options.getElements();
        const Element = document.defaultView?.Element;
        listen(panel, 'click', event => {
            const row = Element && event.target instanceof Element
                ? /** @type {HTMLElement | null} */ (event.target.closest('[data-filter]')) : null;
            if (row) options.getNavigation().setFilterDescriptor(JSON.parse(row.dataset.filter || 'null'));
        }, true);

        const focusedClose = document.getElementById('as-focused-close');
        const overview = document.getElementById('as-overview-trigger');
        listen(overview, 'click', event => {
            event.stopPropagation();
            if (state.donutFocused) options.getNavigation().navigateBack();
            else options.getNavigation().enterFocusedMode();
            query('.as-detail-close', options.getElements().panel)?.focus({ preventScroll: true });
        });
        const Observer = document.defaultView?.MutationObserver;
        if (Observer) {
            observer = new Observer(() => overview?.setAttribute('aria-expanded', String(state.donutFocused)));
            observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
        options.donut.init({
            wrap: document.getElementById('as-donut-wrap'),
            svg: document.getElementById('as-donut'),
            center: document.getElementById('as-donut-center'),
            legend: document.getElementById('as-legend'),
            loading: container ? query('.as-loading', container) : null,
            insight: document.getElementById('as-insight-rect'),
        });

        const center = options.donut.getCenterElement();
        for (const element of [title, center]) {
            listen(element, 'mouseenter', () => options.getNavigation().onTitleEnter());
            listen(element, 'mouseleave', () => options.getNavigation().onTitleLeave());
            listen(element, 'click', event => {
                event.stopPropagation();
                if (!state.donutFocused) options.getNavigation().enterFocusedMode();
            });
        }
        listen(focusedClose, 'click', event => {
            event.stopPropagation();
            options.getNavigation().exitFocusedMode();
        });

        if (lensToggle) {
            const lensButtons = queryAll('.as-lens-btn', lensToggle);
            listen(lensToggle, 'keydown', input => {
                const event = /** @type {KeyboardEvent} */ (input);
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                const current = lensButtons.findIndex(button => button === event.target);
                if (current < 0) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? lensButtons.length - 1
                    : (current + (event.key === 'ArrowRight' ? 1 : lensButtons.length - 1)) % lensButtons.length;
                options.getNavigation().setDistributionLens(lensButtons[next].dataset.lens || '');
                lensButtons[next].focus({ preventScroll: true });
            });
            for (const button of lensButtons) {
                listen(button, 'click', event => {
                    event.stopPropagation();
                    options.getNavigation().setDistributionLens(
                        Element && event.currentTarget instanceof Element ? event.currentTarget.getAttribute('data-lens') || '' : ''
                    );
                });
            }
        }

        listen(query('.as-detail-close', panel), 'click', () => {
            if (state.donutFocused) options.getNavigation().exitFocusedMode();
            else options.getNavigation().deselect();
        });
        listen(panel, 'click', () => {
            document.body.classList.add('panel-focus-as');
            document.body.classList.remove('panel-focus-peers');
        });
        listen(document, 'keydown', event => options.getNavigation().onKeyDown(/** @type {KeyboardEvent} */ (event)));
        listen(document, 'mouseleave', () => {
            if (state.hoveredProvider && !state.subTooltipPinned) options.getNavigation().onSegmentLeave();
            if (state.focusedHoverProvider && !state.selectedProvider) {
                options.getNavigation().clearFocusedHover();
                options.renderCenter();
            }
        });
        options.updateLensChrome();
    }

    function dispose() {
        for (const remove of removals.splice(0)) remove();
        observer?.disconnect();
        observer = null;
        initialized = false;
    }

    return Object.freeze({ init, dispose });
}
