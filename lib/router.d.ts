/** Source selection: explicit sources, rule routing on capability tags, optional semantic scores, default combination. */
import type { Config, SourceSettings } from './config.js';
import type { ResourceType, SearchNeed, SourceSpec } from './types.js';
export interface RoutableSource {
    spec: SourceSpec;
    settings: SourceSettings;
    /** Search is ready: credential resolved (or not needed) and any service-specific setting present. */
    usable: boolean;
    /** Fetch is ready, by the same rule. */
    fetchUsable?: boolean;
    /** Why search is not ready, when it is not. */
    reason?: string;
}
export interface RouteChoice {
    id: string;
    score: number;
    reasons: string[];
}
export interface RoutePlan {
    mode: 'explicit' | 'rules' | 'default';
    chosen: RouteChoice[];
    /** Remaining usable candidates, best first; follow-up searches draw from these. */
    reserve: RouteChoice[];
    /** Requested ids that were unknown, disabled or missing a key. */
    unavailable: {
        id: string;
        reason: string;
    }[];
    inferredTypes: ResourceType[];
}
/** Types implied by sites and wording when the caller gave none. */
export declare function inferTypes(need: SearchNeed): ResourceType[];
export interface PlanInput {
    need: SearchNeed;
    explicit: string[];
    config: Config;
    sources: RoutableSource[];
    count: number;
    /** Optional semantic fit 0–1 per source id (decision model). */
    semantic?: Map<string, number>;
}
export declare function planRoute(input: PlanInput): RoutePlan;
