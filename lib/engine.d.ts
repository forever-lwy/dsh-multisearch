/** Orchestration: source registry, search with follow-up, fetch with fallback, crawl. */
import type { Config, Tuning } from './config.js';
import type { ProfileName, ResourceType, SearchNeed, SourceRun, StopReason } from './types.js';
import { type RoutableSource, type RoutePlan } from './router.js';
import type { DecisionModel } from './decision.js';
import type { PageCache, RefEntry, TaskStore } from './store.js';
export interface EngineDeps {
    config: () => Config;
    resolveKey: (ref: string) => Promise<string | undefined>;
    web: () => unknown;
    decision: DecisionModel;
    cache: PageCache;
}
export interface SearchInput {
    need: SearchNeed;
    sources: string[];
    profile?: ProfileName;
    tuning: Partial<Tuning>;
    more?: string;
}
export interface ResultItem {
    ref: string;
    title: string;
    url: string;
    snippet: string;
    sources: string[];
    publishedAt?: string;
    version?: string;
    kind: 'snippet' | 'page';
    readStatus: RefEntry['status'];
    flags: string[];
    alsoAt?: string[];
    meta?: Record<string, string | number | boolean>;
}
export interface SearchOutcome {
    searchId: string;
    results: ResultItem[];
    generated: {
        source: string;
        query: string;
        text: string;
    }[];
    remaining: number;
    stats: {
        rawHits: number;
        unique: number;
        duplicateRatio: number;
        elapsedMs: number;
        rounds: number;
        profile: string;
    };
    route: {
        mode: RoutePlan['mode'] | 'more';
        sources: {
            id: string;
            reasons: string[];
        }[];
        unavailable: {
            id: string;
            reason: string;
        }[];
        inferredTypes: ResourceType[];
    };
    runs: SourceRun[];
    stop: StopReason;
    followUp?: {
        reasons: string[];
        performed: string[];
        suggestedSources: string[];
        suggestedQueries: string[];
        advice?: string;
    };
    budget: {
        outputTokens: number;
        trimmed: number;
    };
}
export interface FetchInput {
    targets: string[];
    keywords: string[];
    offset: number;
    maxChars?: number;
    contextChars: number;
    live: boolean;
    services: string[];
    focus?: string;
    profile?: ProfileName;
    tuning: Partial<Tuning>;
    crawl?: {
        mode: 'map' | 'crawl';
        maxPages: number;
        maxDepth: number;
        includePaths: string[];
        excludePaths: string[];
        sameDomain: boolean;
    };
}
export type PageStatus = 'ok' | 'partial' | 'blocked' | 'empty' | 'failed' | 'timeout';
export interface FetchAttempt {
    service: string;
    status: PageStatus | 'error';
    ms: number;
    error?: string;
}
export interface FetchItem {
    ref?: string;
    url: string;
    finalUrl?: string;
    title?: string;
    status: PageStatus;
    service?: string;
    fromCache: boolean;
    attempts: FetchAttempt[];
    content: string;
    view: 'range' | 'keywords' | 'none';
    totalChars: number;
    range?: [number, number];
    nextOffset?: number;
    matches?: number;
    truncated: boolean;
    publishedAt?: string;
    error?: string;
}
export interface FetchOutcome {
    items: FetchItem[];
    map?: {
        url: string;
        title?: string;
        ref?: string;
    }[];
    elapsedMs: number;
    stop: StopReason;
}
export declare class Engine {
    private readonly deps;
    private readonly adapters;
    constructor(deps: EngineDeps);
    get config(): Config;
    specs(): import("./types.js").SourceSpec[];
    private env;
    /** Enabled state, settings and credential readiness for every source. */
    routable(): Promise<RoutableSource[]>;
    search(input: SearchInput, store: TaskStore, signal: AbortSignal): Promise<SearchOutcome>;
    private more;
    private item;
    /** Keep results while they fit the output budget; always keep at least one. */
    private fitBudget;
    private followUpReasons;
    private missingTypes;
    private reuseFromStore;
    private summary;
    private serviceRelevance;
    fetch(input: FetchInput, store: TaskStore, signal: AbortSignal): Promise<FetchOutcome>;
    private fetchOrder;
    private assess;
    private fetchOne;
    /** Site discovery: a map service when available, else a bounded breadth-first walk over fetched pages. */
    private discover;
}
