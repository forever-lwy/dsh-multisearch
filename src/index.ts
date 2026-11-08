/**
 * dsh-multisearch: multi-source `search` and `fetch` tools plus a deep-research skill.
 * @module @forever-lwy/dsh-multisearch
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { Config as ConfigSchema, snapshotConfig, type Config as MultisearchConfig } from './config.js'
import { remoteInfo } from './remote.js'
import { MultisearchService } from './service.js'
import { Engine } from './engine.js'
import { DecisionModel } from './decision.js'
import { PageCache, StoreRegistry } from './store.js'
import { registerTools } from './tools.js'
import { registerSkill } from './skill.js'
import { SkillFile } from './skillfile.js'

export const name = 'dsh-multisearch'
export const inject = ['tools', 'systemPrompt']
export const Config = ConfigSchema

export { Engine } from './engine.js'
export { PRESETS, effectiveTuning, snapshotConfig } from './config.js'
export { MultisearchService } from './service.js'
export type { MultisearchConfig }
export { planRoute, inferTypes } from './router.js'
export { mergeHits, fuse, rerank, diversify } from './aggregate.js'
export { keywordExcerpt, rangeExcerpt } from './excerpt.js'
export { urlKey } from './text.js'
export { renderSearch, renderFetch } from './format.js'
export { skillContent } from './skill.js'

/** Resolve a credential reference through DSH's credential service, falling back to the process environment. */
async function resolveKey(ctx: Context, reference: string): Promise<string | undefined> {
  let ref: CredentialRef
  try { ref = credentialRef(reference) } catch { return undefined }
  const credentials = (ctx as any).get?.('credentials') ?? (ctx as any).credentials
  if (credentials?.resolve) {
    const resolved = await credentials.resolve(ref)
    return resolved?.value || undefined
  }
  return process.env[reference] || undefined
}

export function apply(ctx: Context, input: unknown): void {
  // Every section is volatile: the settings page edits them in place and the loader
  // emits `loader/volatile-update` instead of remounting, so read through a snapshot.
  let config = snapshotConfig(input)
  // DSH's model runtime is optional: track it so the decision model can use configured providers.
  let llm: any
  ctx.inject(['llm'] as any, scoped => {
    llm = (scoped as any).llm
    scoped.effect(() => () => { llm = undefined }, 'multisearch: llm')
  })
  const decision = new DecisionModel(() => config, () => llm, reference => resolveKey(ctx, reference))
  const engine = new Engine({
    config: () => config,
    resolveKey: reference => resolveKey(ctx, reference),
    web: () => (ctx as any).get?.('web'),
    decision,
    cache: new PageCache(),
  })
  const stores = new StoreRegistry()
  // Tool names, descriptions and the skill text embed settings; rebuild them when settings change.
  let disposeTools = registerTools(ctx, engine, stores, config)
  // The skill normally lives as a SKILL.md the host's filesystem loader serves (and skill
  // managers can manage); builtin mode, or a failed write, registers it in memory instead.
  const skillFile = new SkillFile()
  let skillCtx: any
  let disposeSkill = () => {}
  let skillFallback = false
  let skillVersion = 0
  const applySkill = async () => {
    const version = ++skillVersion
    const mode = config.research.skillMode ?? 'file'
    try {
      await skillFile.sync(config, mode)
      skillFallback = false
    } catch (error) {
      skillFallback = mode === 'file'
      ;(ctx as any).logger?.warn?.(`multisearch: cannot write ${skillFile.path}, registering the skill in memory instead: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (version !== skillVersion) return
    disposeSkill(); disposeSkill = () => {}
    if (skillCtx && (mode === 'builtin' || skillFallback)) disposeSkill = registerSkill(skillCtx, config)
  }
  ctx.inject(['skills'] as any, scoped => {
    skillCtx = scoped
    void applySkill()
    scoped.effect(() => () => { disposeSkill(); disposeSkill = () => {}; skillCtx = undefined }, 'multisearch: skill')
  })
  ctx.on('loader/volatile-update' as any, () => {
    config = snapshotConfig(input)
    disposeTools()
    disposeTools = registerTools(ctx, engine, stores, config)
    void applySkill()
  })
  ctx.effect(() => () => disposeTools(), 'multisearch: tools')
  ctx.inject(['typert'] as any, scoped => {
    ;(scoped as any).typert.remotes.register(remoteInfo)
    new MultisearchService(scoped, engine, () => config, skillFile, { decision, llm: () => llm, resolveKey: reference => resolveKey(ctx, reference) })
  })
}
