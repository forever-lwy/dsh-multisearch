/** Rerank service presets, shared by the Host config and the settings page (no runtime deps). */
export const RERANK_PROVIDERS = {
  jina: { label: 'Jina', url: 'https://api.jina.ai/v1/rerank', apiKey: 'JINA_API_KEY', model: 'jina-reranker-v2-base-multilingual' },
  siliconflow: { label: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1/rerank', apiKey: 'SILICONFLOW_API_KEY', model: 'BAAI/bge-reranker-v2-m3' },
  cohere: { label: 'Cohere', url: 'https://api.cohere.com/v2/rerank', apiKey: 'COHERE_API_KEY', model: 'rerank-v3.5' },
  custom: { label: '自定义（Jina/Cohere 兼容接口）', url: '', apiKey: '', model: '' },
} as const

export type RerankProvider = keyof typeof RERANK_PROVIDERS
export const RERANK_PROVIDER_IDS = Object.keys(RERANK_PROVIDERS) as RerankProvider[]

/** Effective endpoint, credential reference and model: explicit fields win over the provider preset. */
export function rerankTarget(rerank: { provider?: string; url?: string; apiKey?: string; model?: string }): { url: string; apiKey: string; model: string } {
  const preset = RERANK_PROVIDERS[(rerank.provider ?? 'jina') as RerankProvider] ?? RERANK_PROVIDERS.custom
  return { url: rerank.url || preset.url, apiKey: rerank.apiKey || preset.apiKey, model: rerank.model || preset.model }
}

export const DECISION_DEFAULT_KEY = 'DECISION_API_KEY'

/**
 * Decision-API wire formats. Both return typed answers (probabilities / scores) instead of text.
 * - openai: OpenAI Decisions, `POST …/decisions` with `{ model, input, questions: [...] }`.
 * - systemone: TypeSafe System One, `POST …/systemone` with `{ model, state, questions: {...} }`;
 *   Jev's own API, OpenRouter and Vercel AI Gateway speak it.
 */
export type DecisionProtocol = 'openai' | 'systemone'
export const DECISION_PROTOCOLS: Record<DecisionProtocol, { label: string; path: string }> = {
  openai: { label: 'OpenAI Decisions 格式', path: 'decisions' },
  systemone: { label: 'System One 格式（Jev/TypeSafe）', path: 'systemone' },
}

/** Fill-in presets for the decision-API backend (the settings page copies them into the fields). */
export const DECISION_ENDPOINTS = {
  openai: { label: 'OpenAI 官方（gpt-6-luna）', protocol: 'openai', baseURL: 'https://api.openai.com/v1', model: 'gpt-6-luna' },
  typesafe: { label: 'TypeSafe（Jev 官方）', protocol: 'systemone', baseURL: 'https://api.typesafe.ai/v1', model: 'jev-latest' },
  openrouter: { label: 'OpenRouter（System One）', protocol: 'systemone', baseURL: 'https://openrouter.ai/api/v1', model: 'typesafe/jev-1.14' },
  vercel: { label: 'Vercel AI Gateway', protocol: 'systemone', baseURL: 'https://ai-gateway.vercel.sh/typesafe/v1', model: 'typesafe-ai/jev' },
} as const satisfies Record<string, { label: string; protocol: DecisionProtocol; baseURL: string; model: string }>

/**
 * Endpoint for a decision API: a base (`…/v1`) gets the protocol's path appended; a URL that already
 * ends in `/decisions` or `/systemone` is used as is (some hosts serve System One at `/decisions`).
 */
export function decisionsUrl(baseURL: string, protocol: DecisionProtocol = 'openai'): string {
  const base = baseURL.trim().replace(/\/+$/, '')
  if (base === '') return ''
  return /\/(decisions|systemone)$/.test(base) ? base : `${base}/${DECISION_PROTOCOLS[protocol]?.path ?? 'decisions'}`
}

/** Chat completions URL for an OpenAI-compatible base (`…/v1`) or a full endpoint. */
export function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

/** The request each decision backend sends, for the settings page and status text. */
export function decisionWire(decision: { backend?: string; protocol?: string; baseURL?: string }): string {
  const backend = decision.backend ?? 'dsh'
  if (backend === 'openai') return decision.baseURL?.trim() ? `POST ${chatCompletionsUrl(decision.baseURL)}` : 'POST {接口地址}/chat/completions'
  if (backend === 'decisions') {
    const protocol = (decision.protocol ?? 'openai') as DecisionProtocol
    return decision.baseURL?.trim() ? `POST ${decisionsUrl(decision.baseURL, protocol)}` : `POST {接口地址}/${DECISION_PROTOCOLS[protocol]?.path ?? 'decisions'}`
  }
  return 'DSH llm.stream → 所选供应商路由的聊天协议'
}
