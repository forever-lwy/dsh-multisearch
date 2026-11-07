/** Settings schema, profile presets and the effective per-call tuning. */
import z from '@deepseek-ai/schemastery';
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
    };
    fetching: {
        order: string[];
        allowPrivateNetwork: boolean;
        minContentChars: number;
        preferRender: string[];
    };
    rerank: {
        mode: 'rules' | 'service' | 'model';
        url: string;
        apiKey: string;
        model: string;
    };
    decision: {
        enabled: boolean;
        provider: string;
        model: string;
        reasoning: string;
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
    };
    sources: Record<string, SourceSettings>;
}
export declare const ALL_SPECS: SourceSpec[];
export declare const DEFAULT_FETCH_ORDER: string[];
export declare const Config: z<Config>;
/** Merge order: per-call > user setting > preset; then clamp to hard limits. */
export declare function effectiveTuning(config: Config, profile: ProfileName | undefined, call: Partial<Tuning>): Tuning;
export declare function sourceSettings(config: Config, id: string): SourceSettings;
