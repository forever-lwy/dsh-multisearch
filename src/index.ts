/**
 * dsh-multisearch: multi-source `search` and `fetch` tools plus a deep-research skill.
 * @module @forever-lwy/dsh-multisearch
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { Config as ConfigSchema, type Config as MultisearchConfig } from './config.js'
import { Engine } from './engine.js'
import { DecisionModel } from './decision.js'
import { PageCache, StoreRegistry } from './store.js'
import { registerTools } from './tools.js'
import { registerSkill } from './skill.js'

export const name = 'dsh-multisearch'
export const inject = ['tools', 'systemPrompt']
export const Config = ConfigSchema

export { Engine } from './engine.js'
export { PRESETS, effectiveTuning } from './config.js'
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

export function apply(ctx: Context, input: MultisearchConfig): void {
  const config = input
  const engine = new Engine({
    config: () => config,
    resolveKey: reference => resolveKey(ctx, reference),
    web: () => (ctx as any).get?.('web'),
    decision: new DecisionModel(() => config, () => (ctx as any).get?.('llm')),
    cache: new PageCache(),
  })
  registerTools(ctx, engine, new StoreRegistry(), config)
  // The skill registry may load later or not at all; register whenever it is present.
  ctx.inject(['skills'] as any, skillCtx => registerSkill(skillCtx, config))
}
