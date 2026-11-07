/** Domain sources: papers, AI models and datasets, library documentation; and model-hosted search. */
import type { SourceAdapter } from '../types.js';
export declare const consensus: SourceAdapter;
export declare const sciverse: SourceAdapter;
export declare const huggingface: SourceAdapter;
export declare const context7: SourceAdapter;
export declare const gemini: SourceAdapter;
export declare const openai: SourceAdapter;
/** Generic Jina/Cohere-compatible rerank call used by the reranker stage. */
export declare function rerankService(options: {
    url: string;
    apiKey?: string;
    model: string;
    query: string;
    documents: string[];
    topN: number;
    signal: AbortSignal;
    timeoutMs: number;
}): Promise<{
    index: number;
    score: number;
}[]>;
