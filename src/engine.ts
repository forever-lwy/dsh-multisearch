/** Orchestration: source registry, search with follow-up, fetch with fallback, crawl. */
import type { Config, Tuning } from './config.js'
import { effectiveTuning, sourceSettings } from './config.js'
import type { AdapterEnv, Candidate, FetchedPage, ProfileName, ResourceType, SearchNeed, SourceAdapter, SourceRun, StopReason } from './types.js'
import { STATIC_ADAPTERS, builtinWeb, directHttp, rerankService } from './sources/index.js'
import { SourceError, errorCode, errorText, http, pool, redact } from './http.js'
import { type RoutableSource, type RoutePlan, planRoute } from './router.js'
import { type RankedList, diversify, fuse, mergeHits, rerank } from './aggregate.js'
import type { DecisionModel, FollowUpAdvice } from './decision.js'
import type { PageCache, PageRecord, RefEntry, TaskStore } from './store.js'
import { hostOf, jaccard, matchesSite, normalizeDate, tokens, urlKey } from './text.js'
import { keywordExcerpt, rangeExcerpt } from './excerpt.js'
import { markdownLinks } from './html.js'

export interface EngineDeps {
  config: () => Config
  resolveKey: (ref: string) => Promise<string | undefined>
  web: () => unknown
  decision: DecisionModel
  cache: PageCache
}

export interface SearchInput {
  need: SearchNeed
  sources: string[]
  profile?: ProfileName
  tuning: Partial<Tuning>
  more?: string
}

export interface ResultItem {
  ref: string
  title: string
  url: string
  snippet: string
  sources: string[]
  publishedAt?: string
  version?: string
  kind: 'snippet' | 'page'
  readStatus: RefEntry['status']
  flags: string[]
  alsoAt?: string[]
  meta?: Record<string, string | number | boolean>
}

export interface SearchOutcome {
  searchId: string
  results: ResultItem[]
  generated: { source: string; query: string; text: string }[]
  remaining: number
  stats: { rawHits: number; unique: number; duplicateRatio: number; elapsedMs: number; rounds: number; profile: string }
  route: { mode: RoutePlan['mode'] | 'more'; sources: { id: string; reasons: string[] }[]; unavailable: { id: string; reason: string }[]; inferredTypes: ResourceType[] }
  runs: SourceRun[]
  stop: StopReason
  followUp?: { reasons: string[]; performed: string[]; suggestedSources: string[]; suggestedQueries: string[]; advice?: string }
  budget: { outputTokens: number; trimmed: number }
}

export interface FetchInput {
  targets: string[]
  keywords: string[]
  offset: number
  maxChars?: number
  contextChars: number
  live: boolean
  services: string[]
  focus?: string
  profile?: ProfileName
  tuning: Partial<Tuning>
  crawl?: { mode: 'map' | 'crawl'; maxPages: number; maxDepth: number; includePaths: string[]; excludePaths: string[]; sameDomain: boolean }
}

export type PageStatus = 'ok' | 'partial' | 'blocked' | 'empty' | 'failed' | 'timeout'

export interface FetchAttempt { service: string; status: PageStatus | 'error'; ms: number; error?: string }

export interface FetchItem {
  ref?: string
  url: string
  finalUrl?: string
  title?: string
  status: PageStatus
  service?: string
  fromCache: boolean
  attempts: FetchAttempt[]
  content: string
  view: 'range' | 'keywords' | 'none'
  totalChars: number
  range?: [number, number]
  nextOffset?: number
  matches?: number
  truncated: boolean
  publishedAt?: string
  error?: string
}

export interface FetchOutcome {
  items: FetchItem[]
  map?: { url: string; title?: string; ref?: string }[]
  elapsedMs: number
  stop: StopReason
}

const BLOCKED = /(verify (that )?you are (a )?human|are you a robot|captcha|enable javascript|javascript is (disabled|required)|access denied|request blocked|unusual traffic|cloudflare|just a moment\.\.\.|attention required|sign in to (continue|view)|log in to (continue|view)|please log in|登录后(查看|继续)|请先登录|验证码|安全验证|访问受限|请开启\s*javascript)/i

