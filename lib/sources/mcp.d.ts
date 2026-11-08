import type { HttpClient } from '../types.js';
/** Stable for the plugin process; free tiers use it for rate limiting and log correlation. */
export declare const MCP_SESSION_TAG: string;
interface McpTarget {
    http: HttpClient;
    endpoint: string;
    headers: Record<string, string>;
    signal: AbortSignal;
    timeoutMs: number;
}
/** Call one tool; returns its structured content, or the JSON parsed from its text content. */
export declare function callTool(target: McpTarget, name: string, args: Record<string, unknown>): Promise<any>;
/** For tests: forget cached sessions. */
export declare function resetMcpSessions(): void;
export {};
