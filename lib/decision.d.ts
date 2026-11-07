import type { Config } from './config.js';
import type { Candidate, SearchNeed, SourceSpec } from './types.js';
export interface LlmLike {
    stream(options: Record<string, unknown>): AsyncIterable<any>;
}
export interface FollowUpAdvice {
    continue: boolean;
    reason: string;
    trySources: string[];
    queries: string[];
}
export declare class DecisionModel {
    private readonly config;
    private readonly llm;
    constructor(config: () => Config, llm: () => LlmLike | undefined);
    enabled(stage: 'route' | 'rerank' | 'followup'): boolean;
    private ask;
    /** Semantic fit 0–1 of each candidate source for the need. */
    routeScores(need: SearchNeed, specs: SourceSpec[], signal: AbortSignal): Promise<Map<string, number> | undefined>;
    /** Relevance 0–1 per candidate key, judged in one batch. */
    relevance(need: SearchNeed, candidates: Candidate[], signal: AbortSignal): Promise<Map<string, number> | undefined>;
    followUp(need: SearchNeed, summary: string, untried: SourceSpec[], signal: AbortSignal): Promise<FollowUpAdvice | undefined>;
}
export declare function describeNeed(need: SearchNeed): string;
export declare function parseJson(text: string): any | undefined;