export class Engine {
  private readonly adapters = new Map<string, SourceAdapter>()

  constructor(private readonly deps: EngineDeps) {
    for (const adapter of STATIC_ADAPTERS) this.adapters.set(adapter.spec.id, adapter)
    this.adapters.set('builtin', builtinWeb(() => deps.web()))
    this.adapters.set('http', directHttp(() => deps.config().fetching.allowPrivateNetwork))
  }

  get config(): Config { return this.deps.config() }

  specs() { return [...this.adapters.values()].map(a => a.spec) }

  private async env(id: string): Promise<AdapterEnv> {
    const settings = sourceSettings(this.config, id)
    const apiKey = settings.apiKey ? await this.deps.resolveKey(settings.apiKey).catch(() => undefined) : undefined
    return { apiKey, baseURL: settings.baseURL || undefined, options: settings.options, http }
  }

  /** Enabled state, settings and credential readiness for every source. */
  async routable(): Promise<RoutableSource[]> {
    return Promise.all([...this.adapters.values()].map(async adapter => {
      const settings = sourceSettings(this.config, adapter.spec.id)
      let usable = true
      if (settings.enabled && adapter.spec.credential && !adapter.spec.keyOptional) usable = (await this.env(adapter.spec.id)).apiKey !== undefined
      if (adapter.spec.id === 'crawl4ai') usable = settings.baseURL !== ''
      if (adapter.spec.id === 'brightdata') usable = usable && Boolean(settings.options.serpZone || settings.options.unlockerZone)
      return { spec: { ...adapter.spec, types: settings.types }, settings, usable }
    }))
  }

  // ---------------------------------------------------------------- search

