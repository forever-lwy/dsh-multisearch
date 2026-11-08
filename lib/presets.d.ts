/** Rerank service presets, shared by the Host config and the settings page (no runtime deps). */
export declare const RERANK_PROVIDERS: {
    readonly jina: {
        readonly label: "Jina";
        readonly url: "https://api.jina.ai/v1/rerank";
        readonly apiKey: "JINA_API_KEY";
        readonly model: "jina-reranker-v2-base-multilingual";
    };
    readonly siliconflow: {
        readonly label: "硅基流动 SiliconFlow";
        readonly url: "https://api.siliconflow.cn/v1/rerank";
        readonly apiKey: "SILICONFLOW_API_KEY";
        readonly model: "BAAI/bge-reranker-v2-m3";
    };
    readonly cohere: {
        readonly label: "Cohere";
        readonly url: "https://api.cohere.com/v2/rerank";
        readonly apiKey: "COHERE_API_KEY";
        readonly model: "rerank-v3.5";
    };
    readonly custom: {
        readonly label: "自定义（Jina/Cohere 兼容接口）";
        readonly url: "";
        readonly apiKey: "";
        readonly model: "";
    };
};
export type RerankProvider = keyof typeof RERANK_PROVIDERS;
export declare const RERANK_PROVIDER_IDS: RerankProvider[];
/** Effective endpoint, credential reference and model: explicit fields win over the provider preset. */
export declare function rerankTarget(rerank: {
    provider?: string;
    url?: string;
    apiKey?: string;
    model?: string;
}): {
    url: string;
    apiKey: string;
    model: string;
};
export declare const DECISION_DEFAULT_KEY = "DECISION_API_KEY";
/**
 * Decision-API wire formats. Both return typed answers (probabilities / scores) instead of text.
 * - openai: OpenAI Decisions, `POST …/decisions` with `{ model, input, questions: [...] }`.
 * - systemone: TypeSafe System One, `POST …/systemone` with `{ model, state, questions: {...} }`;
 *   Jev's own API, OpenRouter and Vercel AI Gateway speak it.
 */
export type DecisionProtocol = 'openai' | 'systemone';
export declare const DECISION_PROTOCOLS: Record<DecisionProtocol, {
    label: string;
    path: string;
}>;
/** Fill-in presets for the decision-API backend (the settings page copies them into the fields). */
export declare const DECISION_ENDPOINTS: {
    readonly openai: {
        readonly label: "OpenAI 官方（gpt-6-luna）";
        readonly protocol: "openai";
        readonly baseURL: "https://api.openai.com/v1";
        readonly model: "gpt-6-luna";
    };
    readonly typesafe: {
        readonly label: "TypeSafe（Jev 官方）";
        readonly protocol: "systemone";
        readonly baseURL: "https://api.typesafe.ai/v1";
        readonly model: "jev-latest";
    };
    readonly openrouter: {
        readonly label: "OpenRouter（System One）";
        readonly protocol: "systemone";
        readonly baseURL: "https://openrouter.ai/api/v1";
        readonly model: "typesafe/jev-1.14";
    };
    readonly vercel: {
        readonly label: "Vercel AI Gateway";
        readonly protocol: "systemone";
        readonly baseURL: "https://ai-gateway.vercel.sh/typesafe/v1";
        readonly model: "typesafe-ai/jev";
    };
};
/**
 * Endpoint for a decision API: a base (`…/v1`) gets the protocol's path appended; a URL that already
 * ends in `/decisions` or `/systemone` is used as is (some hosts serve System One at `/decisions`).
 */
export declare function decisionsUrl(baseURL: string, protocol?: DecisionProtocol): string;
/** Chat completions URL for an OpenAI-compatible base (`…/v1`) or a full endpoint. */
export declare function chatCompletionsUrl(baseURL: string): string;
/** The request each decision backend sends, for the settings page and status text. */
export declare function decisionWire(decision: {
    backend?: string;
    protocol?: string;
    baseURL?: string;
}): string;
