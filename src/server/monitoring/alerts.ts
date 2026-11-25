import { randomUUID } from 'node:crypto';
import { ALERT_RULES, type AlertIncident, type AlertRule, type AlertSettings } from './types.ts';

export const defaultAlertSettings = (): AlertSettings => ({
    revision: 0,
    rules: { peer_data: true, low_outbound: true, policy_failure: true, recording_failure: true }
});
const messages: Record<AlertRule, string> = {
    peer_data: 'Peer data has not refreshed for at least 60 seconds.',
    low_outbound: 'Outbound connections have remained below four for at least two minutes.',
    policy_failure: 'Inbound policy is paused by a failure guard or saved-state storage fault.',
    recording_failure: 'Recording is degraded; some history may be unavailable or incomplete.'
};
export class AlertEngine {
    private incidents: AlertIncident[] = [];
    private recovery = new Map<AlertRule, number>();
    settings = defaultAlertSettings();
    restore(incidents: AlertIncident[], settings: AlertSettings) {
        this.incidents = incidents.slice(0, 1004);
        this.settings = structuredClone(settings);
    }
    tick(now: number, conditions: Record<AlertRule, boolean>): AlertIncident[] {
        const changed: AlertIncident[] = [];
        for (const rule of ALERT_RULES) {
            const active = this.incidents.find((i) => i.rule === rule && i.state === 'active');
            if (this.settings.rules[rule] && conditions[rule]) {
                this.recovery.delete(rule);
                if (!active) {
                    const incident: AlertIncident = {
                        id: randomUUID(),
                        rule,
                        state: 'active',
                        raised_at: now,
                        resolved_at: null,
                        acknowledged_at: null,
                        message: messages[rule]
                    };
                    this.incidents.push(incident);
                    changed.push(incident);
                }
            } else if (active) {
                const since = this.recovery.get(rule) ?? now;
                this.recovery.set(rule, since);
                if (now - since >= 30) {
                    active.state = 'resolved';
                    active.resolved_at = now;
                    changed.push({ ...active });
                    this.recovery.delete(rule);
                }
            }
        }
        const resolved = this.incidents
            .filter((i) => i.state === 'resolved' && now - (i.resolved_at ?? now) < 30 * 86400)
            .sort((a, b) => b.raised_at - a.raised_at)
            .slice(0, 1000);
        this.incidents = [...this.incidents.filter((i) => i.state === 'active'), ...resolved];
        return structuredClone(changed);
    }
    acknowledge(id: string, now: number): AlertIncident | null {
        const i = this.incidents.find((i) => i.id === id);
        if (!i) return null;
        i.acknowledged_at ??= now;
        return { ...i };
    }
    snapshot() {
        return structuredClone(this.incidents).sort((a, b) => b.raised_at - a.raised_at);
    }
}
