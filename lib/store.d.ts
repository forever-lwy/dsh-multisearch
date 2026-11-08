/** Task-scoped memory: stable reference ids, candidates of each search, fetched pages; plus a shared page cache. */
import type { Candidate, ReadStatus, SearchNeed } from './types.js';
export interface PageRecord {
    url: string;
    finalUrl?: string;
    title?: string;
    content: string;
    service: string;
    fetchedAt: number;
    status: 'ok' | 'partial';
    truncated: boolean;
    publishedAt?: string;
}
export interface RefEntry {
    ref: string;
    url: string;
    title: string;
    snippet: string;
    sources: string[];
    publishedAt?: string;
    status: ReadStatus;
    page?: PageRecord;
}
export interface SearchRecord {
    id: string;
    need: SearchNeed;
    /** Candidate refs in final ranked order, including those not shown. */
    ranked: string[];
    shown: number;
    createdAt: number;
}
export declare class TaskStore {
    private refsByKey;
    private entries;
    private searches;
    private nextRef;
    private nextSearch;
    lastUsed: number;
    refFor(candidate: Pick<Candidate, 'url' | 'title' | 'snippet' | 'publishedAt'> & {
        sources?: string[];
    }): RefEntry;
    get(ref: string): RefEntry | undefined;
    byUrl(url: string): RefEntry | undefined;
    saveSearch(need: SearchNeed, ranked: string[], shown: number): SearchRecord;
    /** Saved searches of this task, newest first. */
    recentSearches(): SearchRecord[];
    search(id: string): SearchRecord | undefined;
}
/** Pages shared across tasks, keyed by URL, honoring the configured freshness. */
export declare class PageCache {
    private readonly capacity;
    private pages;
    constructor(capacity?: number);
    get(url: string, ttlMs: number): PageRecord | undefined;
    set(page: PageRecord): void;
}
/** One TaskStore per session (task); idle stores expire. */
export declare class StoreRegistry {
    private readonly idleMs;
    private readonly capacity;
    private stores;
    constructor(idleMs?: number, capacity?: number);
    for(taskId: string): TaskStore;
}
