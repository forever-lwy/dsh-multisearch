/** Minimal HTTP client: timeouts fused with the caller's signal, size caps, JSON helpers. */
import type { HttpClient } from './types.js';
export declare class SourceError extends Error {
    readonly code: string;
    readonly status?: number | undefined;
    constructor(message: string, code: string, status?: number | undefined);
}
/** Abort when either the caller cancels or the per-request timeout elapses. */
export declare function deadlineSignal(signal: AbortSignal, timeoutMs: number): AbortSignal;
/** Never echo credentials back in error text. */
export declare function redact(text: string, secrets: (string | undefined)[]): string;
export declare const http: HttpClient;
/** Run tasks with a concurrency limit, preserving input order of results. */
export declare function pool<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]>;
export declare function errorText(error: unknown): string;
export declare function errorCode(error: unknown): string;