  async search(input: SearchInput, store: TaskStore, signal: AbortSignal): Promise<SearchOutcome> {
    const started = Date.now()
    const config = this.config
    const tuning = effectiveTuning(config, input.profile, input.tuning)
    if (input.more) return this.more(input.more, tuning, store, started)
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(tuning.callTimeoutMs)])
    const remaining = () => tuning.callTimeoutMs - (Date.now() - started)
    const need = input.need
    const sources = await this.routable()
    const specs = new Map(sources.map(s => [s.spec.id, s]))

    let semantic: Map<string, number> | undefined
    if (input.sources.length === 0 && this.deps.decision.enabled('route')) {
      const usable = sources.filter(s => s.spec.caps.search && s.settings.enabled && s.usable).map(s => s.spec)
      semantic = await this.deps.decision.routeScores(need, usable, deadline)
    }
    const plan = planRoute({ need, explicit: input.sources, config, sources, count: tuning.parallelSources, semantic })
    const runs: SourceRun[] = []
    const generated: SearchOutcome['generated'] = []
    const lists: RankedList[] = []
    const tried = new Set<string>()
    const performed: string[] = []
    const weight = (id: string) => Math.max(0.2, (specs.get(id)?.settings.priority ?? 50) / 50)

    const runRound = async (ids: string[], queries: string[], round: number) => {
      const tasks = ids.flatMap(id => queries.map(query => ({ id, query })))
      for (const id of ids) tried.add(id)
      await pool(tasks, tuning.queryConcurrency, async ({ id, query }) => {
        const t0 = Date.now()
        const adapter = this.adapters.get(id)!
        if (deadline.aborted) { runs.push({ source: id, query, status: signal.aborted ? 'cancelled' : 'skipped', hits: 0, ms: 0, round, error: 'call deadline reached' }); return }
        const timeoutMs = Math.max(1000, Math.min(tuning.requestTimeoutMs, remaining()))
        let env: AdapterEnv | undefined
        try {
          env = await this.env(id)
          const result = await adapter.search!({ query, need, maxResults: tuning.perSourceResults, signal: deadline, timeoutMs }, env)
          lists.push({ source: id, query, weight: weight(id), hits: result.hits.slice(0, tuning.perSourceResults) })
          if (result.generated) generated.push({ source: id, query, text: result.generated })
          runs.push({ source: id, query, status: result.hits.length ? 'ok' : 'empty', hits: result.hits.length, ms: Date.now() - t0, round })
        } catch (error) {
          const code = errorCode(error)
          runs.push({
            source: id, query, status: code === 'timeout' ? 'timeout' : code === 'cancelled' ? (signal.aborted ? 'cancelled' : 'timeout') : 'error',
            hits: 0, ms: Date.now() - t0, round, error: redact(errorText(error), [env?.apiKey]).slice(0, 300),
          })
        }
      })
    }

    await runRound(plan.chosen.map(c => c.id), need.queries, 0)
    let merged = mergeHits(lists)
    let rounds = 1
    let reasons = this.followUpReasons(need, merged.candidates.size, merged.stats.duplicateRatio, tuning, lists, specs, runs, plan.chosen.length)
    let advice: FollowUpAdvice | undefined
    const altQueries = need.altQueries.filter(q => !need.queries.includes(q))
    const usedAlt = new Set<string>()
    const reusedExtra = new Map<string, Candidate>()

    while (reasons.length && rounds <= tuning.followUpRounds && !deadline.aborted && remaining() > tuning.requestTimeoutMs * 0.5) {
      const untried = plan.mode === 'explicit' ? [] : plan.reserve.filter(c => !tried.has(c.id))
      if (this.deps.decision.enabled('followup')) {
        advice = await this.deps.decision.followUp(need, this.summary(merged.candidates), untried.map(c => specs.get(c.id)!.spec), deadline)
        if (advice && !advice.continue) { reasons = []; break }
      }
      if (!tuning.autoFollowUp) break
      // Reuse candidates this task already holds before spending new calls.
      const reused = this.reuseFromStore(store, need, merged.candidates, reusedExtra)
      if (reused) performed.push(`复用已有候选 ${reused} 条`)
      const missing = reasons.includes('missing-types') ? this.missingTypes(need, lists, specs) : []
      const pick = [
        ...(advice?.trySources ?? []).filter(id => untried.some(c => c.id === id)),
        ...untried.filter(c => missing.some(type => specs.get(c.id)!.settings.types.includes(type))).map(c => c.id),
        ...untried.map(c => c.id),
      ].filter((id, index, all) => all.indexOf(id) === index).slice(0, Math.max(1, tuning.parallelSources))
      let queries = need.queries
      let ids = pick
      if (ids.length === 0) {
        // No source left in scope: try the caller's alternative queries on sources that answered.
        const fresh = altQueries.filter(q => !usedAlt.has(q)).slice(0, need.queries.length || 1)
        if (fresh.length === 0) break
        fresh.forEach(q => usedAlt.add(q))
        queries = fresh
        ids = [...new Set(runs.filter(r => r.status === 'ok').map(r => r.source))]
        if (ids.length === 0) ids = [...tried].filter(id => runs.some(r => r.source === id && r.status !== 'error'))
        if (ids.length === 0) break
      }
      performed.push(`第 ${rounds} 轮补搜：${ids.join(', ')}${queries === need.queries ? '' : `（备选查询：${queries.join(' | ')}）`}`)
      await runRound(ids, queries, rounds)
      merged = mergeHits(lists)
      for (const [key, candidate] of reusedExtra) if (!merged.candidates.has(key)) merged.candidates.set(key, candidate)
      rounds++
      reasons = this.followUpReasons(need, merged.candidates.size, merged.stats.duplicateRatio, tuning, lists, specs, runs, tried.size)
    }

    // Rank.
    const candidates = [...merged.candidates.values()]
    fuse(candidates, new Map([...tried].map(id => [id, weight(id)])))
    candidates.sort((a, b) => b.score - a.score)
    const pool_ = candidates.slice(0, tuning.candidateLimit)
    let relevance: Map<string, number> | undefined
    if (tuning.rerank && !deadline.aborted) {
      if (config.rerank.mode === 'service') relevance = await this.serviceRelevance(need, pool_, deadline).catch(() => undefined)
      if (!relevance && (config.rerank.mode === 'model' || this.deps.decision.enabled('rerank'))) relevance = await this.deps.decision.relevance(need, pool_, deadline)
    }
    const ranked = tuning.rerank
      ? diversify(rerank(pool_, { need, officialDomains: config.routing.officialDomains, relevance, keepThreshold: config.decision.keepThreshold }), pool_.length)
      : pool_

    const entries = ranked.map(c => ({ candidate: c, entry: store.refFor({ url: c.url, title: c.title, snippet: c.snippet, publishedAt: c.publishedAt, sources: [...c.ranks.keys()] }) }))
    const { shown, trimmed } = this.fitBudget(entries.map(e => this.item(e.entry, e.candidate, tuning)), tuning)
    const record = store.saveSearch(need, entries.map(e => e.entry.ref), shown.length)

    const failed = runs.filter(r => r.status === 'error' || r.status === 'timeout')
    const stop: StopReason = signal.aborted ? 'cancelled'
      : deadline.aborted ? 'timeout'
      : failed.length && failed.length < runs.length ? 'partial'
      : failed.length === runs.length && runs.length > 0 ? 'partial'
      : 'completed'
    const unusedAlt = altQueries.filter(q => !usedAlt.has(q))
    const suggestions = reasons.length ? {
      suggestedSources: (plan.mode === 'explicit' ? [] : plan.reserve.filter(c => !tried.has(c.id)).map(c => c.id)).slice(0, 4),
      suggestedQueries: [...unusedAlt, ...(advice?.queries ?? [])].slice(0, 4),
    } : { suggestedSources: [], suggestedQueries: [] }
    return {
      searchId: record.id,
      results: shown,
      generated: generated.map(g => ({ ...g, text: g.text.slice(0, Math.max(400, Math.floor(tuning.outputTokens * 0.8))) })),
      remaining: entries.length - shown.length,
      stats: { ...merged.stats, elapsedMs: Date.now() - started, rounds, profile: input.profile ?? config.profile },
      route: { mode: plan.mode, sources: [...tried].map(id => ({ id, reasons: plan.chosen.find(c => c.id === id)?.reasons ?? plan.reserve.find(c => c.id === id)?.reasons ?? ['补搜'] })), unavailable: plan.unavailable, inferredTypes: plan.inferredTypes },
      runs,
      stop,
      followUp: reasons.length || performed.length ? { reasons, performed, ...suggestions, ...(advice?.reason ? { advice: advice.reason } : {}) } : undefined,
      budget: { outputTokens: tuning.outputTokens, trimmed },
    }
  }

  private more(id: string, tuning: Tuning, store: TaskStore, started: number): SearchOutcome {
    const record = store.search(id)
    if (!record) throw new SourceError(`没有找到搜索 ${id}（只在当前任务内保留）`, 'not_found')
    const refs = record.ranked.slice(record.shown)
    const items = refs.map(ref => store.get(ref)).filter((e): e is RefEntry => e !== undefined).map(entry => this.item(entry, undefined, tuning))
    const { shown, trimmed } = this.fitBudget(items, tuning)
    record.shown += shown.length
    return {
      searchId: record.id, results: shown, generated: [], remaining: record.ranked.length - record.shown,
      stats: { rawHits: 0, unique: record.ranked.length, duplicateRatio: 0, elapsedMs: Date.now() - started, rounds: 0, profile: 'more' },
      route: { mode: 'more', sources: [], unavailable: [], inferredTypes: [] }, runs: [], stop: 'completed', budget: { outputTokens: tuning.outputTokens, trimmed },
    }
  }

  private item(entry: RefEntry, candidate: Candidate | undefined, tuning: Tuning): ResultItem {
    const snippet = (candidate?.snippet || entry.snippet || '').replace(/\s+/g, ' ').trim()
    return {
      ref: entry.ref, title: entry.title, url: entry.url,
      snippet: snippet.length > tuning.snippetChars ? `${snippet.slice(0, tuning.snippetChars - 1)}…` : snippet,
      sources: candidate ? [...candidate.ranks.keys()] : entry.sources,
      ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
      ...(candidate?.version ? { version: candidate.version } : {}),
      kind: entry.page ? 'page' : 'snippet', readStatus: entry.status,
      flags: candidate ? [...candidate.flags] : [],
      ...(candidate?.alsoAt.length ? { alsoAt: candidate.alsoAt.slice(0, 3) } : {}),
      ...(candidate && Object.keys(candidate.meta).length ? { meta: candidate.meta } : {}),
    }
  }

  /** Keep results while they fit the output budget; always keep at least one. */
  private fitBudget(items: ResultItem[], tuning: Tuning): { shown: ResultItem[]; trimmed: number } {
    const shown: ResultItem[] = []
    let used = 250
    for (const item of items.slice(0, tuning.returnResults)) {
      const cost = Math.ceil(estimate(`${item.title} ${item.url} ${item.snippet}`) + 25)
      if (shown.length > 0 && used + cost > tuning.outputTokens) break
      shown.push(item)
      used += cost
    }
    return { shown, trimmed: Math.max(0, Math.min(items.length, tuning.returnResults) - shown.length) }
  }

  private followUpReasons(need: SearchNeed, unique: number, duplicateRatio: number, tuning: Tuning, lists: RankedList[], specs: Map<string, RoutableSource>, runs: SourceRun[], sourceCount: number): string[] {
    const reasons: string[] = []
    if (runs.length > 0 && runs.every(r => r.status !== 'ok')) reasons.push('all-failed')
    if (unique < tuning.minResults) reasons.push('few-results')
    if (sourceCount > 1 && duplicateRatio > tuning.duplicateRatio) reasons.push('high-duplication')
    if (this.missingTypes(need, lists, specs).length) reasons.push('missing-types')
    return reasons
  }

  private missingTypes(need: SearchNeed, lists: RankedList[], specs: Map<string, RoutableSource>): ResourceType[] {
    const covered = new Set<ResourceType>()
    for (const list of lists) if (list.hits.length) for (const type of specs.get(list.source)?.settings.types ?? []) covered.add(type)
    return need.types.filter(type => type !== 'answer' && !covered.has(type))
  }

  private reuseFromStore(store: TaskStore, need: SearchNeed, candidates: Map<string, Candidate>, extra: Map<string, Candidate>): number {
    const queryTokens = new Set(tokens(need.queries.join(' ')))
    if (queryTokens.size === 0) return 0
    let added = 0
    const seen = new Set(candidates.keys())
    for (const record of store.recentSearches()) {
      if (added >= 10) break
      for (const ref of record.ranked) {
        const entry = store.get(ref)
        if (!entry || seen.has(urlKey(entry.url))) continue
        const overlap = jaccard(new Set(tokens(`${entry.title} ${entry.snippet}`)), queryTokens)
        if (overlap < 0.15 || (need.sites.length && !need.sites.some(site => matchesSite(entry.url, site)))) continue
        const candidate: Candidate = {
          key: urlKey(entry.url), url: entry.url, title: entry.title, snippet: entry.snippet, publishedAt: entry.publishedAt,
          ranks: new Map([['reused', [5 + added]]]), queries: new Set(), alsoAt: [], meta: {}, score: 0, flags: new Set(['reused']),
        }
        candidates.set(candidate.key, candidate)
        extra.set(candidate.key, candidate)
        seen.add(urlKey(entry.url))
        added++
      }
    }
    return added
  }

  private summary(candidates: Map<string, Candidate>): string {
    return [...candidates.values()].slice(0, 12).map(c => `- ${c.title} (${hostOf(c.url)}): ${c.snippet.slice(0, 160)}`).join('\n') || '(no results)'
  }

  private async serviceRelevance(need: SearchNeed, candidates: Candidate[], signal: AbortSignal): Promise<Map<string, number> | undefined> {
    const cfg = this.config.rerank
    const apiKey = cfg.apiKey ? await this.deps.resolveKey(cfg.apiKey).catch(() => undefined) : undefined
    const results = await rerankService({
      url: cfg.url, apiKey, model: cfg.model, query: [need.goal, ...need.queries].filter(Boolean).join(' '),
      documents: candidates.map(c => `${c.title}\n${c.snippet}`), topN: candidates.length, signal, timeoutMs: 10_000,
    })
    if (results.length === 0) return undefined
    const max = Math.max(...results.map(r => r.score), 1e-9)
    return new Map(results.filter(r => candidates[r.index]).map(r => [candidates[r.index]!.key, max > 1 ? r.score / max : r.score]))
  }

  // ---------------------------------------------------------------- fetch

  async fetch(input: FetchInput, store: TaskStore, signal: AbortSignal): Promise<FetchOutcome> {
    const started = Date.now()
    const tuning = effectiveTuning(this.config, input.profile, input.tuning)
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(tuning.callTimeoutMs)])
    const maxChars = Math.min(this.config.limits.maxFetchChars, input.maxChars ?? tuning.fetchMaxChars)
    const sources = await this.routable()
    let map: FetchOutcome['map']
    let targets = input.targets
    if (input.crawl) {
      const crawl = input.crawl
      const links = await this.discover(targets[0]!, crawl, sources, tuning, store, deadline)
      if (crawl.mode === 'map') {
        map = links.map(link => ({ ...link, ref: store.refFor({ url: link.url, title: link.title ?? link.url, snippet: '' }).ref }))
        return { items: [], map, elapsedMs: Date.now() - started, stop: deadline.aborted ? 'timeout' : 'completed' }
      }
      targets = [targets[0]!, ...links.map(link => link.url)].filter((url, i, all) => all.indexOf(url) === i).slice(0, crawl.maxPages)
    }
    const perPage = input.crawl ? Math.max(1500, Math.floor(maxChars * 2 / Math.max(1, targets.length))) : maxChars
    const items = await pool(targets, tuning.fetchConcurrency, target => this.fetchOne(target, input, perPage, tuning, sources, store, deadline, started))
    const stop: StopReason = signal.aborted ? 'cancelled' : deadline.aborted ? 'timeout' : items.some(i => i.status !== 'ok') ? 'partial' : 'completed'
    return { items, ...(map ? { map } : {}), elapsedMs: Date.now() - started, stop }
  }

  private fetchOrder(url: string, input: FetchInput, sources: RoutableSource[], tuning: Tuning): string[] {
    const usable = new Map(sources.filter(s => s.spec.caps.fetch && s.settings.enabled && s.usable).map(s => [s.spec.id, s]))
    if (input.services.length) return input.services.filter(id => usable.has(id))
    let order = this.config.fetching.order.filter(id => usable.has(id))
    for (const id of usable.keys()) if (!order.includes(id)) order.push(id)
    const host = hostOf(url)
    const front = (predicate: (s: RoutableSource) => boolean) => { order = [...order.filter(id => predicate(usable.get(id)!)), ...order.filter(id => !predicate(usable.get(id)!))] }
    if (this.config.fetching.preferRender.some(domain => host === domain || host.endsWith(`.${domain}`))) front(s => Boolean(s.spec.caps.render))
    if (/\.pdf($|\?)/i.test(url)) front(s => Boolean(s.spec.caps.pdf))
    front(s => (s.spec.hosts ?? []).some(h => host === h || host.endsWith(`.${h}`)))
    return order.slice(0, tuning.fetchFallbacks)
  }

  private assess(page: FetchedPage): PageStatus {
    const text = page.content.trim()
    if (page.statusCode !== undefined && page.statusCode >= 400) return BLOCKED.test(text.slice(0, 3000)) || [401, 403, 429].includes(page.statusCode) ? 'blocked' : 'failed'
    if (text.length < this.config.fetching.minContentChars) return BLOCKED.test(text) ? 'blocked' : 'empty'
    if (text.length < 2500 && BLOCKED.test(text)) return 'blocked'
    if (page.truncated) return 'partial'
    return 'ok'
  }

  private async fetchOne(target: string, input: FetchInput, maxChars: number, tuning: Tuning, sources: RoutableSource[], store: TaskStore, deadline: AbortSignal, started: number): Promise<FetchItem> {
    const ref = /^S\d+$/i.test(target.trim()) ? store.get(target.trim()) : undefined
    if (/^S\d+$/i.test(target.trim()) && !ref) return { url: target, status: 'failed', fromCache: false, attempts: [], content: '', view: 'none', totalChars: 0, truncated: false, error: `未知引用 ${target}（只在当前任务内有效）` }
    const url = ref?.url ?? target.trim()
    if (!/^https?:\/\//i.test(url)) return { url, status: 'failed', fromCache: false, attempts: [], content: '', view: 'none', totalChars: 0, truncated: false, error: '需要 http(s) URL 或搜索结果引用（如 S3）' }
    const entry = ref ?? store.refFor({ url, title: url, snippet: '' })
    const attempts: FetchAttempt[] = []
    const ttl = tuning.cacheTtlMinutes * 60_000
    let page: PageRecord | undefined
    let fromCache = false
    if (!input.live) {
      const known = entry.page && Date.now() - entry.page.fetchedAt <= ttl ? entry.page : this.deps.cache.get(url, ttl)
      if (known) { page = known; fromCache = true }
    }
    let best: { page: FetchedPage; status: PageStatus; service: string } | undefined
    if (!page) {
      for (const id of this.fetchOrder(url, input, sources, tuning)) {
        if (deadline.aborted) break
        const adapter = this.adapters.get(id)!
        const env = await this.env(id)
        let done = false
        for (let attempt = 0; attempt <= tuning.fetchRetries && !done; attempt++) {
          const left = tuning.callTimeoutMs - (Date.now() - started)
          if (left < 800) break
          const t0 = Date.now()
          try {
            const fetched = await adapter.fetch!({ url, signal: deadline, timeoutMs: Math.min(tuning.requestTimeoutMs, left), maxChars, live: input.live, focus: input.focus }, env)
            const status = this.assess(fetched)
            attempts.push({ service: id, status, ms: Date.now() - t0 })
            if (status === 'ok' || status === 'partial') {
              if (!best || best.status === 'partial' && (status === 'ok' || fetched.content.length > best.page.content.length)) best = { page: fetched, status, service: id }
            }
            done = true
          } catch (error) {
            const code = errorCode(error)
            attempts.push({ service: id, status: code === 'timeout' ? 'timeout' : 'error', ms: Date.now() - t0, error: redact(errorText(error), [env.apiKey]).slice(0, 200) })
            if (!['timeout', 'network', 'upstream', 'rate_limited'].includes(code)) done = true
          }
        }
        if (best?.status === 'ok') break
      }
      if (best) {
        page = {
          url, finalUrl: best.page.finalUrl, title: best.page.title, content: best.page.content, service: best.service,
          fetchedAt: Date.now(), status: best.status === 'ok' ? 'ok' : 'partial', truncated: best.status === 'partial', publishedAt: normalizeDate(best.page.publishedAt),
        }
        this.deps.cache.set(page)
      }
    }
    if (!page) {
      entry.status = 'failed'
      const last = attempts[attempts.length - 1]
      const status: PageStatus = deadline.aborted && attempts.length === 0 ? 'timeout'
        : attempts.some(a => a.status === 'blocked') ? 'blocked' : attempts.some(a => a.status === 'empty') ? 'empty'
        : last?.status === 'timeout' ? 'timeout' : 'failed'
      return { ref: entry.ref, url, status, fromCache: false, attempts, content: '', view: 'none', totalChars: 0, truncated: false, error: attempts.length ? undefined : '没有可用的抓取服务' }
    }
    entry.page = page
    entry.status = page.status === 'ok' ? 'fetched' : 'partial'
    if (page.title && (entry.title === url || !entry.title)) entry.title = page.title
    const base = { ref: entry.ref, url, finalUrl: page.finalUrl, title: page.title, service: page.service, fromCache, attempts, totalChars: page.content.length, publishedAt: page.publishedAt }
    if (input.keywords.length) {
      const excerpt = keywordExcerpt(page.content, input.keywords, input.contextChars, maxChars)
      if (excerpt.matches > 0) return { ...base, status: page.status, content: excerpt.text, view: 'keywords', matches: excerpt.matches, truncated: excerpt.truncated || page.truncated, ...(excerpt.ranges.length ? { range: [excerpt.ranges[0]![0], excerpt.ranges[excerpt.ranges.length - 1]![1]] as [number, number] } : {}) }
    }
    const range = rangeExcerpt(page.content, input.offset, maxChars)
    return {
      ...base, status: page.status, content: range.text, view: 'range', range: [range.start, range.end],
      ...(range.nextOffset !== undefined ? { nextOffset: range.nextOffset } : {}),
      ...(input.keywords.length ? { matches: 0 } : {}),
      truncated: range.nextOffset !== undefined || page.truncated,
    }
  }

  /** Site discovery: a map service when available, else a bounded breadth-first walk over fetched pages. */
  private async discover(start: string, crawl: NonNullable<FetchInput['crawl']>, sources: RoutableSource[], tuning: Tuning, store: TaskStore, deadline: AbortSignal): Promise<{ url: string; title?: string }[]> {
    const startUrl = /^S\d+$/i.test(start) ? store.get(start)?.url ?? start : start
    const origin = hostOf(startUrl)
    const allowed = (url: string) => {
      if (!/^https?:\/\//.test(url)) return false
      const host = hostOf(url)
      if (crawl.sameDomain && host !== origin && !host.endsWith(`.${origin}`)) return false
      let path = '/'
      try { path = new URL(url).pathname } catch { return false }
      if (crawl.includePaths.length && !crawl.includePaths.some(p => path.startsWith(p))) return false
      if (crawl.excludePaths.some(p => path.startsWith(p))) return false
      return !/\.(png|jpe?g|gif|svg|webp|ico|css|js|zip|gz|mp4|mp3|woff2?)($|\?)/i.test(path)
    }
    const limit = crawl.mode === 'map' ? crawl.maxPages * 5 : crawl.maxPages
    for (const id of ['tavily', 'firecrawl']) {
      const source = sources.find(s => s.spec.id === id)
      if (!source?.settings.enabled || !source.usable) continue
      try {
        const links = await this.adapters.get(id)!.map!({ url: startUrl, maxDepth: crawl.maxDepth, maxPages: crawl.maxPages, includePaths: crawl.includePaths, excludePaths: crawl.excludePaths, sameDomain: crawl.sameDomain, signal: deadline, timeoutMs: tuning.requestTimeoutMs }, await this.env(id))
        const filtered = links.filter(link => allowed(link.url))
        if (filtered.length) return dedupeLinks(filtered).slice(0, limit)
      } catch { /* fall through to the walk */ }
    }
    const seen = new Set([urlKey(startUrl)])
    const out: { url: string; title?: string }[] = []
    let frontier = [startUrl]
    for (let depth = 0; depth < crawl.maxDepth && frontier.length && out.length < limit && !deadline.aborted; depth++) {
      const next: string[] = []
      const pages = await pool(frontier.slice(0, 8), tuning.fetchConcurrency, url => this.fetchOne(url, { targets: [], keywords: [], offset: 0, contextChars: 0, live: false, services: [], tuning: {} }, 200_000, tuning, sources, store, deadline, Date.now()))
      for (const [index, item] of pages.entries()) {
        const full = store.byUrl(frontier[index]!)?.page?.content ?? item.content
        for (const link of markdownLinks(full, item.finalUrl ?? frontier[index]!)) {
          const key = urlKey(link.url)
          if (seen.has(key) || !allowed(link.url)) continue
          seen.add(key)
          out.push({ url: link.url.split('#')[0]!, ...(link.text ? { title: link.text } : {}) })
          next.push(link.url)
          if (out.length >= limit) break
        }
      }
      frontier = next
    }
    return out
  }
}

function dedupeLinks(links: { url: string; title?: string }[]): { url: string; title?: string }[] {
  const seen = new Set<string>()
  return links.filter(link => { const key = urlKey(link.url); if (seen.has(key)) return false; seen.add(key); return true })
}

function estimate(text: string): number {
  let cjk = 0
  for (const char of text) if (char >= '　' && char <= '鿿') cjk++
  return cjk + (text.length - cjk) / 4
}
