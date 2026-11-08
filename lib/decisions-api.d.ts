import { type DecisionProtocol } from './presets.js';
export type Question = {
    id: string;
    type: 'bool';
    instructions: string;
    true: string;
    false: string;
} | {
    id: string;
    type: 'score';
    instructions: string;
    levels: {
        label: string;
        description?: string;
    }[];
} | {
    id: string;
    type: 'choice';
    instructions: string;
    choices: {
        value: string;
        description?: string;
    }[];
};
/** bool → probability of true; score → 0–1 position across the levels; choice → chosen value. */
export type Answer = number | string;
export interface DecisionsTarget {
    protocol: DecisionProtocol;
    baseURL: string;
    model: string;
    apiKey?: string;
    timeoutMs: number;
    signal: AbortSignal;
}
/** Hosts cap questions per request (OpenAI 400, some System One hosts 128); stay well below. */
export declare const MAX_QUESTIONS = 100;
export declare function openAIRequest(model: string, state: object, questions: Question[]): Record<string, unknown>;
export declare function systemOneRequest(model: string, state: object, questions: Question[]): Record<string, unknown>;
/** Answers from either reply layout; questions without a usable answer (refusals included) are left out. */
export declare function parseAnswers(body: any, questions: Question[]): Map<string, Answer>;
/** Ask all questions about one state; batches stay under the per-request cap. Throws on transport failure. */
export declare function askDecisions(target: DecisionsTarget, state: object, questions: Question[]): Promise<Map<string, Answer>>;
