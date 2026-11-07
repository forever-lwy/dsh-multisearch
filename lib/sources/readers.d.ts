import type { SourceAdapter } from '../types.js';
export declare const jina: SourceAdapter;
export declare const firecrawl: SourceAdapter;
export declare const scrapingant: SourceAdapter;
export declare const crawl4ai: SourceAdapter;
/** Refuse loopback and private-network targets unless explicitly allowed. */
export declare function assertPublicUrl(target: string, allowPrivate: boolean): Promise<URL>;
export declare function directHttp(allowPrivate: () => boolean): SourceAdapter;
/** DSH's own `ctx.web` seam: whichever search/fetch provider the deployment configured. */
export declare function builtinWeb(getWeb: () => any): SourceAdapter;
