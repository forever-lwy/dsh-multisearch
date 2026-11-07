/** Domain sources: papers, AI models and datasets, library documentation; and model-hosted search. */
import type { SourceAdapter, SourceHit, SourceQuery } from '../types.js'
import { SourceError, http } from '../http.js'
import { afterDate, arr, clip, hit, hits, joinUrl, num, requireKey, str } from './util.js'

export const consensus: SourceAdapter = {
  spec: {
    id: 'consensus', label: 'Consensus', engine: 'consensus', priority: 64,
    caps: { search: true }, types: ['academic'], filters: { time: true }, credential: 'CONSENSUS_API_KEY',
    blurb: '科学论文检索与证据综合，适合判断研究是否支持某种说法、比较结论',
  },
  async search(q, env) {
    const key = requireKey(env.apiKey, 'Consensus')
    const after = afterDate(q.need)
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.consensus.app', '/v1/search'), {
      query: { query: q.query, year_min: after?.slice(0, 4), year_max: q.need.before?.slice(0, 4), limit: Math.min(20, q.maxResults) },
      headers: { 'x-api-key': key, authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
    })
    const papers = arr(data.results ?? data.papers ?? data.data)
    return {
      hits: hits(papers.map(p => {
        const doi = str(p.doi)
        const url = str(p.url) ?? str(p.consensus_url) ?? str(p.link) ?? (doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//, '')}` : undefined)
        return hit(url, {
          title: str(p.title), snippet: clip(str(p.takeaway) ?? str(p.abstract) ?? str(p.summary), 600),
          publishedAt: str(p.year) ?? str(p.publish_year),
          meta: { ...(str(p.journal) ?? str(p.journal_name) ? { journal: (str(p.journal) ?? str(p.journal_name))! } : {}), ...(num(p.citation_count) !== undefined ? { citations: num(p.citation_count)! } : {}) },
        })
      })),
    }
  },
}

/** HF repo search matches ids by substring, so long questions need a short keyword form. */
function hfTerms(query: string): string[] {
  const words = query.toLowerCase().replace(/[^\p{L}\p{N}\-_.\s/]/gu, ' ').split(/\s+/).filter(word => word.length > 1)
  const stop = new Set(['the', 'for', 'and', 'with', 'best', 'model', 'models', 'dataset', 'datasets', 'how', 'what', 'which', 'to', 'of', 'in', 'on', 'a', 'an'])
  const useful = words.filter(word => !stop.has(word))
  return [...new Set([useful.slice(0, 3).join(' '), useful.slice(0, 2).join(' '), useful[0] ?? ''].filter(Boolean))]
}

