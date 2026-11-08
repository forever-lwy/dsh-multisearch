/** Remote used by the settings page: source readiness, credential writes, model list. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_FETCH_ORDER, PRESETS, sourceSettings, type Config } from './config.js'
import type { Engine } from './engine.js'
import { RESOURCE_TYPES } from './types.js'
import { SERVICE, credentialRequestSchema, skillSaveSchema, type MultisearchStatus, type ProviderModels, type SkillStatus } from './remote.js'
import type { SkillFile } from './skillfile.js'
import type { DecisionModel } from './decision.js'
import { DECISION_DEFAULT_KEY, RERANK_PROVIDERS, rerankTarget } from './presets.js'
import { rerankService } from './sources/index.js'
import type { ProbeResult } from './remote.js'

export interface ServiceDeps {
  decision: DecisionModel
  llm: () => any
  resolveKey: (ref: string) => Promise<string | undefined>
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export class MultisearchService extends TypertRemoteService {
  constructor(ctx: Context, private readonly engine: Engine, private readonly config: () => Config, private readonly skillFile?: SkillFile, private readonly deps?: ServiceDeps) {
    super(ctx, SERVICE)
  }

  private credentials(): any {
    return (this.ctx as any).get?.('credentials')
  }

  private async describe(ref: string): Promise<{ configured: boolean; writable: boolean }> {
    const service = this.credentials()
    try {
      if (service?.describe) {
        const info = await service.describe(credentialRef(ref))
        return { configured: Boolean(info.configured), writable: Boolean(info.writable) }
      }
    } catch { /* invalid reference */ }
    return { configured: Boolean(process.env[ref]), writable: false }
  }

  /** Only references the configuration actually uses may be written from the page. */
  private allowedRefs(): Set<string> {
    const config = this.config()
    const refs = new Set<string>()
    for (const spec of this.engine.specs()) {
      if (!spec.credential) continue
      const ref = sourceSettings(config, spec.id).apiKey || spec.credential
      refs.add(ref)
    }
    for (const ref of this.extraRefs(config)) refs.add(ref)
    return refs
  }

  /**
   * Credentials used outside sources: the rerank service and an own decision-model endpoint.
   * Preset references are always listed so the page can take a key right after switching
   * provider, before the switch itself is saved; custom references count once saved.
   */
  private extraRefs(config: Config): string[] {
    const refs: string[] = []
    const rerank = rerankTarget(config.rerank).apiKey
    if (rerank) refs.push(rerank)
    for (const preset of Object.values(RERANK_PROVIDERS)) if (preset.apiKey) refs.push(preset.apiKey)
    refs.push(config.decision.apiKey || DECISION_DEFAULT_KEY, DECISION_DEFAULT_KEY)
    return [...new Set(refs)]
  }

  @Remote
  async status(request: unknown, signal: AbortSignal): Promise<MultisearchStatus> {
    void request // the gateway matches wire fields to these parameter names; keep it "request"
    signal.throwIfAborted()
    const config = this.config()
    const routable = await this.engine.routable()
    const sources = await Promise.all(routable.map(async source => {
      const spec = this.engine.specs().find(s => s.id === source.spec.id)!
      const ref = spec.credential ? sourceSettings(config, spec.id).apiKey || spec.credential : undefined
      const credential = ref ? { ref, optional: Boolean(spec.keyOptional), ...(await this.describe(ref)) } : undefined
      const reasons = source as typeof source & { reason?: string }
      return {
        id: spec.id, label: spec.label, blurb: spec.blurb,
        search: Boolean(spec.caps.search), fetch: Boolean(spec.caps.fetch), map: Boolean(spec.caps.map),
        defaultTypes: [...spec.types], defaultPriority: spec.priority, defaultOptions: { ...(spec.options ?? {}) }, defaultEnabled: Boolean(spec.defaultEnabled),
        ...(credential ? { credential } : {}),
        searchReady: spec.caps.search ? { ok: source.usable, ...(source.usable ? {} : { reason: reasons.reason ?? '不可用' }) } : { ok: false, reason: '不支持搜索' },
        fetchReady: spec.caps.fetch ? { ok: Boolean(source.fetchUsable), ...(source.fetchUsable ? {} : { reason: source.fetchReason ?? '不可用' }) } : { ok: false, reason: '不支持抓取' },
      }
    }))
    const extra = await Promise.all(this.extraRefs(config).map(async ref => ({ ref, ...(await this.describe(ref)) })))
    return {
      sources, extraCredentials: extra, resourceTypes: [...RESOURCE_TYPES],
      presets: JSON.parse(JSON.stringify(PRESETS)), defaultFetchOrder: [...DEFAULT_FETCH_ORDER],
    }
  }

  @Remote
  async setCredential(request: unknown, signal: AbortSignal): Promise<{ configured: boolean }> {
    signal.throwIfAborted()
    const parsed = credentialRequestSchema.safeParse(request)
    if (!parsed.success || !parsed.data.value?.trim()) throw new RemoteError('gateway/bad-request', '请输入密钥。', {})
    return this.write(parsed.data.ref, parsed.data.value.trim())
  }

  @Remote
  async clearCredential(request: unknown, signal: AbortSignal): Promise<{ configured: boolean }> {
    signal.throwIfAborted()
    const parsed = credentialRequestSchema.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', '参数无效。', {})
    return this.write(parsed.data.ref, undefined)
  }

  private async write(ref: string, value: string | undefined): Promise<{ configured: boolean }> {
    if (!this.allowedRefs().has(ref)) throw new RemoteError('gateway/bad-request', `凭据引用 ${ref} 不属于本插件的设置。`, {})
    let parsed
    try { parsed = credentialRef(ref) } catch { throw new RemoteError('gateway/bad-request', `凭据引用 ${ref} 不合法。`, {}) }
    const service = this.credentials()
    const info = await this.describe(ref)
    if (!service?.set || !info.writable) throw new RemoteError('multisearch/credential-read-only' as any, `${ref} 由环境变量等只读来源提供，不能在此修改。`, {})
    try {
      if (value === undefined) await service.unset(parsed)
      else await service.set(parsed, value)
    } catch (error) {
      throw new RemoteError('multisearch/credential-save-failed' as any, `保存失败：${errorText(error)}`, {})
    }
    return { configured: (await this.describe(ref)).configured }
  }

  private skill(): SkillFile {
    if (!this.skillFile) throw new RemoteError('multisearch/skill-unavailable' as any, '技能文件不可用。', {})
    return this.skillFile
  }

  @Remote
  async skillStatus(request: unknown, signal: AbortSignal): Promise<SkillStatus> {
    void request
    signal.throwIfAborted()
    const config = this.config()
    return this.skill().status(config, config.research.skillMode ?? 'file')
  }

  @Remote
  async saveSkill(request: unknown, signal: AbortSignal): Promise<SkillStatus> {
    signal.throwIfAborted()
    const parsed = skillSaveSchema.safeParse(request)
    if (!parsed.success) throw new RemoteError('gateway/bad-request', '技能内容无效。', {})
    const config = this.config()
    if ((config.research.skillMode ?? 'file') !== 'file') throw new RemoteError('gateway/bad-request', '当前为内置模式，切换到文件模式后才能编辑技能文件。', {})
    try {
      await this.skill().save(config, parsed.data.content)
    } catch (error) {
      throw new RemoteError('multisearch/skill-save-failed' as any, `保存失败：${errorText(error)}`, {})
    }
    return this.skill().status(config, 'file')
  }

  @Remote
  async restoreSkill(request: unknown, signal: AbortSignal): Promise<SkillStatus> {
    void request
    signal.throwIfAborted()
    const config = this.config()
    if ((config.research.skillMode ?? 'file') !== 'file') throw new RemoteError('gateway/bad-request', '当前为内置模式，无需恢复技能文件。', {})
    try {
      await this.skill().restore(config)
    } catch (error) {
      throw new RemoteError('multisearch/skill-save-failed' as any, `恢复失败：${errorText(error)}`, {})
    }
    return this.skill().status(config, 'file')
  }

  @Remote
  async testDecision(request: unknown, signal: AbortSignal): Promise<ProbeResult> {
    void request
    if (!this.deps) return { ok: false, detail: '决策模型不可用', ms: 0 }
    return this.deps.decision.probe(AbortSignal.any([signal, AbortSignal.timeout(Math.max(5000, this.config().decision.timeoutMs + 2000))]))
  }

  @Remote
  async testRerank(request: unknown, signal: AbortSignal): Promise<ProbeResult> {
    void request
    const started = Date.now()
    const target = rerankTarget(this.config().rerank)
    if (!target.url || !target.model) return { ok: false, detail: '未填写重排服务地址或模型', ms: 0 }
    try {
      const apiKey = target.apiKey ? await this.deps?.resolveKey(target.apiKey) : undefined
      if (target.apiKey && !apiKey) return { ok: false, detail: `未配置 ${target.apiKey}`, ms: 0 }
      const results = await rerankService({
        url: target.url, apiKey, model: target.model, query: 'What is the capital of France?',
        documents: ['Paris is the capital and largest city of France.', 'Bananas are rich in potassium.'], topN: 2, signal, timeoutMs: 15_000,
      })
      const best = [...results].sort((a, b) => b.score - a.score)[0]
      if (!best) return { ok: false, detail: '服务没有返回结果', ms: Date.now() - started }
      return best.index === 0
        ? { ok: true, detail: `排序正确（${target.model}，得分 ${best.score.toFixed(3)}）`, ms: Date.now() - started }
        : { ok: false, detail: '服务有返回，但排序不符合预期', ms: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: errorText(error).slice(0, 300), ms: Date.now() - started }
    }
  }

  @Remote
  async models(request: unknown, signal: AbortSignal): Promise<ProviderModels> {
    void request
    const llm = this.deps?.llm() ?? (this.ctx as any).get?.('llm')
    if (!llm) return { providers: [] }
    const providers = (llm.listProviders?.() ?? []) as { id: string; name: string }[]
    return {
      providers: await Promise.all(providers.map(async provider => {
        try {
          signal.throwIfAborted()
          const models = await llm.listModels(provider.id) as { id: string; name?: string }[]
          return { provider: provider.id, name: provider.name || provider.id, models: models.map(model => ({ id: model.id, name: model.name || model.id })) }
        } catch (error) {
          return { provider: provider.id, name: provider.name || provider.id, models: [], error: errorText(error) }
        }
      })),
    }
  }
}
