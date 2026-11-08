var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { DEFAULT_FETCH_ORDER, PRESETS, sourceSettings } from './config.js';
import { RESOURCE_TYPES } from './types.js';
import { SERVICE, credentialRequestSchema, skillSaveSchema } from './remote.js';
import { DECISION_DEFAULT_KEY, rerankTarget } from './presets.js';
import { rerankService } from './sources/index.js';
const errorText = (error) => error instanceof Error ? error.message : String(error);
let MultisearchService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _setCredential_decorators;
    let _clearCredential_decorators;
    let _skillStatus_decorators;
    let _saveSkill_decorators;
    let _restoreSkill_decorators;
    let _testDecision_decorators;
    let _testRerank_decorators;
    let _models_decorators;
    return class MultisearchService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote];
            _setCredential_decorators = [Remote];
            _clearCredential_decorators = [Remote];
            _skillStatus_decorators = [Remote];
            _saveSkill_decorators = [Remote];
            _restoreSkill_decorators = [Remote];
            _testDecision_decorators = [Remote];
            _testRerank_decorators = [Remote];
            _models_decorators = [Remote];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setCredential_decorators, { kind: "method", name: "setCredential", static: false, private: false, access: { has: obj => "setCredential" in obj, get: obj => obj.setCredential }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _clearCredential_decorators, { kind: "method", name: "clearCredential", static: false, private: false, access: { has: obj => "clearCredential" in obj, get: obj => obj.clearCredential }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _skillStatus_decorators, { kind: "method", name: "skillStatus", static: false, private: false, access: { has: obj => "skillStatus" in obj, get: obj => obj.skillStatus }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _saveSkill_decorators, { kind: "method", name: "saveSkill", static: false, private: false, access: { has: obj => "saveSkill" in obj, get: obj => obj.saveSkill }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _restoreSkill_decorators, { kind: "method", name: "restoreSkill", static: false, private: false, access: { has: obj => "restoreSkill" in obj, get: obj => obj.restoreSkill }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _testDecision_decorators, { kind: "method", name: "testDecision", static: false, private: false, access: { has: obj => "testDecision" in obj, get: obj => obj.testDecision }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _testRerank_decorators, { kind: "method", name: "testRerank", static: false, private: false, access: { has: obj => "testRerank" in obj, get: obj => obj.testRerank }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _models_decorators, { kind: "method", name: "models", static: false, private: false, access: { has: obj => "models" in obj, get: obj => obj.models }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        engine = __runInitializers(this, _instanceExtraInitializers);
        config;
        skillFile;
        deps;
        constructor(ctx, engine, config, skillFile, deps) {
            super(ctx, SERVICE);
            this.engine = engine;
            this.config = config;
            this.skillFile = skillFile;
            this.deps = deps;
        }
        credentials() {
            return this.ctx.get?.('credentials');
        }
        async describe(ref) {
            const service = this.credentials();
            try {
                if (service?.describe) {
                    const info = await service.describe(credentialRef(ref));
                    return { configured: Boolean(info.configured), writable: Boolean(info.writable) };
                }
            }
            catch { /* invalid reference */ }
            return { configured: Boolean(process.env[ref]), writable: false };
        }
        /** Only references the configuration actually uses may be written from the page. */
        allowedRefs() {
            const config = this.config();
            const refs = new Set();
            for (const spec of this.engine.specs()) {
                if (!spec.credential)
                    continue;
                const ref = sourceSettings(config, spec.id).apiKey || spec.credential;
                refs.add(ref);
            }
            for (const ref of this.extraRefs(config))
                refs.add(ref);
            return refs;
        }
        /** Credentials used outside sources: the rerank service and an own decision-model endpoint. */
        extraRefs(config) {
            const refs = [];
            const rerank = rerankTarget(config.rerank).apiKey;
            if (rerank)
                refs.push(rerank);
            if ((config.decision.backend ?? 'dsh') === 'openai')
                refs.push(config.decision.apiKey || DECISION_DEFAULT_KEY);
            return [...new Set(refs)];
        }
        async status(request, signal) {
            void request; // the gateway matches wire fields to these parameter names; keep it "request"
            signal.throwIfAborted();
            const config = this.config();
            const routable = await this.engine.routable();
            const sources = await Promise.all(routable.map(async (source) => {
                const spec = this.engine.specs().find(s => s.id === source.spec.id);
                const ref = spec.credential ? sourceSettings(config, spec.id).apiKey || spec.credential : undefined;
                const credential = ref ? { ref, optional: Boolean(spec.keyOptional), ...(await this.describe(ref)) } : undefined;
                const reasons = source;
                return {
                    id: spec.id, label: spec.label, blurb: spec.blurb,
                    search: Boolean(spec.caps.search), fetch: Boolean(spec.caps.fetch), map: Boolean(spec.caps.map),
                    defaultTypes: [...spec.types], defaultPriority: spec.priority, defaultOptions: { ...(spec.options ?? {}) }, defaultEnabled: Boolean(spec.defaultEnabled),
                    ...(credential ? { credential } : {}),
                    searchReady: spec.caps.search ? { ok: source.usable, ...(source.usable ? {} : { reason: reasons.reason ?? '不可用' }) } : { ok: false, reason: '不支持搜索' },
                    fetchReady: spec.caps.fetch ? { ok: Boolean(source.fetchUsable), ...(source.fetchUsable ? {} : { reason: source.fetchReason ?? '不可用' }) } : { ok: false, reason: '不支持抓取' },
                };
            }));
            const extra = await Promise.all(this.extraRefs(config).map(async (ref) => ({ ref, ...(await this.describe(ref)) })));
            return {
                sources, extraCredentials: extra, resourceTypes: [...RESOURCE_TYPES],
                presets: JSON.parse(JSON.stringify(PRESETS)), defaultFetchOrder: [...DEFAULT_FETCH_ORDER],
            };
        }
        async setCredential(request, signal) {
            signal.throwIfAborted();
            const parsed = credentialRequestSchema.safeParse(request);
            if (!parsed.success || !parsed.data.value?.trim())
                throw new RemoteError('gateway/bad-request', '请输入密钥。', {});
            return this.write(parsed.data.ref, parsed.data.value.trim());
        }
        async clearCredential(request, signal) {
            signal.throwIfAborted();
            const parsed = credentialRequestSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', '参数无效。', {});
            return this.write(parsed.data.ref, undefined);
        }
        async write(ref, value) {
            if (!this.allowedRefs().has(ref))
                throw new RemoteError('gateway/bad-request', `凭据引用 ${ref} 不属于本插件的设置。`, {});
            let parsed;
            try {
                parsed = credentialRef(ref);
            }
            catch {
                throw new RemoteError('gateway/bad-request', `凭据引用 ${ref} 不合法。`, {});
            }
            const service = this.credentials();
            const info = await this.describe(ref);
            if (!service?.set || !info.writable)
                throw new RemoteError('multisearch/credential-read-only', `${ref} 由环境变量等只读来源提供，不能在此修改。`, {});
            try {
                if (value === undefined)
                    await service.unset(parsed);
                else
                    await service.set(parsed, value);
            }
            catch (error) {
                throw new RemoteError('multisearch/credential-save-failed', `保存失败：${errorText(error)}`, {});
            }
            return { configured: (await this.describe(ref)).configured };
        }
        skill() {
            if (!this.skillFile)
                throw new RemoteError('multisearch/skill-unavailable', '技能文件不可用。', {});
            return this.skillFile;
        }
        async skillStatus(request, signal) {
            void request;
            signal.throwIfAborted();
            const config = this.config();
            return this.skill().status(config, config.research.skillMode ?? 'file');
        }
        async saveSkill(request, signal) {
            signal.throwIfAborted();
            const parsed = skillSaveSchema.safeParse(request);
            if (!parsed.success)
                throw new RemoteError('gateway/bad-request', '技能内容无效。', {});
            const config = this.config();
            if ((config.research.skillMode ?? 'file') !== 'file')
                throw new RemoteError('gateway/bad-request', '当前为内置模式，切换到文件模式后才能编辑技能文件。', {});
            try {
                await this.skill().save(config, parsed.data.content);
            }
            catch (error) {
                throw new RemoteError('multisearch/skill-save-failed', `保存失败：${errorText(error)}`, {});
            }
            return this.skill().status(config, 'file');
        }
        async restoreSkill(request, signal) {
            void request;
            signal.throwIfAborted();
            const config = this.config();
            if ((config.research.skillMode ?? 'file') !== 'file')
                throw new RemoteError('gateway/bad-request', '当前为内置模式，无需恢复技能文件。', {});
            try {
                await this.skill().restore(config);
            }
            catch (error) {
                throw new RemoteError('multisearch/skill-save-failed', `恢复失败：${errorText(error)}`, {});
            }
            return this.skill().status(config, 'file');
        }
        async testDecision(request, signal) {
            void request;
            if (!this.deps)
                return { ok: false, detail: '决策模型不可用', ms: 0 };
            return this.deps.decision.probe(AbortSignal.any([signal, AbortSignal.timeout(Math.max(5000, this.config().decision.timeoutMs + 2000))]));
        }
        async testRerank(request, signal) {
            void request;
            const started = Date.now();
            const target = rerankTarget(this.config().rerank);
            if (!target.url || !target.model)
                return { ok: false, detail: '未填写重排服务地址或模型', ms: 0 };
            try {
                const apiKey = target.apiKey ? await this.deps?.resolveKey(target.apiKey) : undefined;
                if (target.apiKey && !apiKey)
                    return { ok: false, detail: `未配置 ${target.apiKey}`, ms: 0 };
                const results = await rerankService({
                    url: target.url, apiKey, model: target.model, query: 'What is the capital of France?',
                    documents: ['Paris is the capital and largest city of France.', 'Bananas are rich in potassium.'], topN: 2, signal, timeoutMs: 15_000,
                });
                const best = [...results].sort((a, b) => b.score - a.score)[0];
                if (!best)
                    return { ok: false, detail: '服务没有返回结果', ms: Date.now() - started };
                return best.index === 0
                    ? { ok: true, detail: `排序正确（${target.model}，得分 ${best.score.toFixed(3)}）`, ms: Date.now() - started }
                    : { ok: false, detail: '服务有返回，但排序不符合预期', ms: Date.now() - started };
            }
            catch (error) {
                return { ok: false, detail: errorText(error).slice(0, 300), ms: Date.now() - started };
            }
        }
        async models(request, signal) {
            void request;
            const llm = this.deps?.llm() ?? this.ctx.get?.('llm');
            if (!llm)
                return { providers: [] };
            const providers = (llm.listProviders?.() ?? []);
            return {
                providers: await Promise.all(providers.map(async (provider) => {
                    try {
                        signal.throwIfAborted();
                        const models = await llm.listModels(provider.id);
                        return { provider: provider.id, name: provider.name || provider.id, models: models.map(model => ({ id: model.id, name: model.name || model.id })) };
                    }
                    catch (error) {
                        return { provider: provider.id, name: provider.name || provider.id, models: [], error: errorText(error) };
                    }
                })),
            };
        }
    };
})();
export { MultisearchService };
