import type { NodeInfo, NodeRefreshState, NodeAction, NetworkDetails } from '../types';
import type { create as createDashboard } from '../core/dashboard-state.js';
import type { create as createLifecycle } from '../core/lifecycle.js';
import type * as API from '../core/api.js';
export interface ViewOptions {
    dashboard: ReturnType<typeof createDashboard>;
    document: Document;
    lifecycle: ReturnType<typeof createLifecycle>;
    nowSeconds: () => number;
    getNodeInfo(): NodeInfo | null;
    getRefreshState(): NodeRefreshState;
    ui: {
        counts: Record<string, {in: number; out: number}>;
        scores: Record<string, number | null>;
        networkDetails: Record<string, NetworkDetails>;
    };
}
export interface ControlsOptions {
    document: Document;
    lifecycle: ReturnType<typeof createLifecycle>;
    getNodeInfo(): NodeInfo | null;
    view: ReturnType<typeof import('./dashboard-view.js').create>;
    api: typeof API;
    storage: Pick<Storage, 'getItem' | 'setItem'> | null;
    fetchInfo(): Promise<void>;
    fetchPeers(): void;
    onAction(action: NodeAction): void | Promise<void>;
}
