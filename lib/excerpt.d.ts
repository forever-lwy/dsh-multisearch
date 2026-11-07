/** Read part of a long page: keyword windows that keep the context a fact depends on, or a block-aligned range. */
interface Block {
    start: number;
    end: number;
    kind: 'heading' | 'code' | 'table' | 'text';
    text: string;
}
/** Split markdown into blocks; code fences and tables stay whole so headers and premises are never cut off. */
export declare function splitBlocks(markdown: string): Block[];
export interface ExcerptResult {
    text: string;
    matches: number;
    /** Character ranges of the page that were returned. */
    ranges: [number, number][];
    truncated: boolean;
}
export declare function keywordExcerpt(markdown: string, keywords: string[], contextChars: number, maxChars: number): ExcerptResult;
/** A range starting at `offset`, extended to the end of the block it would cut (up to 15% extra). */
export declare function rangeExcerpt(markdown: string, offset: number, maxChars: number): {
    text: string;
    start: number;
    end: number;
    nextOffset?: number;
};
export {};
