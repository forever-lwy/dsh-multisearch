/** Merge, dedupe, fuse and rerank hits from many sources and queries. */
import type { Candidate, SearchNeed, SourceHit } from './types.js';
export interface RankedList {
    source: string;
    query: string;
    weight: number;
    hits: SourceHit[];
}
export interface MergeStats {
    rawHits: number;
    unique: number;
    /** Share of raw hits that collapsed into an existing candidate. */
    duplicateRatio: number;
}
/** Normalize and merge; identical pages collapse by URL key, near-identical text by shingle overlap. */
export declare function mergeHits(lists: RankedList[], existing?: Map<string, Candidate>): {
    candidates: Map<string, Candidate>;
    stats: MergeStats;
};
/** Reciprocal rank fusion across every (source, query) list the candidate appeared in. */
export declare function fuse(candidates: Iterable<Candidate>, weights: Map<string, number>, k?: number): void;
export interface RerankContext {
    need: SearchNeed;
    officialDomains: string[];
    /** Optional externally computed relevance 0–1 by candidate key. */
    relevance?: Map<string, number>;
    keepThreshold: number;
}
/** Relevance, hard constraints, credibility, freshness, completeness — applied on top of the fused score. */
export declare function rerank(candidates: Candidate[], ctx: RerankContext): Candidate[];
/** Diversity pass: prefer new information over another copy of the same point. */
export declare function diversify(ranked: Candidate[], limit: number): Candidate[];
