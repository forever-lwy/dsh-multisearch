import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Config as ConfigSchema, snapshotConfig } from './config.js';
import { remoteInfo } from './remote.js';
import { MultisearchService } from './service.js';
import { Engine } from './engine.js';
import { DecisionModel } from './decision.js';
import { PageCache, StoreRegistry } from './store.js';
import { registerTools } from './tools.js';
import { registerSkill } from './skill.js';
export const name = 'dsh-multisearch';
export const inject = ['tools', 'systemPrompt'];
export const Config = ConfigSchema;
export { Engine } from './engine.js';
export { PRESETS, effectiveTuning, snapshotConfig } from './config.js';
export { MultisearchService } from './service.js';
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
    // Every section is volatile: the settings page edits them in place and the loader
    // emits `loader/volatile-update` instead of remounting, so read through a snapshot.
    let config = snapshotConfig(input);
    const engine = new Engine({
        config: () => config,
        resolveKey: reference => resolveKey(ctx, reference),
        web: () => ctx.get?.('web'),
        decision: new DecisionModel(() => config, () => ctx.get?.('llm')),
        cache: new PageCache(),
    });
    const stores = new StoreRegistry();
    // Tool names, descriptions and the skill text embed settings; rebuild them when settings change.
    let disposeTools = registerTools(ctx, engine, stores, config);
    let skillCtx;
    let disposeSkill = () => { };
    ctx.inject(['skills'], scoped => {
        skillCtx = scoped;
        disposeSkill = registerSkill(scoped, config);
        scoped.effect(() => () => { disposeSkill(); disposeSkill = () => { }; skillCtx = undefined; }, 'multisearch: skill');
    });
    ctx.on('loader/volatile-update', () => {
        config = snapshotConfig(input);
        disposeTools();
        disposeTools = registerTools(ctx, engine, stores, config);
        if (skillCtx) {
            disposeSkill();
            disposeSkill = registerSkill(skillCtx, config);
        }
    });
    ctx.effect(() => () => disposeTools(), 'multisearch: tools');
    ctx.inject(['typert'], scoped => {
        ;
        scoped.typert.remotes.register(remoteInfo);
        new MultisearchService(scoped, engine, () => config);
    });
}
