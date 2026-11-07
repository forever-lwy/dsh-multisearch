/** URL normalization, tokenization and similarity helpers. */
/** Canonical identity of a page: same document, different decoration → same key. */
export declare function urlKey(raw: string): string;
export declare function hostOf(raw: string): string;
/** Does `host` equal or sit under `domain` (domain may carry a path prefix)? */
export declare function matchesSite(url: string, site: string): boolean;
/** Lowercased word tokens; CJK text becomes overlapping bigrams. */
export declare function tokens(text: string): string[];
export declare function shingles(text: string, size?: number): Set<string>;
export declare function jaccard(a: Set<string>, b: Set<string>): number;
/** Rough token count: ~4 Latin chars per token, ~1 token per CJK character. */
export declare function estimateTokens(text: string): number;
/** Version-like strings (v1.2, 3.11.4, 2024.10). */
export declare function findVersion(text: string): string | undefined;
/** Provider dates come as ISO, RFC 2822, unix seconds/ms or a bare year; normalize to ISO when possible. */
export declare function normalizeDate(value: string | undefined): string | undefined;
export declare function parseDate(value: string | undefined): number | undefined;
