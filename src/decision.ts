/**
 * Optional decision model (e.g. Jev): batched structured judgements for source fit, candidate
 * relevance and follow-up. Any failure — disabled, timeout, bad JSON — returns undefined and the
 * caller falls back to rules; items the model skipped stay unknown.
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.js'
import { http } from './http.js'
import type { Candidate, SearchNeed, SourceSpec } from './types.js'

export interface LlmLike {
  stream(options: Record<string, unknown>): AsyncIterable<any>
}

export interface FollowUpAdvice {
  continue: boolean
  reason: string
  trySources: string[]
  queries: string[]
}

/** Chat completions URL for an OpenAI-compatible base (`…/v1`) or a full endpoint. */
export function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

export class DecisionModel {
  constructor(
    private readonly config: () => Config,
    private readonly llm: () => LlmLike | undefined,
    private readonly resolveKey: (ref: string) => Promise<string | undefined> = async () => undefined,
  ) {}

  /** Why the last call fell back, for the settings page test. */
  private lastError = ''

  enabled(stage: 'route' | 'rerank' | 'followup'): boolean {
    const d = this.config().decision
    if (!d.enabled || d.model === '' || !d.stages.includes(stage)) return false
    return (d.backend ?? 'dsh') === 'openai' ? Boolean(d.baseURL?.trim()) : d.provider !== '' && this.llm() !== undefined
  }

