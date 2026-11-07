/** Remote used by the settings page: source readiness, credential writes, model list. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type Config } from './config.js';
import type { Engine } from './engine.js';
import { type MultisearchStatus, type ProviderModels } from './remote.js';
export declare class MultisearchService extends TypertRemoteService {
    private readonly engine;
    private readonly config;
    constructor(ctx: Context, engine: Engine, config: () => Config);
    private credentials;
    private describe;
    /** Only references the configuration actually uses may be written from the page. */
    private allowedRefs;
    status(request: unknown, signal: AbortSignal): Promise<MultisearchStatus>;
    setCredential(request: unknown, signal: AbortSignal): Promise<{
        configured: boolean;
    }>;
    clearCredential(request: unknown, signal: AbortSignal): Promise<{
        configured: boolean;
    }>;
    private write;
    models(request: unknown, signal: AbortSignal): Promise<ProviderModels>;
}
