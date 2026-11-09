import type { PeerInfo } from '../rpc-types.ts';

export type PolicyMode = 'off' | 'preview' | 'automatic';
export interface PolicyConfig { mode: PolicyMode; listener_allowance: number; keep_addresses: string[] }
export interface PolicyPeer {
    peer_id: number; address: string; host: string; network: string; subver: string | null;
    connection_age_seconds: number | null; observed_seconds: number; remaining_seconds: number;
    status: 'candidate' | 'protected' | 'observing' | 'unknown'; reason: string;
}
export type PolicyEventKind = 'would_disconnect' | 'requested' | 'succeeded' | 'failed' | 'uncertain' | 'departure_observed' | 'skipped';
export interface PolicyEvent { id: string; time: number; peer_id: number | null; address: string | null; kind: PolicyEventKind; reason: string }
export interface PolicyAttempt {
    id: string; time: number; peer_id: number; address: string; identity: string;
    outcome: 'requested' | 'succeeded' | 'failed' | 'uncertain';
    departure_observed?: boolean;
}
export interface PolicyState { attempts: PolicyAttempt[]; events: PolicyEvent[]; last_wall_time: number }
export interface PolicyDocument { version: 1; scope: string; revision: number; config: PolicyConfig; state: PolicyState }
export interface PolicyCandidate { identity: string; host: string; peer: PeerInfo; view: PolicyPeer }
export interface PolicyEvaluation {
    peers: PolicyPeer[]; eligible: PolicyCandidate[];
    counts: { inbound: number; candidates: number; exempt: number };
    as_diversity_available: boolean;
}
export const POLICY_LIMITS = Object.freeze({
    grace_seconds: 3600, observation_seconds: 1800, attempt_interval_seconds: 300,
    max_attempts_per_hour: 6, address_cooldown_seconds: 1800,
    min_total_peers: 12, min_outbound_peers: 4,
});
export interface PolicySnapshot {
    available: boolean; config: PolicyConfig; revision: number;
    effective_state: 'disabled' | 'observing' | 'preview' | 'running' | 'paused'; reason: string;
    preview_remaining_seconds: number; next_action_at: number | null;
    counts: PolicyEvaluation['counts']; limits: typeof POLICY_LIMITS;
    peers: PolicyPeer[]; events: PolicyEvent[]; as_diversity_available: boolean;
}
export const DEFAULT_POLICY_CONFIG: Readonly<PolicyConfig> = Object.freeze({ mode: 'off', listener_allowance: 0, keep_addresses: [] });
