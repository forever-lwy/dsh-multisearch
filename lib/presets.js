/** Rerank service presets, shared by the Host config and the settings page (no runtime deps). */
export const RERANK_PROVIDERS = {
    jina: { label: 'Jina', url: 'https://api.jina.ai/v1/rerank', apiKey: 'JINA_API_KEY', model: 'jina-reranker-v2-base-multilingual' },
    siliconflow: { label: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1/rerank', apiKey: 'SILICONFLOW_API_KEY', model: 'BAAI/bge-reranker-v2-m3' },
    cohere: { label: 'Cohere', url: 'https://api.cohere.com/v2/rerank', apiKey: 'COHERE_API_KEY', model: 'rerank-v3.5' },
    custom: { label: '自定义（Jina/Cohere 兼容接口）', url: '', apiKey: '', model: '' },
};
export const RERANK_PROVIDER_IDS = Object.keys(RERANK_PROVIDERS);
/** Effective endpoint, credential reference and model: explicit fields win over the provider preset. */
export function rerankTarget(rerank) {
    const preset = RERANK_PROVIDERS[(rerank.provider ?? 'jina')] ?? RERANK_PROVIDERS.custom;
    return { url: rerank.url || preset.url, apiKey: rerank.apiKey || preset.apiKey, model: rerank.model || preset.model };
}
export const DECISION_DEFAULT_KEY = 'DECISION_API_KEY';
