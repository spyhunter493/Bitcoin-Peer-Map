export type OutboundFeature = 'geoip' | 'dataset' | 'updates' | 'probe';
export type OutboundPermissions = Readonly<Record<OutboundFeature, boolean>>;
const features: readonly OutboundFeature[] = ['geoip', 'dataset', 'updates', 'probe'];
type PolicyListener = (feature: OutboundFeature, allowed: boolean) => void;

/** Cancellation belongs to optional features, never the RPC/database lifetime. */
export class OutboundPolicy {
    private permissions: OutboundPermissions;
    private controllers: Record<OutboundFeature, AbortController>;
    private listeners = new Set<PolicyListener>();
    private closed = false;

    constructor(permissions: OutboundPermissions) {
        this.permissions = { ...permissions };
        this.controllers = { geoip: new AbortController(), dataset: new AbortController(), updates: new AbortController(), probe: new AbortController() };
        for (const feature of features) if (!permissions[feature]) this.controllers[feature].abort();
    }

    allowed(feature: OutboundFeature) { return !this.closed && this.permissions[feature]; }
    signal(feature: OutboundFeature) { return this.controllers[feature].signal; }

    update(permissions: OutboundPermissions) {
        if (this.closed) return;
        const changed = features.filter(feature => permissions[feature] !== this.permissions[feature]);
        this.permissions = { ...permissions };
        // Publish every signal before listeners restart work under the new policy.
        for (const feature of changed) {
            if (permissions[feature]) this.controllers[feature] = new AbortController();
            else this.controllers[feature].abort(new DOMException('Optional outbound requests disabled', 'AbortError'));
        }
        for (const feature of changed) for (const listener of this.listeners) listener(feature, permissions[feature]);
    }

    subscribe(listener: PolicyListener) {
        if (this.closed) return () => {};
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    close() {
        this.closed = true;
        for (const feature of features) this.controllers[feature].abort();
        this.listeners.clear();
    }
}
