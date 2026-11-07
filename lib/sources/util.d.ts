import type { SearchNeed, SourceHit } from '../types.js';
export declare const str: (value: unknown) => string | undefined;
export declare const num: (value: unknown) => number | undefined;
export declare const arr: (value: unknown) => any[];
export declare const clip: (text: string | undefined, max: number) => string | undefined;
export declare const isoDate: (date: Date) => string;
/** Lower bound date implied by `after` or `time_range`. */
export declare function afterDate(need: SearchNeed): string | undefined;
export declare function rangeDays(need: SearchNeed): number | undefined;
/** Add `site:` operators for engines without a structured domain filter. */
export declare function withSiteOperators(query: string, need: SearchNeed): string;
export declare const isCjk: (text: string) => boolean;
export declare function requireKey(key: string | undefined, label: string): string;
export declare function hit(url: unknown, fields: Omit<SourceHit, 'url'>): SourceHit | undefined;
export declare const hits: (items: (SourceHit | undefined)[]) => SourceHit[];
export declare const unixToIso: (seconds: unknown) => string | undefined;
export declare function joinUrl(base: string | undefined, fallback: string, path: string): string;
