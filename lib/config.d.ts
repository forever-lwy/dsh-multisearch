/** Settings schema, profile presets and the effective per-call tuning. */
import z from '@deepseek-ai/schemastery';
import { type DecisionProtocol, type RerankProvider } from './presets.js';
import type { ProfileName, ResourceType, SourceSpec } from './types.js';
/** Every per-call execution knob. Presets fill all of them. */
export interface Tuning {
    parallelSources: number;
    queryConcurrency: number;
    perSourceResults: number;
    autoFollowUp: boolean;
    followUpRounds: number;
    minResults: number;
    duplicateRatio: number;
    requestTimeoutMs: number;
    callTimeoutMs: number;
    fetchConcurrency: number;
    fetchMaxChars: number;
    /** Combined size of one fetch call's returned text (≈ tokens; 0 = no cap). Keeps multi-URL reads under the host's inline limit. */
    fetchTotalTokens: number;
    fetchRetries: number;
    fetchFallbacks: number;
    cacheTtlMinutes: number;
    candidateLimit: number;
    returnResults: number;
    outputTokens: number;
    snippetChars: number;
    rerank: boolean;
}
export declare const PRESETS: Record<ProfileName, Tuning>;
export interface Limits {
    maxQueries: number;
    maxParallelSources: number;
    maxPerSourceResults: number;
    maxReturnResults: number;
    maxOutputTokens: number;
    maxCallTimeoutMs: number;
    maxRequestTimeoutMs: number;
    maxFetchUrls: number;
    maxFetchChars: number;
    maxFollowUpRounds: number;
    maxCrawlPages: number;
    maxCrawlDepth: number;
}
export interface SourceSettings {
    enabled: boolean;
    /** Per-capability switches; a disabled capability is never routed to. */
    search: boolean;
    fetch: boolean;
    apiKey: string;
    priority: number;
    baseURL: string;
    types: ResourceType[];
    options: Record<string, string | number | boolean>;
}
export interface RouteRule {
    name: string;
    types: ResourceType[];
    keywords: string[];
    sites: string[];
    sources: string[];
    boost: number;
}
export interface Config {
    profile: ProfileName;
    tools: {
        search: boolean;
        fetch: boolean;
        searchName: string;
        fetchName: string;
        guidance: boolean;
    };
    overrides: Partial<Tuning>;
    limits: Limits;
    routing: {
        autoRoute: boolean;
        defaultSources: string[];
        rules: RouteRule[];
        overlapPenalty: number;
        officialDomains: string[];
        /** Bounds on how many sources one automatic search uses (explicit `sources` are not bounded). */
        minSources: number;
        maxSources: number;
        /** With decision-model routing, sources scoring at least this fit are used (within the bounds). */
        fitThreshold: number;
    };
    fetching: {
        order: string[];
        allowPrivateNetwork: boolean;
        minContentChars: number;
        preferRender: string[];
    };
    rerank: {
        mode: 'rules' | 'service' | 'model';
        provider: RerankProvider;
        url: string;
        apiKey: string;
        model: string;
    };
    decision: {
        enabled: boolean;
        /**
         * dsh: a DSH provider route (its chat protocol; the LLM replies with JSON);
         * openai: an OpenAI-compatible chat completions endpoint (the LLM replies with JSON);
         * decisions: a decision API (OpenAI Decisions or System One) answering typed questions.
         */
        backend: 'dsh' | 'openai' | 'decisions';
        /** Wire format of the decision API (backend decisions). */
        protocol: DecisionProtocol;
        provider: string;
        model: string;
        reasoning: string;
        baseURL: string;
        apiKey: string;
        stages: ('route' | 'rerank' | 'followup')[];
        timeoutMs: number;
        keepThreshold: number;
        maxCandidates: number;
    };
    research: {
        maxSubagents: number;
        maxRounds: number;
        maxPages: number;
        timeMinutes: number;
        maxCalls: number;
        modelInvocable: boolean;
        skillMode: 'file' | 'builtin';
    };
    sources: Record<string, SourceSettings>;
}
export declare const ALL_SPECS: SourceSpec[];
export declare const DEFAULT_FETCH_ORDER: string[];
export declare const Config: z<Config>;
/** Top-level sections, every one volatile so the settings page can edit them and changes apply without a remount. */
export declare const SECTIONS: readonly ["profile", "tools", "overrides", "limits", "routing", "fetching", "rerank", "decision", "research", "sources"];
/** Read the current values out of the volatile references the loader hands to `apply` (plain objects pass through). */
export declare function snapshotConfig(raw: unknown): Config;
/** Merge order: per-call > user setting > preset; then clamp to hard limits. */
export declare function effectiveTuning(config: Config, profile: ProfileName | undefined, call: Partial<Tuning>): Tuning;
/**
 * How many sources an automatic search uses, within [minSources, maxSources] (and the hard limit):
 * the per-call `parallel_sources` when given, else the decision model's count of well-fitting
 * sources when it scored them, else the profile's parallelSources.
 */
export declare function sourceCount(config: Config, tuning: Tuning, call: Partial<Tuning> | undefined, semantic?: Map<string, number>): {
    count: number;
    min: number;
    max: number;
    by: 'call' | 'decision' | 'profile';
};
export declare function sourceSettings(config: Config, id: string): SourceSettings;
