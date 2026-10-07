import type { PrivatePanelOptions } from '../types';
import type { create as createDashboard } from '../core/dashboard-state.js';
import type { create as createLifecycle } from '../core/lifecycle.js';
import type { create as createView } from './private-panel-view.js';
export interface PanelEnvironment extends PrivatePanelOptions {
    dashboard: ReturnType<typeof createDashboard>;
    document: Document;
    lifecycle: ReturnType<typeof createLifecycle>;
    nowSeconds: () => number;
}
export interface PanelViewOptions extends PanelEnvironment {
    bindings: {
        detail(body: HTMLElement, peers: import('../types').Peer[]): void;
        overview(body: HTMLElement, peers: import('../types').Peer[]): void;
        insight(root: HTMLElement): void;
        hidePopover(): void;
    };
}
export interface PanelControlsOptions extends PanelEnvironment {
    view: ReturnType<typeof createView>;
}
export interface NetworkEnvironment {
    dashboard: ReturnType<typeof createDashboard>;
    document: Document;
    lifecycle: ReturnType<typeof createLifecycle>;
    mapView: import('../types').MapView;
    onAction(action: import('../types').PrivateNetworkAction): void;
    panel: ReturnType<typeof import('./private-panel.js').create>;
}
export interface NetworkViewOptions extends NetworkEnvironment {
    bindings: {
        big(svg: SVGElement): void;
        mini(svg: HTMLElement, legend: HTMLElement | null, segments: {net: string; count: number; color: string}[], total: number): void;
    };
}
export interface NetworkControlsOptions extends NetworkEnvironment {
    distribution: ReturnType<typeof import('../distribution/controller.js').create>;
    settings: import('../types').AdvancedSettings;
    view: ReturnType<typeof import('./private-network-view.js').create>;
    privatePopup: ReturnType<typeof import('./detail.js').create>;
}
