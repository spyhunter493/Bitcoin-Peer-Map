import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from '../../src/static/js/distribution/controls.js';
import { create as createState } from '../../src/static/js/distribution/state.js';

class ElementStub {
    constructor(id) {
        this.id = id;
        this.dataset = {};
        this.attributes = new Map();
        this.listeners = [];
        this.children = new Map();
        this.focuses = [];
        const classes = new Set();
        this.classList = {
            add: (...values) => values.forEach(value => classes.add(value)),
            remove: (...values) => values.forEach(value => classes.delete(value)),
            contains: value => classes.has(value),
        };
    }
    addEventListener(type, callback, capture = false) { this.listeners.push({ type, callback, capture }); }
    removeEventListener(type, callback, capture = false) {
        this.listeners = this.listeners.filter(listener => !(listener.type === type && listener.callback === callback && listener.capture === capture));
    }
    querySelector(selector) { return this.children.get(selector)?.[0] || null; }
    querySelectorAll(selector) { return this.children.get(selector) || []; }
    getAttribute(name) { return name === 'data-lens' ? this.dataset.lens || null : this.attributes.get(name) || null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    closest(selector) { return selector === '[data-filter]' && this.dataset.filter ? this : null; }
    focus(options) { this.focuses.push(options); }
    emit(type, values = {}) {
        const event = {
            type, target: this, currentTarget: this, stopped: false, prevented: false,
            stopPropagation() { this.stopped = true; },
            preventDefault() { this.prevented = true; },
            ...values,
        };
        this.listeners.filter(listener => listener.type === type)
            .sort((a, b) => Number(b.capture) - Number(a.capture))
            .forEach(listener => listener.callback(event));
        return event;
    }
}

function fixture({ missing = false } = {}) {
    const ids = ['as-distribution-container', 'as-donut-title', 'as-lens-toggle', 'as-detail-panel',
        'as-focused-close', 'as-overview-trigger', 'as-donut-wrap', 'as-donut', 'as-donut-center', 'as-legend', 'as-insight-rect'];
    const nodes = new Map(missing ? [] : ids.map(id => [id, new ElementStub(id)]));
    const document = new ElementStub('document');
    document.body = new ElementStub('body');
    document.getElementById = id => nodes.get(id) || null;
    const observers = [];
    document.defaultView = {
        Element: ElementStub,
        MutationObserver: class {
            constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
            observe(target, options) { this.target = target; this.options = options; }
            disconnect() { this.disconnected = true; }
            tick() { if (!this.disconnected) this.callback(); }
        },
    };
    const panelClose = new ElementStub('panel-close');
    const loading = new ElementStub('loading');
    const buttons = ['provider', 'country'].map(lens => {
        const button = new ElementStub(lens);
        button.dataset.lens = lens;
        return button;
    });
    nodes.get('as-lens-toggle')?.children.set('.as-lens-btn', buttons);
    nodes.get('as-detail-panel')?.children.set('.as-detail-close', [panelClose]);
    nodes.get('as-distribution-container')?.children.set('.as-loading', [loading]);
    const state = createState();
    const calls = [], initializedDonuts = [], cached = [];
    let elements = { container: null, title: null, lensToggle: null, panel: null };
    let navigation;
    const controls = create({
        document, state,
        getElements: () => elements,
        onElements: next => { elements = next; cached.push(next); },
        getNavigation: () => { assert.ok(navigation, 'Navigation must be resolved after composition'); return navigation; },
        donut: {
            init: next => initializedDonuts.push(next),
            getCenterElement: () => initializedDonuts.at(-1)?.center || null,
        },
        updateLensChrome: () => calls.push(['chrome']),
        renderCenter: () => calls.push(['center']),
    });
    const setNavigation = () => {
        navigation = Object.fromEntries(['navigateBack', 'enterFocusedMode', 'exitFocusedMode', 'onTitleEnter',
            'onTitleLeave', 'setDistributionLens', 'setFilterDescriptor', 'deselect', 'onKeyDown', 'onSegmentLeave',
            'clearFocusedHover'].map(name => [name, (...args) => {
                calls.push([name, ...args]);
                if (name === 'enterFocusedMode') state.donutFocused = true;
                if (name === 'exitFocusedMode') state.donutFocused = false;
                if (name === 'clearFocusedHover') state.focusedHoverProvider = null;
            }]));
    };
    return { controls, document, state, nodes, panelClose, buttons, loading, calls, observers, initializedDonuts, cached,
        setNavigation, get elements() { return elements; },
        allTargets: () => [...nodes.values(), ...buttons, panelClose, document],
    };
}

test('initialization is idempotent and binds the injected document before navigation exists', () => {
    const f = fixture();
    f.controls.init();
    const registrations = f.allTargets().map(target => target.listeners.length);
    f.controls.init();
    assert.deepEqual(f.allTargets().map(target => target.listeners.length), registrations);
    assert.equal(f.cached.length, 1);
    assert.equal(f.initializedDonuts.length, 1);
    assert.equal(f.observers.length, 1);
    assert.deepEqual(f.calls, [['chrome']]);
    assert.equal(f.elements.panel, f.nodes.get('as-detail-panel'));
    assert.equal(f.initializedDonuts[0].loading, f.loading);
    assert.equal(f.initializedDonuts[0].center, f.nodes.get('as-donut-center'));
    assert.equal(f.observers[0].target, f.document.body);
    assert.deepEqual(f.observers[0].options, { attributes: true, attributeFilter: ['class'] });
});

test('overview, title, and center preserve focus entry, hover, and back behavior', () => {
    const f = fixture();
    f.controls.init();
    f.setNavigation();
    const overview = f.nodes.get('as-overview-trigger');
    assert.equal(overview.emit('click').stopped, true);
    assert.equal(f.state.donutFocused, true);
    assert.deepEqual(f.panelClose.focuses, [{ preventScroll: true }]);
    f.observers[0].tick();
    assert.equal(overview.attributes.get('aria-expanded'), 'true');
    overview.emit('click');
    assert.equal(f.calls.at(-1)[0], 'navigateBack');
    for (const id of ['as-donut-title', 'as-donut-center']) {
        const target = f.nodes.get(id);
        target.emit('mouseenter');
        target.emit('mouseleave');
        assert.deepEqual(f.calls.slice(-2), [['onTitleEnter'], ['onTitleLeave']]);
        const count = f.calls.length;
        target.emit('click');
        assert.equal(f.calls.length, count, 'Already focused title/center clicks do not re-enter');
        f.state.donutFocused = false;
        assert.equal(target.emit('click').stopped, true);
        assert.equal(f.calls.at(-1)[0], 'enterFocusedMode');
    }
});

test('lens keyboard navigation wraps and focuses the destination without changing unrelated keys', () => {
    const f = fixture();
    f.controls.init();
    f.setNavigation();
    const toggle = f.nodes.get('as-lens-toggle');
    for (const [key, current, destination] of [['ArrowRight', 0, 1], ['ArrowRight', 1, 0],
        ['ArrowLeft', 0, 1], ['ArrowLeft', 1, 0], ['Home', 1, 0], ['End', 0, 1]]) {
        const event = toggle.emit('keydown', { key, target: f.buttons[current] });
        assert.equal(event.prevented, true);
        assert.deepEqual(f.calls.at(-1), ['setDistributionLens', f.buttons[destination].dataset.lens]);
        assert.deepEqual(f.buttons[destination].focuses.at(-1), { preventScroll: true });
    }
    const count = f.calls.length;
    assert.equal(toggle.emit('keydown', { key: 'Tab', target: f.buttons[0] }).prevented, false);
    assert.equal(toggle.emit('keydown', { key: 'ArrowRight', target: toggle }).prevented, false);
    assert.equal(f.calls.length, count);
    assert.equal(f.buttons[1].emit('click').stopped, true);
    assert.deepEqual(f.calls.at(-1), ['setDistributionLens', 'country']);
});

test('panel filters run during capture and close actions distinguish focused from selected views', () => {
    const f = fixture();
    f.controls.init();
    f.setNavigation();
    const panel = f.nodes.get('as-detail-panel');
    const row = new ElementStub('row');
    row.dataset.filter = JSON.stringify({ kind: 'direction', direction: 'IN' });
    assert.equal(panel.listeners[0].capture, true);
    f.document.body.classList.add('panel-focus-peers');
    panel.emit('click', { target: row });
    assert.deepEqual(f.calls.at(-1), ['setFilterDescriptor', { kind: 'direction', direction: 'IN' }]);
    assert.equal(f.document.body.classList.contains('panel-focus-as'), true);
    assert.equal(f.document.body.classList.contains('panel-focus-peers'), false);
    f.panelClose.emit('click');
    assert.equal(f.calls.at(-1)[0], 'deselect');
    f.state.donutFocused = true;
    f.panelClose.emit('click');
    assert.equal(f.calls.at(-1)[0], 'exitFocusedMode');
    f.state.donutFocused = true;
    assert.equal(f.nodes.get('as-focused-close').emit('click').stopped, true);
    assert.equal(f.calls.at(-1)[0], 'exitFocusedMode');
});

test('document leave preserves pinned and selected previews and restores unselected center after clearing hover', () => {
    const f = fixture();
    f.controls.init();
    f.setNavigation();
    f.state.hoveredProvider = 'AS1';
    f.state.focusedHoverProvider = 'AS2';
    f.document.emit('mouseleave');
    assert.deepEqual(f.calls.slice(-3), [['onSegmentLeave'], ['clearFocusedHover'], ['center']]);
    assert.equal(f.state.focusedHoverProvider, null);
    f.state.focusedHoverProvider = 'AS2';
    f.state.subTooltipPinned = true;
    f.state.selectedProvider = 'AS3';
    const count = f.calls.length;
    f.document.emit('mouseleave');
    assert.equal(f.calls.length, count);
    const event = f.document.emit('keydown', { key: 'Escape' });
    assert.deepEqual(f.calls.at(-1), ['onKeyDown', event]);
});

test('dispose removes all captured and bubbling callbacks, disconnects the observer, and permits a clean re-init', () => {
    const f = fixture();
    f.controls.init();
    f.setNavigation();
    const oldObserver = f.observers[0];
    const initialRegistrations = f.allTargets().map(target => target.listeners.length);
    f.controls.dispose();
    f.controls.dispose();
    assert.equal(f.allTargets().every(target => target.listeners.length === 0), true);
    assert.equal(oldObserver.disconnected, true);
    const count = f.calls.length;
    for (const target of f.allTargets()) {
        target.emit('click');
        target.emit('mouseenter');
        target.emit('mouseleave');
        target.emit('keydown', { key: 'Escape' });
    }
    assert.equal(f.calls.length, count, 'Disposed controls cannot change state or navigation');
    f.controls.init();
    assert.deepEqual(f.allTargets().map(target => target.listeners.length), initialRegistrations);
    assert.equal(f.observers.length, 2);
    assert.equal(f.cached.length, 2);
    assert.equal(f.initializedDonuts.length, 2);
    f.nodes.get('as-overview-trigger').emit('click');
    assert.equal(f.calls.filter(([name]) => name === 'enterFocusedMode').length, 1);
});

test('missing optional distribution elements still allow document keyboard bindings and disposal', () => {
    const f = fixture({ missing: true });
    f.controls.init();
    f.setNavigation();
    assert.deepEqual(f.elements, { container: null, title: null, lensToggle: null, panel: null });
    f.document.emit('keydown', { key: 'Escape' });
    assert.equal(f.calls.at(-1)[0], 'onKeyDown');
    f.controls.dispose();
    assert.equal(f.document.listeners.length, 0);
});
