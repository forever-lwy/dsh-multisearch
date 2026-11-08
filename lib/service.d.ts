/** Remote used by the settings page: source readiness, credential writes, model list. */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type Config } from './config.js';
import type { Engine } from './engine.js';
import { type MultisearchStatus, type ProviderModels, type SkillStatus } from './remote.js';
import type { SkillFile } from './skillfile.js';
import type { DecisionModel } from './decision.js';
import type { ProbeResult } from './remote.js';
export interface ServiceDeps {
    decision: DecisionModel;
    llm: () => any;
    resolveKey: (ref: string) => Promise<string | undefined>;
}
export declare class MultisearchService extends TypertRemoteService {
    private readonly engine;
    private readonly config;
    private readonly skillFile?;
    private readonly deps?;
    constructor(ctx: Context, engine: Engine, config: () => Config, skillFile?: SkillFile | undefined, deps?: ServiceDeps | undefined);
    private credentials;
    private describe;
    /** Only references the configuration actually uses may be written from the page. */
    private allowedRefs;
    /** Credentials used outside sources: the rerank service and an own decision-model endpoint. */
    private extraRefs;
    status(request: unknown, signal: AbortSignal): Promise<MultisearchStatus>;
    setCredential(request: unknown, signal: AbortSignal): Promise<{
        configured: boolean;
    }>;
    clearCredential(request: unknown, signal: AbortSignal): Promise<{
        configured: boolean;
    }>;
    private write;
    private skill;
    skillStatus(request: unknown, signal: AbortSignal): Promise<SkillStatus>;
    saveSkill(request: unknown, signal: AbortSignal): Promise<SkillStatus>;
    restoreSkill(request: unknown, signal: AbortSignal): Promise<SkillStatus>;
    testDecision(request: unknown, signal: AbortSignal): Promise<ProbeResult>;
    testRerank(request: unknown, signal: AbortSignal): Promise<ProbeResult>;
    models(request: unknown, signal: AbortSignal): Promise<ProviderModels>;
}
