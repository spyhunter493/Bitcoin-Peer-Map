/* Retain local scroll and keyboard focus when a view replaces its content. */
(function (global) {
    'use strict';
    function key(element) {
        if (element.id) return '#' + element.id;
        const attributes = ['data-peer-id', 'data-as', 'data-filter', 'data-category', 'data-cat-label', 'data-insight-type'];
        return element.tagName + ':' + String(element.className).split(' ').filter(name => !['sub-filter-active', 'pn-sub-filter-active', 'as-provider-row-selected', 'as-sub-tt-peer-selected'].includes(name)).join(' ') + ':' + attributes.map(name => element.getAttribute(name) || '').join('|');
    }
    function capture(element) {
        if (!element) return () => {};
        const nodes = [element, ...element.querySelectorAll('*')];
        const scroll = nodes.filter(node => node.scrollTop || node.scrollLeft).map(node => [key(node), node.scrollTop, node.scrollLeft]);
        const focused = element.contains(document.activeElement) ? key(document.activeElement) : null;
        const expanded = !!element.querySelector('.as-sub-tt-expanded');
        return () => {
            const current = [element, ...element.querySelectorAll('*')];
            if (expanded) {
                element.querySelector('.as-sub-tt-scroll')?.classList.add('as-sub-tt-expanded');
                element.querySelectorAll('.as-sub-tt-peer-extra').forEach(node => { node.style.display = ''; });
                const more = element.querySelector('.as-sub-tt-show-more'), less = element.querySelector('.as-sub-tt-show-less');
                if (more) more.style.display = 'none';
                if (less) less.style.display = '';
            }
            if (focused) current.find(node => key(node) === focused)?.focus({ preventScroll: true });
            for (const [id, top, left] of scroll) {
                const node = current.find(node => key(node) === id);
                if (node) { node.scrollTop = top; node.scrollLeft = left; }
            }
        };
    }
    global.BPMDomState = Object.freeze({ key, capture });
})(window);