export const huggingface: SourceAdapter = {
  spec: {
    id: 'huggingface', label: 'Hugging Face', engine: 'huggingface', priority: 60,
    caps: { search: true }, types: ['ai-models', 'academic'], filters: {}, credential: 'HF_TOKEN', keyOptional: true, defaultEnabled: true,
    blurb: '检索 AI 模型、数据集、Spaces 与 AI 论文，适合模型选型、数据集发现',
  },
  async search(q, env) {
    const headers: Record<string, string> = env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}
    const base = env.baseURL || 'https://huggingface.co'
    const per = Math.max(2, Math.ceil(q.maxResults / 3))
    const repo = async (kind: 'models' | 'datasets' | 'spaces'): Promise<SourceHit[]> => {
      for (const term of hfTerms(q.query)) {
        const data = await env.http.json(`${base}/api/${kind}`, { query: { search: term, limit: per, sort: kind === 'spaces' ? 'likes' : 'downloads', direction: -1, full: kind === 'models' ? undefined : undefined }, headers, signal: q.signal, timeoutMs: q.timeoutMs })
        const list = arr(data)
        if (list.length === 0) continue
        const prefix = kind === 'models' ? '' : `${kind}/`
        return hits(list.map(item => hit(`https://huggingface.co/${prefix}${item.id ?? item.modelId}`, {
          title: `${kind.slice(0, -1)}: ${item.id ?? item.modelId}`,
          snippet: clip([str(item.pipeline_tag), num(item.downloads) !== undefined ? `${item.downloads} downloads` : '', num(item.likes) !== undefined ? `${item.likes} likes` : '', arr(item.tags).slice(0, 6).join(', ')].filter(Boolean).join(' · '), 300),
          publishedAt: str(item.lastModified) ?? str(item.createdAt),
        })))
      }
      return []
    }
    const papers = async (): Promise<SourceHit[]> => {
      const data = await env.http.json(`${base}/api/papers/search`, { query: { q: q.query, limit: per }, headers, signal: q.signal, timeoutMs: q.timeoutMs })
      return hits(arr(data).slice(0, per).map(entry => {
        const paper = entry.paper ?? entry
        return hit(`https://huggingface.co/papers/${paper.id}`, { title: str(paper.title) ?? str(entry.title), snippet: clip(str(paper.summary) ?? str(paper.ai_summary), 500), publishedAt: str(paper.publishedAt) ?? str(entry.publishedAt) })
      }))
    }
    const wantPapers = q.need.types.includes('academic')
    const settled = await Promise.allSettled([repo('models'), repo('datasets'), ...(wantPapers || q.need.types.length === 0 ? [papers()] : []), repo('spaces')])
    const lists = settled.flatMap(s => s.status === 'fulfilled' ? [s.value] : [])
    if (lists.length === 0) throw (settled[0] as PromiseRejectedResult).reason
    const out: SourceHit[] = []
    for (let i = 0; out.length < q.maxResults && lists.some(list => i < list.length); i++) for (const list of lists) if (list[i] && out.length < q.maxResults) out.push(list[i]!)
    return { hits: out }
  },
}

