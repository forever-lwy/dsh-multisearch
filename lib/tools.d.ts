/** Model-facing `search` and `fetch` tools. */
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.js';
import type { Engine } from './engine.js';
import type { StoreRegistry } from './store.js';
export declare function registerTools(ctx: Context, engine: Engine, stores: StoreRegistry, config: Config): () => void;
