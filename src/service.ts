/** Remote used by the settings page: source readiness, credential writes, model list. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_FETCH_ORDER, PRESETS, sourceSettings, type Config } from './config.js'
import type { Engine } from './engine.js'
import { RESOURCE_TYPES } from './types.js'
import { SERVICE, credentialRequestSchema, type MultisearchStatus, type ProviderModels } from './remote.js'

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

export class MultisearchService extends TypertRemoteService {
  constructor(ctx: Context, private readonly engine: Engine, private readonly config: () => Config) {
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
    if (config.rerank.apiKey) refs.add(config.rerank.apiKey)
    return refs
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
    const extra = config.rerank.apiKey ? [{ ref: config.rerank.apiKey, ...(await this.describe(config.rerank.apiKey)) }] : []
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

  @Remote
  async models(request: unknown, signal: AbortSignal): Promise<ProviderModels> {
    void request
    const llm = (this.ctx as any).get?.('llm')
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