/** Guess the library name from a docs question: an explicit `lib:` token, a site, or the first code-like term. */
function libraryHint(q: SourceQuery): string {
  const explicit = /(?:^|\s)lib(?:rary)?:(\S+)/i.exec(q.query)?.[1]
  if (explicit) return explicit
  const site = q.need.sites.find(s => /github\.com\/[^/]+\/[^/]+/.test(s))
  if (site) return site.replace(/^.*github\.com\//, '')
  const code = /[A-Za-z][\w.\-/@]*(?:\.js|\.py|js|-\w+)\b/.exec(q.query)?.[0]
  return code ?? q.query.split(/\s+/).slice(0, 2).join(' ')
}

const httpUrl = (value: unknown): string | undefined => { const text = str(value); return text && /^https?:\/\//.test(text) ? text : undefined }

export const context7: SourceAdapter = {
  spec: {
    id: 'context7', label: 'Context7', engine: 'context7', priority: 74,
    caps: { search: true }, types: ['documentation', 'code'], filters: {}, credential: 'CONTEXT7_API_KEY', keyOptional: true, defaultEnabled: true,
    blurb: '按库名与版本查询编程库/框架文档与代码示例，适合 API 用法、配置、升级迁移与报错排查',
  },
  async search(q, env) {
    const headers: Record<string, string> = env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}
    const base = env.baseURL || 'https://context7.com'
    const libs = await env.http.json(`${base}/api/v2/libs/search`, { query: { libraryName: libraryHint(q), query: q.query }, headers, signal: q.signal, timeoutMs: q.timeoutMs })
    const candidates = arr(libs.results).slice(0, 2)
    if (candidates.length === 0) return { hits: [] }
    const out: SourceHit[] = []
    for (const lib of candidates) {
      let libraryId = String(lib.id)
      if (q.need.version && !libraryId.includes('@') && !/\/v?\d/.test(libraryId.split('/').slice(3).join('/'))) libraryId = `${libraryId}@${q.need.version}`
      const ctx = await env.http.json(`${base}/api/v2/context`, { query: { libraryId, query: q.query, type: 'json' }, headers, signal: q.signal, timeoutMs: q.timeoutMs }).catch(() => undefined)
      if (!ctx) continue
      const page = `https://context7.com${String(lib.id).startsWith('/') ? '' : '/'}${lib.id}`
      const version = str(ctx.version?.version) ?? str(ctx.version?.served) ?? q.need.version
      for (const info of arr(ctx.infoSnippets).slice(0, 3)) {
        const h = hit(httpUrl(info.pageId) ?? httpUrl(info.url) ?? page, { title: `${str(lib.title) ?? lib.id}: ${clip(str(info.breadcrumb) ?? 'docs', 80)}`, snippet: clip(str(info.content), 600), content: str(info.content), meta: { library: String(lib.id), ...(version ? { version } : {}) } })
        if (h) out.push(h)
      }
      for (const code of arr(ctx.codeSnippets).slice(0, 3)) {
        const body = [str(code.codeDescription), ...arr(code.codeList).map(c => `\`\`\`${str(c.language) ?? ''}\n${str(c.code) ?? ''}\n\`\`\``)].filter(Boolean).join('\n')
        const h = hit(httpUrl(code.codeId) ?? httpUrl(code.url) ?? page, { title: `${str(lib.title) ?? lib.id}: ${str(code.codeTitle) ?? 'code example'}`, snippet: clip(body, 600), content: body, meta: { library: String(lib.id), ...(version ? { version } : {}) } })
        if (h) out.push(h)
      }
    }
    // Snippets from one library page share a URL; distinguish them so dedupe keeps each.
    const seen = new Map<string, number>()
    return {
      hits: out.slice(0, q.maxResults).map(h => {
        const n = (seen.get(h.url) ?? 0) + 1
        seen.set(h.url, n)
        return n === 1 ? h : { ...h, url: `${h.url}#snippet-${n}` }
      }),
    }
  },
}

function answerPrompt(q: SourceQuery): string {
  const constraints = [
    q.need.goal ? `Goal: ${q.need.goal}` : '',
    q.need.sites.length ? `Prefer these sites: ${q.need.sites.join(', ')}` : '',
    q.need.after || q.need.timeRange ? `Only use sources published after ${afterDate(q.need)}` : '',
    q.need.version ? `Version: ${q.need.version}` : '',
    q.need.language ? `Answer language: ${q.need.language}` : '',
  ].filter(Boolean).join('\n')
  return `Search the web and answer concisely with facts and their sources. Note disagreements between sources.\nQuestion: ${q.query}${constraints ? `\n${constraints}` : ''}`
}

/** Grounding links are redirect URLs; resolve them to the publisher URL when cheap. */
async function resolveRedirect(url: string, signal: AbortSignal): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(url)) return url
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) })
    return response.headers.get('location') ?? url
  } catch {
    return url
  }
}

