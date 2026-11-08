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
/** Chat completions URL for an OpenAI-compatible base (`…/v1`) or a full endpoint. */
export declare function chatCompletionsUrl(baseURL: string): string;
export declare class DecisionModel {
    private readonly config;
    private readonly llm;
    private readonly resolveKey;
    constructor(config: () => Config, llm: () => LlmLike | undefined, resolveKey?: (ref: string) => Promise<string | undefined>);
    /** Why the last call fell back, for the settings page test. */
    private lastError;
    enabled(stage: 'route' | 'rerank' | 'followup'): boolean;
    private ask;
    /** A provider configured only for this plugin: plain OpenAI-compatible chat completions. */
    private askOpenAI;
    /** One small judgement to check the configured backend end to end (settings page "test"). */
    probe(signal: AbortSignal): Promise<{
        ok: boolean;
        detail: string;
        ms: number;
    }>;
    /** Semantic fit 0–1 of each candidate source for the need. */
    routeScores(need: SearchNeed, specs: SourceSpec[], signal: AbortSignal): Promise<Map<string, number> | undefined>;
    /** Relevance 0–1 per candidate key, judged in one batch. */
    relevance(need: SearchNeed, candidates: Candidate[], signal: AbortSignal): Promise<Map<string, number> | undefined>;
    followUp(need: SearchNeed, summary: string, untried: SourceSpec[], signal: AbortSignal): Promise<FollowUpAdvice | undefined>;
}
export declare function describeNeed(need: SearchNeed): string;
export declare function parseJson(text: string): any | undefined;
