/** Model-facing `search` and `fetch` tools. */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { Engine } from './engine.js';
import type { StoreRegistry } from './store.js';
/**
 * Forced source/service ids are rare, so their lists stay out of the resident
 * tool definition; an unknown id answers with the enabled ids instead.
 */
export declare function knownIds(ids: string[], enabled: string[], field: string): string[];
export declare function registerTools(ctx: Context, engine: Engine, stores: StoreRegistry, config: Config): () => void;