export const gemini: SourceAdapter = {
  spec: {
    id: 'gemini', label: 'Gemini + Google Search', engine: 'google', priority: 55,
    caps: { search: true, answer: true }, types: ['answer', 'web', 'news'], filters: { site: true, time: true, language: true },
    credential: 'GOOGLE_API_KEY',
    blurb: '模型自动搜索 Google 并给出带来源的综合答案（生成内容，需与原文核对）',
    options: { model: 'gemini-2.5-flash' },
  },
  async search(q, env) {
    const key = requireKey(env.apiKey, 'Gemini')
    const model = String(env.options.model || 'gemini-2.5-flash')
    const data = await env.http.json(joinUrl(env.baseURL, 'https://generativelanguage.googleapis.com', `/v1beta/models/${encodeURIComponent(model)}:generateContent`), {
      body: { contents: [{ role: 'user', parts: [{ text: answerPrompt(q) }] }], tools: [{ google_search: {} }] },
      headers: { 'x-goog-api-key': key }, signal: q.signal, timeoutMs: q.timeoutMs,
    })
    const candidate = arr(data.candidates)[0]
    if (!candidate) throw new SourceError(`Gemini: ${str(data.promptFeedback?.blockReason) ?? 'no candidate'}`, 'upstream')
    const text = arr(candidate.content?.parts).map(p => str(p.text) ?? '').join('')
    const chunks = arr(candidate.groundingMetadata?.groundingChunks)
    const support = new Map<number, string[]>()
    for (const s of arr(candidate.groundingMetadata?.groundingSupports)) for (const index of arr(s.groundingChunkIndices)) {
      const list = support.get(index) ?? []
      if (str(s.segment?.text)) list.push(s.segment.text)
      support.set(index, list)
    }
    const resolved = await Promise.all(chunks.map(c => resolveRedirect(String(c.web?.uri ?? ''), q.signal)))
    return {
      generated: text || undefined,
      hits: hits(chunks.map((c, i) => hit(resolved[i], { title: str(c.web?.title), snippet: clip((support.get(i) ?? []).join(' … ') || undefined, 500), meta: { cited_by: 'gemini' } }))),
    }
  },
}

export const openai: SourceAdapter = {
  spec: {
    id: 'openai', label: 'OpenAI + Web Search', engine: 'openai', priority: 55,
    caps: { search: true, answer: true }, types: ['answer', 'web'], filters: { site: true, region: true },
    credential: 'OPENAI_API_KEY',
    blurb: 'Responses API 网页搜索，生成带引用的答案，适合多步查证（生成内容，需与原文核对）',
    options: { model: 'gpt-5-mini' },
  },
  async search(q, env) {
    const key = requireKey(env.apiKey, 'OpenAI')
    const tool: Record<string, unknown> = { type: 'web_search' }
    if (q.need.sites.length) tool.filters = { allowed_domains: q.need.sites.slice(0, 20) }
    if (q.need.region) tool.user_location = { type: 'approximate', country: q.need.region.toUpperCase() }
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.openai.com', '/v1/responses'), {
      body: { model: String(env.options.model || 'gpt-5-mini'), tools: [tool], input: answerPrompt(q) },
      headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
    })
    if (data.error) throw new SourceError(`OpenAI: ${str(data.error.message) ?? 'error'}`, 'upstream')
    let text = ''
    const found: SourceHit[] = []
    for (const item of arr(data.output)) {
      if (item.type !== 'message') continue
      for (const part of arr(item.content)) {
        if (part.type !== 'output_text') continue
        const base = text.length
        text += str(part.text) ?? ''
        for (const a of arr(part.annotations)) {
          if (a.type !== 'url_citation') continue
          const start = num(a.start_index) ?? 0
          const sentenceStart = Math.max(text.lastIndexOf('.', base + start - 1), text.lastIndexOf('\n', base + start - 1)) + 1
          const h = hit(str(a.url)?.replace(/[?&]utm_source=openai$/, ''), { title: str(a.title), snippet: clip(text.slice(sentenceStart, base + start), 400), meta: { cited_by: 'openai' } })
          if (h) found.push(h)
        }
      }
    }
    return { generated: text || undefined, hits: found }
  },
}

/** Generic Jina/Cohere-compatible rerank call used by the reranker stage. */
export async function rerankService(options: { url: string; apiKey?: string; model: string; query: string; documents: string[]; topN: number; signal: AbortSignal; timeoutMs: number }): Promise<{ index: number; score: number }[]> {
  const data = await http.json(options.url, {
    body: { model: options.model, query: options.query, documents: options.documents, top_n: options.topN },
    headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}, signal: options.signal, timeoutMs: options.timeoutMs,
  })
  return arr(data.results ?? data.data).map(r => ({ index: Number(r.index), score: Number(r.relevance_score ?? r.score ?? 0) })).filter(r => Number.isInteger(r.index))
}
