/**
 * dsh-multisearch: multi-source `search` and `fetch` tools plus a deep-research skill.
 * @module @forever-lwy/dsh-multisearch
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config as ConfigSchema, type Config as MultisearchConfig } from './config.js';
export declare const name = "dsh-multisearch";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ConfigSchema>;
export { Engine } from './engine.js';
export { PRESETS, effectiveTuning } from './config.js';
export type { MultisearchConfig };
export { planRoute, inferTypes } from './router.js';
export { mergeHits, fuse, rerank, diversify } from './aggregate.js';
export { keywordExcerpt, rangeExcerpt } from './excerpt.js';
export { urlKey } from './text.js';
export { renderSearch, renderFetch } from './format.js';
export { skillContent } from './skill.js';
export declare function apply(ctx: Context, input: MultisearchConfig): void;
