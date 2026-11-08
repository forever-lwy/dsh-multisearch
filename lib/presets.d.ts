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
