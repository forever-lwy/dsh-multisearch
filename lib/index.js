import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Config as ConfigSchema } from './config.js';
import { Engine } from './engine.js';
import { DecisionModel } from './decision.js';
import { PageCache, StoreRegistry } from './store.js';
import { registerTools } from './tools.js';
import { registerSkill } from './skill.js';
export const name = 'dsh-multisearch';
export const inject = ['tools', 'systemPrompt'];
export const Config = ConfigSchema;
export { Engine } from './engine.js';
export { PRESETS, effectiveTuning } from './config.js';
export { planRoute, inferTypes } from './router.js';
export { mergeHits, fuse, rerank, diversify } from './aggregate.js';
export { keywordExcerpt, rangeExcerpt } from './excerpt.js';
export { urlKey } from './text.js';
export { renderSearch, renderFetch } from './format.js';
export { skillContent } from './skill.js';
/** Resolve a credential reference through DSH's credential service, falling back to the process environment. */
async function resolveKey(ctx, reference) {
    let ref;
    try {
        ref = credentialRef(reference);
    }
    catch {
        return undefined;
    }
    const credentials = ctx.get?.('credentials') ?? ctx.credentials;
    if (credentials?.resolve) {
        const resolved = await credentials.resolve(ref);
        return resolved?.value || undefined;
    }
    return process.env[reference] || undefined;
}
export function apply(ctx, input) {
    const config = input;
    const engine = new Engine({
        config: () => config,
        resolveKey: reference => resolveKey(ctx, reference),
        web: () => ctx.get?.('web'),
        decision: new DecisionModel(() => config, () => ctx.get?.('llm')),
        cache: new PageCache(),
    });
    registerTools(ctx, engine, new StoreRegistry(), config);
    // The skill registry may load later or not at all; register whenever it is present.
    ctx.inject(['skills'], skillCtx => registerSkill(skillCtx, config));
}