  private async ask(system: string, user: string, signal: AbortSignal): Promise<any | undefined> {
    const d = this.config().decision
    this.lastError = ''
    if ((d.backend ?? 'dsh') === 'openai') return this.askOpenAI(system, user, signal)
    const llm = this.llm()
    if (!llm) return undefined
    const local = AbortSignal.any([signal, AbortSignal.timeout(d.timeoutMs)])
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of llm.stream({
        provider: d.provider, model: d.model, ...(d.reasoning ? { reasoningEffort: d.reasoning } : {}),
        system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], signal: local,
      })) {
        assembler.push(chunk)
        if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
          this.lastError = chunk.reason.kind === 'aborted' ? '已中止或超时' : String(chunk.reason.error?.message ?? chunk.reason.message ?? '模型返回错误')
          return undefined
        }
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return undefined
    }
    const text = assembler.blocks().filter((block: any) => block.type === 'text').map((block: any) => block.text).join('')
    const parsed = parseJson(text)
    if (parsed === undefined) this.lastError = `未返回 JSON：${text.slice(0, 120)}`
    return parsed
  }

  /** A provider configured only for this plugin: plain OpenAI-compatible chat completions. */
  private async askOpenAI(system: string, user: string, signal: AbortSignal): Promise<any | undefined> {
    const d = this.config().decision
    try {
      const key = d.apiKey ? await this.resolveKey(d.apiKey) : undefined
      const data = await http.json(chatCompletionsUrl(d.baseURL), {
        body: {
          model: d.model, temperature: 0, stream: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          ...(d.reasoning ? { reasoning_effort: d.reasoning } : {}),
        },
        headers: key ? { authorization: `Bearer ${key}` } : {}, signal, timeoutMs: d.timeoutMs,
      })
      const content = data?.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: any) => part?.text ?? '').join('') : ''
      const parsed = parseJson(text)
      if (parsed === undefined) this.lastError = `未返回 JSON：${text.slice(0, 120)}`
      return parsed
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  /** One small judgement to check the configured backend end to end (settings page "test"). */
  async probe(signal: AbortSignal): Promise<{ ok: boolean; detail: string; ms: number }> {
    const started = Date.now()
    const d = this.config().decision
    if (d.model === '' || ((d.backend ?? 'dsh') === 'openai' ? !d.baseURL?.trim() : d.provider === '')) return { ok: false, detail: '未选择供应商或模型', ms: 0 }
    if ((d.backend ?? 'dsh') === 'dsh' && !this.llm()) return { ok: false, detail: 'DSH 模型服务不可用', ms: 0 }
    const out = await this.ask('Reply with JSON only: {"ok":true}.', 'Health check.', signal)
    return out?.ok === true ? { ok: true, detail: '模型返回了有效 JSON', ms: Date.now() - started }
      : { ok: false, detail: out === undefined ? this.lastError || '调用失败、超时或未返回 JSON' : '返回内容不符合要求', ms: Date.now() - started }
  }

  /** Semantic fit 0–1 of each candidate source for the need. */
  async routeScores(need: SearchNeed, specs: SourceSpec[], signal: AbortSignal): Promise<Map<string, number> | undefined> {
    if (!this.enabled('route') || specs.length === 0) return undefined
    const list = specs.map(spec => `- ${spec.id}: ${spec.blurb} [types: ${spec.types.join(', ')}]`).join('\n')
    const out = await this.ask(
      'You route web searches to sources. Reply with JSON only: {"scores":{"<sourceId>":0.0-1.0}}. Score how well each source fits the need; omit sources you cannot judge.',
      `Need:\n${describeNeed(need)}\n\nSources:\n${list}`, signal)
    return numberMap(out?.scores, new Set(specs.map(spec => spec.id)))
  }

  /** Relevance 0–1 per candidate key, judged in one batch. */
  async relevance(need: SearchNeed, candidates: Candidate[], signal: AbortSignal): Promise<Map<string, number> | undefined> {
    if (!this.enabled('rerank') || candidates.length === 0) return undefined
    const batch = candidates.slice(0, this.config().decision.maxCandidates)
    const ids = new Map(batch.map((c, i) => [`c${i + 1}`, c.key]))
    const list = batch.map((c, i) => `c${i + 1}. ${c.title} | ${c.url}${c.publishedAt ? ` | ${c.publishedAt}` : ''}\n   ${c.snippet.slice(0, 300)}`).join('\n')
    const out = await this.ask(
      'You judge search results. Reply with JSON only: {"relevance":{"c1":0.0-1.0,...}}. 1 = directly answers the need and meets its constraints; keep counter-evidence relevant; omit items you cannot judge.',
      `Need:\n${describeNeed(need)}\n\nCandidates:\n${list}`, signal)
    const scores = numberMap(out?.relevance, new Set(ids.keys()))
    if (!scores) return undefined
    return new Map([...scores].map(([id, score]) => [ids.get(id)!, score]))
  }

  async followUp(need: SearchNeed, summary: string, untried: SourceSpec[], signal: AbortSignal): Promise<FollowUpAdvice | undefined> {
    if (!this.enabled('followup')) return undefined
    const out = await this.ask(
      'You decide whether a web search needs more material. Reply with JSON only: {"continue":true|false,"reason":"...","try_sources":["id"],"queries":["..."]}. Suggest only listed sources; queries must stay within the original need.',
      `Need:\n${describeNeed(need)}\n\nCurrent results:\n${summary}\n\nUntried sources:\n${untried.map(s => `- ${s.id}: ${s.blurb}`).join('\n') || '(none)'}`, signal)
    if (!out || typeof out.continue !== 'boolean') return undefined
    const allowed = new Set(untried.map(s => s.id))
    return {
      continue: out.continue, reason: typeof out.reason === 'string' ? out.reason.slice(0, 300) : '',
      trySources: Array.isArray(out.try_sources) ? out.try_sources.filter((id: unknown) => typeof id === 'string' && allowed.has(id)) : [],
      queries: Array.isArray(out.queries) ? out.queries.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3) : [],
    }
  }
}

export function describeNeed(need: SearchNeed): string {
  return [
    `queries: ${need.queries.join(' | ')}`, need.goal ? `goal: ${need.goal}` : '', need.types.length ? `types: ${need.types.join(', ')}` : '',
    need.preferOfficial ? 'prefer official sources' : '', need.sites.length ? `sites: ${need.sites.join(', ')}` : '',
    need.timeRange ? `time: past ${need.timeRange}` : '', need.after ? `after: ${need.after}` : '', need.before ? `before: ${need.before}` : '',
    need.version ? `version: ${need.version}` : '', need.language ? `language: ${need.language}` : '', need.region ? `region: ${need.region}` : '',
  ].filter(Boolean).join('\n')
}

export function parseJson(text: string): any | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try { return JSON.parse(fenced.slice(start, end + 1)) } catch { return undefined }
}

function numberMap(value: unknown, allowed: Set<string>): Map<string, number> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out = new Map<string, number>()
  for (const [key, score] of Object.entries(value)) {
    if (allowed.has(key) && typeof score === 'number' && Number.isFinite(score)) out.set(key, Math.max(0, Math.min(1, score)))
  }
  return out.size ? out : undefined
}
