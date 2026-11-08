import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Settings → 多源搜索 (also the bundle's page on the Plugins page). Edits stay local until Save. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DECISION_DEFAULT_KEY, DECISION_ENDPOINTS, DECISION_PROTOCOLS, RERANK_PROVIDERS, RERANK_PROVIDER_IDS, decisionWire, rerankTarget } from '../presets.js';
import { deepEqual, diffOps, getIn, setIn, splitList } from './draft.js';
const TABS = [
    ['overview', '概览'], ['general', '常规与档位'], ['sources', '搜索源与密钥'], ['routing', '路由与抓取'], ['ranking', '重排与决策模型'], ['research', '深度研究'],
];
const TYPE_LABELS = {
    web: '网页', news: '新闻', documentation: '文档', code: '代码', academic: '学术', social: '社媒', community: '社区',
    finance: '财经', government: '政府', 'ai-models': 'AI 模型', company: '企业', chinese: '中文', answer: '生成答案',
};
const TUNING = [
    ['parallelSources', '并行来源数量', 'number'], ['queryConcurrency', '查询并发数', 'number'], ['perSourceResults', '每源候选数量', 'number'],
    ['returnResults', '返回条数', 'number'], ['outputTokens', '证据输出预算（约 tokens）', 'number'], ['snippetChars', '每条片段字符数', 'number'],
    ['candidateLimit', '参与重排的候选数', 'number'], ['rerank', '启用重排', 'boolean'],
    ['autoFollowUp', '自动补搜', 'boolean'], ['followUpRounds', '补搜轮数', 'number'], ['minResults', '结果少于此数触发补搜', 'number'],
    ['duplicateRatio', '重复占比高于此值触发补搜（0–1）', 'number'],
    ['requestTimeoutMs', '单请求超时（毫秒）', 'number'], ['callTimeoutMs', '单次调用总时限（毫秒）', 'number'],
    ['fetchConcurrency', '抓取并发数', 'number'], ['fetchMaxChars', '每页返回字符数', 'number'], ['fetchTotalTokens', '一次抓取总预算（约 tokens，0 不限）', 'number'], ['fetchRetries', '同一服务重试次数', 'number'],
    ['fetchFallbacks', '同一 URL 最多尝试服务数', 'number'], ['cacheTtlMinutes', '正文缓存时效（分钟）', 'number'],
];
const LIMITS = [
    ['maxQueries', '单次最多查询数'], ['maxParallelSources', '并行来源数上限'], ['maxPerSourceResults', '每源候选数上限'],
    ['maxReturnResults', '返回条数上限'], ['maxOutputTokens', '输出预算上限'], ['maxCallTimeoutMs', '单次调用时限上限（毫秒）'],
    ['maxRequestTimeoutMs', '单请求超时上限（毫秒）'], ['maxFetchUrls', '单次抓取 URL 上限'], ['maxFetchChars', '单页字符上限'],
    ['maxFollowUpRounds', '补搜轮数上限'], ['maxCrawlPages', '站内爬取页数上限'], ['maxCrawlDepth', '站内爬取深度上限'],
];
function useLoad(load) {
    const [state, setState] = useState({ status: 'loading' });
    const [generation, setGeneration] = useState(0);
    useEffect(() => {
        if (!load) {
            setState({ status: 'failed', error: '插件服务未连接' });
            return;
        }
        const abort = new AbortController();
        setState(previous => previous.status === 'ready' ? previous : { status: 'loading' });
        load(abort.signal).then(value => { if (!abort.signal.aborted)
            setState({ status: 'ready', value }); }, error => { if (!abort.signal.aborted)
            setState({ status: 'failed', error: error instanceof Error ? error.message : String(error) }); });
        return () => abort.abort();
    }, [load, generation]);
    return [state, useCallback(() => setGeneration(value => value + 1), [])];
}
function Field(props) {
    return (_jsxs("label", { className: "dms-field", children: [_jsx("span", { children: props.label }), props.children, props.hint ? _jsx("small", { children: props.hint }) : null, props.error ? _jsx("small", { className: "dms-err", role: "alert", children: props.error }) : null] }));
}
function Badge(props) {
    return _jsx("span", { className: "dms-badge", "data-state": props.state, title: props.title, children: props.children });
}
export function MultisearchSettings(props) {
    const snapshot = useSyncExternalStore(props.form.subscribe.bind(props.form), () => props.form.getSnapshot());
    const accepted = useMemo(() => (snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : {}), [snapshot.value]);
    const [draft, setDraft] = useState(accepted);
    const [texts, setTexts] = useState({});
    const [errors, setErrors] = useState({});
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState('idle');
    const [tab, setTab] = useState('overview');
    const [keys, setKeys] = useState({});
    const [keyStatus, setKeyStatus] = useState({});
    const remote = props.remote();
    const loadStatus = useMemo(() => remote ? (signal) => remote.status(signal) : undefined, [remote]);
    const loadModels = useMemo(() => remote && tab === 'ranking' ? (signal) => remote.models(signal) : undefined, [remote, tab]);
    const [status, reloadStatus] = useLoad(loadStatus);
    const [models] = useLoad(loadModels);
    const loadSkill = useMemo(() => remote && tab === 'research' ? (signal) => remote.skillStatus(signal) : undefined, [remote, tab]);
    const [skill, reloadSkill] = useLoad(loadSkill);
    const [skillText, setSkillText] = useState(undefined);
    const [skillMessage, setSkillMessage] = useState('');
    const [probe, setProbe] = useState({});
    // A settings save can rewrite a file the plugin still owns; read it again (the plugin syncs asynchronously).
    useEffect(() => { const timer = setTimeout(reloadSkill, 400); return () => clearTimeout(timer); }, [accepted, reloadSkill]);
    // Follow Host changes (another window, a reset) until the user starts editing.
    useEffect(() => { if (!dirty) {
        setDraft(accepted);
        setTexts({});
        setErrors({});
    } }, [accepted, dirty]);
    // Saved settings change readiness (enabled sources, zones, credential refs): refresh it.
    useEffect(() => { reloadStatus(); }, [accepted, reloadStatus]);
    if (props.view === 'summary')
        return _jsx(_Fragment, { children: "\u591A\u6E90\u641C\u7D22\u4E0E\u7F51\u9875\u6293\u53D6\uFF1A\u6765\u6E90\u3001\u5BC6\u94A5\u3001\u6863\u4F4D\u3001\u91CD\u6392\u3001\u51B3\u7B56\u6A21\u578B\u4E0E\u6DF1\u5EA6\u7814\u7A76\u9884\u7B97\u3002" });
    if (snapshot.status === 'loading')
        return _jsx("div", { className: "dms-settings", children: _jsx("p", { className: "dms-hint", children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" }) });
    if (snapshot.status === 'unavailable')
        return _jsx("div", { className: "dms-settings", children: _jsx("p", { className: "dms-hint", children: "\u63D2\u4EF6\u672A\u8FD0\u884C\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u8BBE\u7F6E\u3002\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u542F\u7528\u3002" }) });
    const disabled = !snapshot.writable || saving === 'saving';
    const get = (path) => getIn(draft, path);
    const set = (path, value) => {
        setDraft(previous => setIn(previous, path, value));
        setDirty(true);
        if (saving !== 'saving')
            setSaving('idle');
    };
    const textKey = (path) => path.join('.');
    const listText = (path, separator = ', ') => texts[textKey(path)] ?? (get(path) ?? []).join(separator);
    const editList = (path, text) => {
        setTexts(previous => ({ ...previous, [textKey(path)]: text }));
        set(path, splitList(text));
    };
    const num = (path, options = {}) => {
        const value = get(path);
        return (_jsx("input", { type: "number", step: options.step ?? '1', value: value ?? '', placeholder: options.placeholder, disabled: disabled, onChange: event => {
                const text = event.target.value;
                if (text === '') {
                    if (options.optional)
                        set(path, undefined);
                    return;
                }
                const parsed = Number(text);
                if (Number.isFinite(parsed))
                    set(path, parsed);
            } }));
    };
    const text = (path, placeholder) => (_jsx("input", { type: "text", value: get(path) ?? '', placeholder: placeholder, disabled: disabled, onChange: event => set(path, event.target.value) }));
    const toggle = (path, label, hint) => (_jsxs("label", { className: "dms-toggle", children: [_jsx("input", { type: "checkbox", checked: Boolean(get(path)), disabled: disabled, onChange: event => set(path, event.target.checked) }), _jsxs("span", { children: [_jsx("span", { children: label }), hint ? _jsxs(_Fragment, { children: [_jsx("br", {}), _jsx("small", { className: "dms-hint", children: hint })] }) : null] })] }));
    const select = (path, options) => (_jsx("select", { value: get(path) ?? '', disabled: disabled, onChange: event => set(path, event.target.value), children: options.map(([value, label]) => _jsx("option", { value: value, children: label }, value)) }));
    const save = async () => {
        // Parse JSON editors into the draft first; any error blocks the write.
        let next = draft;
        const nextErrors = {};
        for (const [key, value] of Object.entries(texts)) {
            if (!key.endsWith('#json'))
                continue;
            try {
                next = setIn(next, key.slice(0, -5).split('.'), JSON.parse(value));
            }
            catch (error) {
                nextErrors[key] = `JSON 无效：${error instanceof Error ? error.message : String(error)}`;
            }
        }
        setErrors(nextErrors);
        if (Object.values(nextErrors).some(Boolean)) {
            setSaving('failed');
            return;
        }
        const ops = diffOps(accepted, next);
        if (ops.length === 0) {
            setDirty(false);
            return;
        }
        setSaving('saving');
        try {
            const ok = await props.form.mutate(ops, snapshot.revision);
            setSaving(ok ? 'saved' : 'failed');
            if (ok)
                setDirty(false);
        }
        catch {
            setSaving('failed');
        }
    };
    const discard = () => { setDraft(accepted); setTexts({}); setErrors({}); setDirty(false); setSaving('idle'); };
    const resetSection = async (section, label) => {
        if (!window.confirm(`把“${label}”恢复为默认值？`))
            return;
        setSaving('saving');
        try {
            setSaving(await props.form.mutate([{ op: 'unset', path: [section] }], snapshot.revision) ? 'saved' : 'failed');
        }
        catch {
            setSaving('failed');
        }
    };
    const json = (path, fallback, rows) => {
        const key = `${textKey(path)}#json`;
        return (_jsx("textarea", { rows: rows, spellCheck: false, disabled: disabled, "aria-invalid": errors[key] ? true : undefined, value: texts[key] ?? JSON.stringify(get(path) ?? fallback, null, 2), onChange: event => { setTexts(previous => ({ ...previous, [key]: event.target.value })); setErrors(previous => ({ ...previous, [key]: '' })); setDirty(true); setSaving('idle'); } }));
    };
    const sources = status.status === 'ready' ? status.value.sources : [];
    const sourceIds = sources.map(s => s.id);
    const presets = status.status === 'ready' ? status.value.presets : {};
    const profile = get(['profile']) ?? 'balanced';
    const writeKey = async (ref, clear) => {
        const client = props.remote();
        if (!client)
            return;
        setKeyStatus(previous => ({ ...previous, [ref]: '正在保存…' }));
        try {
            const result = clear ? await client.clearCredential(ref) : await client.setCredential(ref, keys[ref] ?? '');
            setKeys(previous => ({ ...previous, [ref]: '' }));
            setKeyStatus(previous => ({ ...previous, [ref]: clear ? '已清除' : result.configured ? '已保存' : '已保存，但未检测到密钥' }));
            reloadStatus();
        }
        catch (error) {
            setKeyStatus(previous => ({ ...previous, [ref]: `失败：${error instanceof Error ? error.message : String(error)}` }));
        }
    };
    const keyEditor = (credential, savedRef) => {
        if (!credential)
            return null;
        const message = keyStatus[credential.ref];
        return (_jsxs("div", { className: "dms-key", children: [_jsx(Badge, { state: credential.configured ? 'ok' : credential.optional ? 'off' : 'bad', children: credential.configured ? '密钥已配置' : credential.optional ? '未配置（可选）' : '未配置密钥' }), _jsx("input", { type: "password", autoComplete: "new-password", placeholder: `输入 ${credential.ref} 的值`, value: keys[credential.ref] ?? '', disabled: !credential.writable || !savedRef, onChange: event => setKeys(previous => ({ ...previous, [credential.ref]: event.target.value })) }), _jsx("button", { type: "button", disabled: !credential.writable || !savedRef || !(keys[credential.ref] ?? '').trim(), onClick: () => writeKey(credential.ref, false), children: "\u4FDD\u5B58\u5BC6\u94A5" }), _jsx("button", { type: "button", disabled: !credential.writable || !savedRef || !credential.configured, onClick: () => writeKey(credential.ref, true), children: "\u6E05\u9664" }), !credential.writable ? _jsx("small", { className: "dms-hint", children: "\u6B64\u51ED\u636E\u7531\u53EA\u8BFB\u6765\u6E90\uFF08\u5982\u73AF\u5883\u53D8\u91CF\uFF09\u63D0\u4F9B" }) : null, !savedRef ? _jsx("small", { className: "dms-warn", children: "\u51ED\u636E\u5F15\u7528\u540D\u5DF2\u4FEE\u6539\uFF0C\u5148\u4FDD\u5B58\u8BBE\u7F6E\u518D\u586B\u5199\u5BC6\u94A5" }) : null, message ? _jsx("small", { className: message.startsWith('失败') ? 'dms-err' : 'dms-ok', children: message }) : null] }));
    };
    const overview = (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["\u63D2\u4EF6\u63D0\u4F9B ", _jsx("code", { children: get(['tools', 'searchName']) || 'search' }), " \u4E0E ", _jsx("code", { children: get(['tools', 'fetchName']) || 'fetch' }), " \u4E24\u4E2A\u5DE5\u5177\u548C ", _jsx("code", { children: "deep-research" }), " \u6280\u80FD\u3002\u4E0B\u8868\u662F\u5404\u6765\u6E90\u5F53\u524D\u80FD\u5426\u4F7F\u7528\uFF1B\u5728\u201C\u641C\u7D22\u6E90\u4E0E\u5BC6\u94A5\u201D\u4E2D\u542F\u7528\u6765\u6E90\u5E76\u586B\u5199\u5BC6\u94A5\u3002"] }), status.status === 'loading' ? _jsx("p", { className: "dms-hint", children: "\u6B63\u5728\u8BFB\u53D6\u6765\u6E90\u72B6\u6001\u2026" }) : null, status.status === 'failed' ? _jsxs("p", { className: "dms-err", children: ["\u6765\u6E90\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A", status.error, " ", _jsx("button", { type: "button", onClick: reloadStatus, children: "\u91CD\u8BD5" })] }) : null, status.status === 'ready' ? (_jsxs("table", { className: "dms-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u6765\u6E90" }), _jsx("th", { children: "\u542F\u7528" }), _jsx("th", { children: "\u641C\u7D22" }), _jsx("th", { children: "\u6293\u53D6" })] }) }), _jsx("tbody", { children: sources.map(s => {
                            const enabled = Boolean(getIn(accepted, ['sources', s.id, 'enabled']) ?? s.defaultEnabled);
                            const cell = (supported, ready) => !supported ? _jsx(Badge, { state: "off", children: "\u4E0D\u652F\u6301" })
                                : !enabled ? _jsx(Badge, { state: "off", children: "\u672A\u542F\u7528" }) : ready.ok ? _jsx(Badge, { state: "ok", children: "\u53EF\u7528" }) : _jsx(Badge, { state: ready.reason?.startsWith('已关闭') ? 'off' : 'bad', title: ready.reason, children: ready.reason ?? '不可用' });
                            return _jsxs("tr", { children: [_jsx("td", { children: s.label }), _jsx("td", { children: enabled ? '是' : '否' }), _jsx("td", { children: cell(s.search, s.searchReady) }), _jsx("td", { children: cell(s.fetch, s.fetchReady) })] }, s.id);
                        }) })] })) : null] }));
    const general = (_jsxs(_Fragment, { children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "\u5DE5\u5177" }), _jsxs("div", { className: "dms-grid", children: [_jsx(Field, { label: "\u9ED8\u8BA4\u6863\u4F4D", hint: "\u5355\u6B21\u8C03\u7528\u53EF\u7528 profile \u53C2\u6570\u8986\u76D6", children: select(['profile'], [['fast', 'fast 快速'], ['balanced', 'balanced 均衡'], ['deep', 'deep 深入']]) }), _jsx(Field, { label: "\u641C\u7D22\u5DE5\u5177\u540D", children: text(['tools', 'searchName'], 'search') }), _jsx(Field, { label: "\u6293\u53D6\u5DE5\u5177\u540D", children: text(['tools', 'fetchName'], 'fetch') })] }), toggle(['tools', 'search'], '注册搜索工具'), toggle(['tools', 'fetch'], '注册抓取工具'), toggle(['tools', 'guidance'], '在系统提示词中加入简短使用说明')] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "\u9010\u9879\u8986\u76D6\u6863\u4F4D\u9ED8\u8BA4\u503C" }), _jsxs("p", { className: "dms-hint", children: ["\u7559\u7A7A\u5373\u4F7F\u7528\u5F53\u524D\u6863\u4F4D\uFF08", profile, "\uFF09\u7684\u503C\uFF0C\u5360\u4F4D\u6587\u5B57\u5C31\u662F\u6863\u4F4D\u503C\u3002\u4F18\u5148\u7EA7\uFF1A\u5355\u6B21\u8C03\u7528\u53C2\u6570 \uFF1E \u8FD9\u91CC\u7684\u8BBE\u7F6E \uFF1E \u6863\u4F4D\u9ED8\u8BA4\u503C\uFF0C\u5747\u53D7\u786C\u6027\u4E0A\u9650\u7EA6\u675F\u3002"] }), _jsx("div", { className: "dms-grid", children: TUNING.map(([key, label, kind]) => {
                            const preset = presets[profile]?.[key];
                            if (kind === 'boolean') {
                                const value = get(['overrides', key]);
                                return (_jsx(Field, { label: label, children: _jsxs("select", { value: value === undefined ? '' : value ? 'on' : 'off', disabled: disabled, onChange: event => set(['overrides', key], event.target.value === '' ? undefined : event.target.value === 'on'), children: [_jsxs("option", { value: "", children: ["\u8DDF\u968F\u6863\u4F4D\uFF08", preset === undefined ? '…' : preset ? '开' : '关', "\uFF09"] }), _jsx("option", { value: "on", children: "\u5F00" }), _jsx("option", { value: "off", children: "\u5173" })] }) }, key));
                            }
                            return _jsx(Field, { label: label, children: num(['overrides', key], { optional: true, step: key === 'duplicateRatio' ? '0.05' : '1', placeholder: preset === undefined ? '' : String(preset) }) }, key);
                        }) }), _jsx("button", { type: "button", disabled: disabled, onClick: () => resetSection('overrides', '逐项覆盖'), children: "\u5168\u90E8\u8DDF\u968F\u6863\u4F4D" })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "\u786C\u6027\u4E0A\u9650" }), _jsx("div", { className: "dms-grid", children: LIMITS.map(([key, label]) => _jsx(Field, { label: label, children: num(['limits', key]) }, key)) }), _jsx("button", { type: "button", disabled: disabled, onClick: () => resetSection('limits', '硬性上限'), children: "\u6062\u590D\u9ED8\u8BA4" })] })] }));
    const types = status.status === 'ready' ? status.value.resourceTypes : Object.keys(TYPE_LABELS);
    const sourceCards = (_jsxs(_Fragment, { children: [_jsx("p", { className: "dms-hint", children: "\u5BC6\u94A5\u76F4\u63A5\u5B58\u5165 DSH \u51ED\u636E\u5B58\u50A8\uFF0C\u4E0D\u5199\u5165\u8BBE\u7F6E\u6587\u4EF6\uFF1B\u201C\u4FDD\u5B58\u5BC6\u94A5\u201D\u7ACB\u5373\u751F\u6548\uFF0C\u4E0D\u9700\u8981\u70B9\u9875\u9762\u5E95\u90E8\u7684\u4FDD\u5B58\u3002\u5176\u4ED6\u6539\u52A8\u9700\u70B9\u201C\u4FDD\u5B58\u201D\u3002" }), status.status === 'failed' ? _jsxs("p", { className: "dms-err", children: ["\u6765\u6E90\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF1A", status.error, " ", _jsx("button", { type: "button", onClick: reloadStatus, children: "\u91CD\u8BD5" })] }) : null, status.status === 'loading' ? _jsx("p", { className: "dms-hint", children: "\u6B63\u5728\u8BFB\u53D6\u6765\u6E90\u2026" }) : null, sources.map(s => {
                const base = ['sources', s.id];
                const enabled = Boolean(get([...base, 'enabled']) ?? s.defaultEnabled);
                const savedRef = !s.credential || (get([...base, 'apiKey']) ?? s.credential.ref) === (getIn(accepted, [...base, 'apiKey']) ?? s.credential.ref);
                const selectedTypes = get([...base, 'types']) ?? [];
                return (_jsxs("div", { className: "dms-card", "data-enabled": enabled, children: [_jsxs("div", { className: "dms-card-head", children: [_jsxs("label", { className: "dms-toggle", style: { margin: 0 }, children: [_jsx("input", { type: "checkbox", checked: enabled, disabled: disabled, onChange: event => set([...base, 'enabled'], event.target.checked) }), _jsx("strong", { children: s.label })] }), _jsxs(Badge, { state: s.search ? (s.searchReady.ok ? 'ok' : s.searchReady.reason?.startsWith('已关闭') ? 'off' : 'bad') : 'off', title: s.searchReady.reason, children: ["\u641C\u7D22", s.search ? (s.searchReady.ok ? ' ✓' : `：${s.searchReady.reason}`) : '：不支持'] }), _jsxs(Badge, { state: s.fetch ? (s.fetchReady.ok ? 'ok' : s.fetchReady.reason?.startsWith('已关闭') ? 'off' : 'bad') : 'off', title: s.fetchReady.reason, children: ["\u6293\u53D6", s.fetch ? (s.fetchReady.ok ? ' ✓' : `：${s.fetchReady.reason}`) : '：不支持'] }), _jsx("code", { className: "dms-hint", children: s.id })] }), _jsx("small", { children: s.blurb }), s.search || s.fetch ? (_jsx("span", { className: "dms-checks", style: { margin: '6px 0 2px' }, children: [['search', '使用搜索', s.search], ['fetch', '使用抓取', s.fetch]].filter(([, , supported]) => supported).map(([cap, label]) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", "data-cap": cap, disabled: disabled || !enabled, checked: get([...base, cap]) ?? true, onChange: event => set([...base, cap], event.target.checked) }), label] }, cap))) })) : null, keyEditor(s.credential, savedRef), _jsxs("details", { className: "dms-more", children: [_jsx("summary", { children: "\u9AD8\u7EA7\u8BBE\u7F6E" }), _jsxs("div", { className: "dms-grid", children: [s.credential ? _jsx(Field, { label: "\u51ED\u636E\u5F15\u7528\u540D", hint: `默认 ${s.credential.ref}`, children: text([...base, 'apiKey'], s.credential.ref) }) : null, _jsx(Field, { label: "\u4F18\u5148\u7EA7\uFF080\u2013100\uFF09", hint: `默认 ${s.defaultPriority}`, children: num([...base, 'priority']) }), _jsx(Field, { label: "\u81EA\u5B9A\u4E49\u63A5\u53E3\u5730\u5740", hint: "\u7559\u7A7A\u4F7F\u7528\u5B98\u65B9\u5730\u5740", children: text([...base, 'baseURL']) })] }), _jsx(Field, { label: "\u80FD\u529B\u6807\u7B7E", hint: `都不勾选时使用内置标签：${s.defaultTypes.map(t => TYPE_LABELS[t] ?? t).join('、')}`, children: _jsx("span", { className: "dms-checks", children: types.map(type => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", disabled: disabled, checked: selectedTypes.includes(type), onChange: event => set([...base, 'types'], event.target.checked ? [...selectedTypes, type] : selectedTypes.filter(t => t !== type)) }), TYPE_LABELS[type] ?? type] }, type))) }) }), Object.keys(s.defaultOptions).length || getIn(accepted, [...base, 'options']) ? (_jsx(Field, { label: "\u6765\u6E90\u4E13\u5C5E\u53C2\u6570\uFF08JSON\uFF09", hint: `默认 ${JSON.stringify(s.defaultOptions)}`, error: errors[`${base.join('.')}.options#json`], children: json([...base, 'options'], s.defaultOptions, 4) })) : null] })] }, s.id));
            })] }));
    const routing = (_jsxs(_Fragment, { children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "\u6765\u6E90\u4E0E\u8DEF\u7531" }), toggle(['routing', 'autoRoute'], '按需求自动选源', '关闭后只使用下面的通用组合（或调用方指定的来源）'), _jsx(Field, { label: "\u901A\u7528\u7EC4\u5408\uFF08\u6309\u987A\u5E8F\u53D6\u53EF\u7528\u6765\u6E90\uFF09", hint: `可用 ID：${sourceIds.join(', ')}`, children: _jsx("input", { type: "text", value: listText(['routing', 'defaultSources']), disabled: disabled, onChange: event => editList(['routing', 'defaultSources'], event.target.value) }) }), _jsx("div", { className: "dms-grid", children: _jsx(Field, { label: "\u5171\u7528\u5E95\u5C42\u5F15\u64CE\u6263\u5206", children: num(['routing', 'overlapPenalty']) }) }), _jsx(Field, { label: "\u989D\u5916\u89C6\u4E3A\u5B98\u65B9\u8D44\u6599\u7684\u57DF\u540D\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", children: _jsx("textarea", { rows: 3, value: listText(['routing', 'officialDomains'], '\n'), disabled: disabled, onChange: event => editList(['routing', 'officialDomains'], event.target.value) }) }), _jsx(Field, { label: "\u81EA\u5B9A\u4E49\u5339\u914D\u89C4\u5219\uFF08JSON \u6570\u7EC4\uFF09", hint: '\u4F8B\uFF1A[{"name":"\u524D\u7AEF\u6587\u6863","types":["documentation"],"keywords":["react"],"sites":[],"sources":["context7"],"boost":40}]', error: errors['routing.rules#json'], children: json(['routing', 'rules'], [], 5) }), _jsx("button", { type: "button", disabled: disabled, onClick: () => resetSection('routing', '来源与路由'), children: "\u6062\u590D\u9ED8\u8BA4" })] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "\u6293\u53D6" }), _jsx(Field, { label: "\u6293\u53D6\u670D\u52A1\u56DE\u9000\u987A\u5E8F", hint: `默认：${status.status === 'ready' ? status.value.defaultFetchOrder.join(', ') : ''}。只认识特定网站的读取器会自动排在最前，模型转述总在最后。`, children: _jsx("input", { type: "text", value: listText(['fetching', 'order']), disabled: disabled, onChange: event => editList(['fetching', 'order'], event.target.value) }) }), _jsx("div", { className: "dms-grid", children: _jsx(Field, { label: "\u5C11\u4E8E\u8BE5\u5B57\u7B26\u6570\u89C6\u4E3A\u7A7A\u5185\u5BB9", children: num(['fetching', 'minContentChars']) }) }), _jsx(Field, { label: "\u4F18\u5148\u7528\u6E32\u67D3\u578B\u670D\u52A1\u7684\u57DF\u540D\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", children: _jsx("textarea", { rows: 3, value: listText(['fetching', 'preferRender'], '\n'), disabled: disabled, onChange: event => editList(['fetching', 'preferRender'], event.target.value) }) }), toggle(['fetching', 'allowPrivateNetwork'], '允许直接请求本机与内网地址', '默认关闭，避免模型读取内网服务'), _jsx("button", { type: "button", disabled: disabled, onClick: () => resetSection('fetching', '抓取'), children: "\u6062\u590D\u9ED8\u8BA4" })] })] }));
    const extraKey = (ref) => status.status === 'ready' ? status.value.extraCredentials.find(c => c.ref === ref) : undefined;
    const rerankProvider = (get(['rerank', 'provider']) ?? 'jina');
    const preset = RERANK_PROVIDERS[rerankProvider] ?? RERANK_PROVIDERS.custom;
    const savedRerank = rerankTarget((getIn(accepted, ['rerank']) ?? {}));
    const draftRerank = rerankTarget((get(['rerank']) ?? {}));
    // The key box follows the draft: preset references are known to the Host before the switch is saved.
    const rerankKey = draftRerank.apiKey ? extraKey(draftRerank.apiKey) : undefined;
    const backend = (get(['decision', 'backend']) ?? 'dsh');
    const protocol = (get(['decision', 'protocol']) ?? 'openai');
    const wire = decisionWire({ backend, protocol, baseURL: get(['decision', 'baseURL']) ?? '' });
    const decisionRef = get(['decision', 'apiKey']) || DECISION_DEFAULT_KEY;
    const savedBackend = getIn(accepted, ['decision', 'backend']) ?? 'dsh';
    const providerOptions = models.status === 'ready' ? models.value.providers : [];
    const provider = get(['decision', 'provider']) ?? '';
    const modelList = providerOptions.find(p => p.provider === provider)?.models ?? [];
    const stages = get(['decision', 'stages']) ?? [];
    const runProbe = async (which) => {
        const client = props.remote();
        if (!client)
            return;
        setProbe(previous => ({ ...previous, [which]: '正在测试…' }));
        try {
            const result = await (which === 'rerank' ? client.testRerank() : client.testDecision());
            setProbe(previous => ({ ...previous, [which]: `${result.ok ? '通过' : '失败'}：${result.detail}${result.ms ? `（${(result.ms / 1000).toFixed(1)} 秒）` : ''}` }));
        }
        catch (error) {
            setProbe(previous => ({ ...previous, [which]: `失败：${error instanceof Error ? error.message : String(error)}` }));
        }
    };
    const probeLine = (which, label) => (_jsxs("div", { className: "dms-key", children: [_jsx("button", { type: "button", "data-probe": which, disabled: !deepEqual(draft, accepted), onClick: () => runProbe(which), children: label }), !deepEqual(draft, accepted) ? _jsx("small", { className: "dms-warn", children: "\u5148\u4FDD\u5B58\u8BBE\u7F6E\u518D\u6D4B\u8BD5" }) : null, probe[which] ? _jsx("small", { className: probe[which].startsWith('通过') ? 'dms-ok' : probe[which] === '正在测试…' ? 'dms-hint' : 'dms-err', role: "status", children: probe[which] }) : null] }));
    const ranking = (_jsxs(_Fragment, { children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "\u7ED3\u679C\u91CD\u6392" }), _jsxs("div", { className: "dms-grid", children: [_jsx(Field, { label: "\u91CD\u6392\u65B9\u5F0F", children: select(['rerank', 'mode'], [['rules', '规则'], ['service', '专用重排服务'], ['model', '决策模型']]) }), _jsx(Field, { label: "\u91CD\u6392\u670D\u52A1\u4F9B\u5E94\u5546", children: _jsx("select", { value: rerankProvider, disabled: disabled, onChange: event => {
                                        set(['rerank', 'provider'], event.target.value);
                                        // Overrides belong to the previous provider; drop the ones that were filled in.
                                        for (const field of ['url', 'model', 'apiKey'])
                                            if (get(['rerank', field]))
                                                set(['rerank', field], undefined);
                                    }, children: RERANK_PROVIDER_IDS.map(id => _jsx("option", { value: id, children: RERANK_PROVIDERS[id].label }, id)) }) }), _jsx(Field, { label: "\u91CD\u6392\u670D\u52A1\u5730\u5740", hint: preset.url ? `留空使用 ${preset.url}` : '自定义供应商须填写，接口须兼容 Jina/Cohere rerank', children: text(['rerank', 'url'], preset.url) }), _jsx(Field, { label: "\u91CD\u6392\u6A21\u578B", hint: preset.model ? `留空使用 ${preset.model}` : undefined, children: text(['rerank', 'model'], preset.model) }), _jsx(Field, { label: "\u51ED\u636E\u5F15\u7528\u540D", hint: preset.apiKey ? `留空使用 ${preset.apiKey}` : '服务需要 Key 时填写', children: text(['rerank', 'apiKey'], preset.apiKey) })] }), draftRerank.apiKey && !rerankKey && status.status === 'ready'
                        ? _jsxs("p", { className: "dms-warn", children: ["\u51ED\u636E\u5F15\u7528\u540D ", draftRerank.apiKey, " \u662F\u65B0\u586B\u5199\u7684\uFF0C\u5148\u70B9\u9875\u9762\u5E95\u90E8\u7684\u201C\u4FDD\u5B58\u201D\uFF0C\u518D\u5728\u8FD9\u91CC\u586B\u5199\u5BC6\u94A5\u3002"] })
                        : keyEditor(rerankKey, true), draftRerank.apiKey !== savedRerank.apiKey || (get(['rerank', 'provider']) ?? 'jina') !== (getIn(accepted, ['rerank', 'provider']) ?? 'jina')
                        ? _jsx("p", { className: "dms-warn", children: "\u4F9B\u5E94\u5546\u6216\u51ED\u636E\u5DF2\u6539\u52A8\u4F46\u8FD8\u6CA1\u4FDD\u5B58\uFF1A\u5BC6\u94A5\u53EF\u4EE5\u5148\u5B58\uFF0C\u8BB0\u5F97\u70B9\u9875\u9762\u5E95\u90E8\u7684\u201C\u4FDD\u5B58\u201D\u8BA9\u91CD\u6392\u6539\u7528\u65B0\u4F9B\u5E94\u5546\u3002" }) : null, probeLine('rerank', '测试重排服务')] }), _jsxs("fieldset", { children: [_jsx("legend", { children: "\u51B3\u7B56\u6A21\u578B\uFF08\u5982 Jev\u3001gpt-6-luna\uFF09" }), _jsx("p", { className: "dms-hint", children: "\u7528\u4E8E\u9009\u6E90\u3001\u76F8\u5173\u6027\u5224\u65AD\u548C\u662F\u5426\u8865\u641C\uFF1B\u5173\u95ED\u3001\u8D85\u65F6\u6216\u8F93\u51FA\u65E0\u6548\u65F6\u56DE\u9000\u5230\u89C4\u5219\u3002" }), toggle(['decision', 'enabled'], '启用决策模型'), _jsx("div", { className: "dms-grid", children: _jsx(Field, { label: "\u540E\u7AEF", children: select(['decision', 'backend'], [
                                ['dsh', 'DSH 已配置的供应商（大模型输出 JSON）'],
                                ['openai', '单独配置：OpenAI 兼容 Chat Completions（大模型输出 JSON）'],
                                ['decisions', '单独配置：决策接口（Decisions / System One）'],
                            ]) }) }), _jsxs("div", { className: "dms-wire", "data-decision-wire": backend, children: [_jsxs("p", { children: [_jsx("strong", { children: "\u63A5\u53E3\uFF1A" }), _jsx("code", { children: wire })] }), backend === 'dsh' ? _jsxs("p", { className: "dms-hint", children: ["\u7ECF DSH \u7684 llm.stream \u8C03\u7528\uFF0C\u5B9E\u9645\u534F\u8BAE\u7531\u8BE5\u4F9B\u5E94\u5546\u5728 DSH \u4E2D\u7684\u8DEF\u7531\u51B3\u5B9A\uFF08\u5982 openai \u8DEF\u7531\u8D70 POST /v1/responses\uFF0CGoogle \u8D70 generateContent\uFF09\u3002", _jsx("strong", { children: "\u672C\u8D28\u662F\u8BA9\u901A\u7528\u5927\u6A21\u578B\u6309\u63D0\u793A\u8F93\u51FA JSON" }), "\uFF0C\u63D2\u4EF6\u518D\u89E3\u6790\uFF1BDSH \u76EE\u524D\u4E0D\u63D0\u4F9B\u51B3\u7B56\u63A5\u53E3\uFF0C\u6240\u4EE5 gpt-6-luna \u7B49\u51B3\u7B56\u6A21\u578B\u5728\u8FD9\u91CC\u4E5F\u4F1A\u88AB\u5F53\u6210\u804A\u5929\u6A21\u578B\u8C03\u7528\u3002"] }) : null, backend === 'openai' ? _jsxs("p", { className: "dms-hint", children: ["\u975E\u6D41\u5F0F\u3001temperature 0\u3002", _jsx("strong", { children: "\u672C\u8D28\u662F\u8BA9\u901A\u7528\u5927\u6A21\u578B\u6309\u63D0\u793A\u8F93\u51FA JSON" }), "\uFF0C\u63D2\u4EF6\u518D\u89E3\u6790\uFF1B\u8F93\u51FA\u4E0D\u662F\u5408\u6CD5 JSON \u65F6\u56DE\u9000\u5230\u89C4\u5219\u3002"] }) : null, backend === 'decisions' ? _jsxs("p", { className: "dms-hint", children: ["\u628A\u72B6\u6001\u548C\u5E26\u7C7B\u578B\u7684\u95EE\u9898\u53D1\u7ED9\u51B3\u7B56\u6A21\u578B\uFF0C\u76F4\u63A5\u8FD4\u56DE\u6982\u7387\u4E0E\u5206\u6570\uFF0C", _jsx("strong", { children: "\u4E0D\u751F\u6210\u6587\u5B57\u3001\u4E0D\u89E3\u6790 JSON \u6587\u672C" }), "\u3002OpenAI \u683C\u5F0F\u53D1\u9001 input + questions \u6570\u7EC4\uFF1BSystem One \u683C\u5F0F\u53D1\u9001 state + questions \u5BF9\u8C61\uFF08Jev/TypeSafe \u5B98\u65B9\u3001OpenRouter\u3001Vercel AI Gateway \u4F7F\u7528\uFF09\u3002\u8865\u641C\u5224\u65AD\u53EA\u51B3\u5B9A\u662F\u5426\u7EE7\u7EED\u3001\u9009\u54EA\u4E9B\u6E90\uFF0C\u4E0D\u4F1A\u63D0\u51FA\u65B0\u7684\u641C\u7D22\u8BCD\u3002"] }) : null] }), _jsxs("div", { className: "dms-grid", children: [backend === 'dsh' ? (_jsxs(_Fragment, { children: [_jsx(Field, { label: "\u4F9B\u5E94\u5546", hint: models.status === 'failed' ? `模型列表读取失败：${models.error}` : models.status === 'loading' ? '正在读取模型列表…' : undefined, children: providerOptions.length ? (_jsxs("select", { value: provider, disabled: disabled, onChange: event => { set(['decision', 'provider'], event.target.value); set(['decision', 'model'], ''); }, children: [_jsx("option", { value: "", children: "\uFF08\u672A\u9009\u62E9\uFF09" }), providerOptions.map(p => _jsx("option", { value: p.provider, children: p.name }, p.provider)), provider && !providerOptions.some(p => p.provider === provider) ? _jsx("option", { value: provider, children: provider }) : null] })) : text(['decision', 'provider'], '供应商 ID') }), _jsx(Field, { label: "\u6A21\u578B", children: modelList.length ? (_jsxs("select", { value: get(['decision', 'model']) ?? '', disabled: disabled, onChange: event => set(['decision', 'model'], event.target.value), children: [_jsx("option", { value: "", children: "\uFF08\u672A\u9009\u62E9\uFF09" }), modelList.map(m => _jsx("option", { value: m.id, children: m.name }, m.id)), get(['decision', 'model']) && !modelList.some(m => m.id === get(['decision', 'model'])) ? _jsx("option", { value: get(['decision', 'model']), children: get(['decision', 'model']) }) : null] })) : text(['decision', 'model'], '模型 ID') }), _jsx(Field, { label: "\u601D\u8003\u5F3A\u5EA6 ID\uFF08\u53EF\u9009\uFF09", children: text(['decision', 'reasoning']) })] })) : backend === 'openai' ? (_jsxs(_Fragment, { children: [_jsx(Field, { label: "\u63A5\u53E3\u5730\u5740", hint: "\u586B\u5230 /v1 \u5373\u53EF\uFF0C\u5982 https://api.siliconflow.cn/v1\uFF1B\u4E5F\u53EF\u586B\u5B8C\u6574\u7684 \u2026/chat/completions", children: text(['decision', 'baseURL'], 'https://api.example.com/v1') }), _jsx(Field, { label: "\u6A21\u578B ID", children: text(['decision', 'model'], '如 Qwen/Qwen3-8B') }), _jsx(Field, { label: "\u51ED\u636E\u5F15\u7528\u540D", hint: `默认 ${DECISION_DEFAULT_KEY}`, children: text(['decision', 'apiKey'], DECISION_DEFAULT_KEY) }), _jsx(Field, { label: "reasoning_effort\uFF08\u53EF\u9009\uFF09", hint: "\u7559\u7A7A\u4E0D\u53D1\u9001\uFF1B\u4E0D\u652F\u6301\u8BE5\u53C2\u6570\u7684\u63A5\u53E3\u8BF7\u7559\u7A7A", children: text(['decision', 'reasoning']) })] })) : (_jsxs(_Fragment, { children: [_jsx(Field, { label: "\u5FEB\u901F\u586B\u5165", hint: "\u586B\u5165\u63A5\u53E3\u683C\u5F0F\u3001\u5730\u5740\u548C\u6A21\u578B\uFF1B\u51ED\u636E\u5F15\u7528\u540D\u4E0D\u53D8", children: _jsxs("select", { value: "", disabled: disabled, "data-decision-preset": true, onChange: event => {
                                                const preset = DECISION_ENDPOINTS[event.target.value];
                                                if (!preset)
                                                    return;
                                                set(['decision', 'protocol'], preset.protocol);
                                                set(['decision', 'baseURL'], preset.baseURL);
                                                set(['decision', 'model'], preset.model);
                                            }, children: [_jsx("option", { value: "", children: "\uFF08\u9009\u62E9\u4E00\u4E2A\u9884\u8BBE\uFF09" }), Object.entries(DECISION_ENDPOINTS).map(([id, preset]) => _jsx("option", { value: id, children: preset.label }, id))] }) }), _jsx(Field, { label: "\u63A5\u53E3\u683C\u5F0F", children: select(['decision', 'protocol'], Object.entries(DECISION_PROTOCOLS).map(([id, p]) => [id, p.label])) }), _jsx(Field, { label: "\u63A5\u53E3\u5730\u5740", hint: `填到 /v1 时自动补 /${DECISION_PROTOCOLS[protocol].path}；也可填完整地址（有的服务用 …/decisions 提供 System One 格式）`, children: text(['decision', 'baseURL'], 'https://api.openai.com/v1') }), _jsx(Field, { label: "\u6A21\u578B ID", children: text(['decision', 'model'], protocol === 'systemone' ? '如 typesafe/jev-1.14' : '如 gpt-6-luna') }), _jsx(Field, { label: "\u51ED\u636E\u5F15\u7528\u540D", hint: `默认 ${DECISION_DEFAULT_KEY}；以 Bearer 发送`, children: text(['decision', 'apiKey'], DECISION_DEFAULT_KEY) })] })), _jsx(Field, { label: "\u5355\u6B21\u5224\u65AD\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09", children: num(['decision', 'timeoutMs']) }), _jsx(Field, { label: "\u76F8\u5173\u6027\u4F4E\u4E8E\u6B64\u503C\u964D\u6743\uFF080\u20131\uFF09", children: num(['decision', 'keepThreshold'], { step: '0.05' }) }), _jsx(Field, { label: "\u5355\u6279\u5224\u65AD\u5019\u9009\u6570", children: num(['decision', 'maxCandidates']) })] }), backend !== 'dsh' ? (extraKey(decisionRef)
                        ? keyEditor(extraKey(decisionRef), true)
                        : status.status === 'ready' ? _jsxs("p", { className: "dms-warn", children: ["\u51ED\u636E\u5F15\u7528\u540D ", decisionRef, " \u662F\u65B0\u586B\u5199\u7684\uFF0C\u5148\u70B9\u9875\u9762\u5E95\u90E8\u7684\u201C\u4FDD\u5B58\u201D\uFF0C\u518D\u5728\u8FD9\u91CC\u586B\u5199\u5BC6\u94A5\u3002"] }) : null) : null, backend !== 'dsh' && savedBackend !== backend ? _jsx("p", { className: "dms-warn", children: "\u540E\u7AEF\u5207\u6362\u8FD8\u6CA1\u4FDD\u5B58\uFF1A\u5BC6\u94A5\u53EF\u4EE5\u5148\u5B58\uFF0C\u8BB0\u5F97\u70B9\u9875\u9762\u5E95\u90E8\u7684\u201C\u4FDD\u5B58\u201D\u3002" }) : null, _jsx(Field, { label: "\u4F7F\u7528\u73AF\u8282", children: _jsx("span", { className: "dms-checks", children: [['route', '选源'], ['rerank', '相关性重排'], ['followup', '补搜判断']].map(([id, label]) => (_jsxs("label", { children: [_jsx("input", { type: "checkbox", disabled: disabled, checked: stages.includes(id), onChange: event => set(['decision', 'stages'], event.target.checked ? [...stages, id] : stages.filter(s => s !== id)) }), label] }, id))) }) }), probeLine('decision', '测试决策模型')] })] }));
    const skillAction = async (action) => {
        const client = props.remote();
        if (!client)
            return;
        setSkillMessage(action === 'save' ? '正在保存…' : '正在恢复…');
        try {
            await (action === 'save' ? client.saveSkill(skillText ?? '') : client.restoreSkill());
            setSkillText(undefined);
            setSkillMessage(action === 'save' ? '已保存，立即生效' : '已恢复为插件生成的内容');
            reloadSkill();
        }
        catch (error) {
            setSkillMessage(`失败：${error instanceof Error ? error.message : String(error)}`);
        }
    };
    const SKILL_STATES = {
        synced: ['与设置同步：修改上面的预算后会自动更新', 'ok'],
        modified: ['已手动修改：插件不再覆盖，预算改动不会写入', 'off'],
        deleted: ['文件已删除（可在技能管理的回收站恢复，或点“恢复默认内容”）', 'bad'],
        foreign: ['该位置已有一个不是本插件写入的同名技能，插件没有覆盖它', 'bad'],
        builtin: ['内置模式：技能由插件在内存中注册，技能管理插件看不到', 'off'],
    };
    const skillFile = skill.status === 'ready' ? skill.value : undefined;
    const skillEditor = (_jsxs("fieldset", { children: [_jsx("legend", { children: "\u6280\u80FD\u6587\u4EF6" }), _jsx(Field, { label: "\u63D0\u4F9B\u65B9\u5F0F", hint: "\u6587\u4EF6\u6A21\u5F0F\u4E0B\u6280\u80FD\u662F\u4E00\u4E2A\u666E\u901A\u7684 SKILL.md\uFF0CDSH \u7684\u672C\u5730\u6280\u80FD\u52A0\u8F7D\u5668\u4F1A\u52A0\u8F7D\u5B83\uFF0C\u6280\u80FD\u7BA1\u7406\u63D2\u4EF6\u53EF\u4EE5\u5217\u51FA\u3001\u505C\u7528\u6216\u79FB\u5165\u56DE\u6536\u7AD9\u3002", children: select(['research', 'skillMode'], [['file', '文件（推荐）'], ['builtin', '插件内置']]) }), skill.status === 'loading' ? _jsx("p", { className: "dms-hint", children: "\u6B63\u5728\u8BFB\u53D6\u6280\u80FD\u6587\u4EF6\u2026" }) : null, skill.status === 'failed' ? _jsxs("p", { className: "dms-err", children: ["\u6280\u80FD\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25\uFF1A", skill.error, " ", _jsx("button", { type: "button", onClick: reloadSkill, children: "\u91CD\u8BD5" })] }) : null, skillFile ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: [_jsx(Badge, { state: SKILL_STATES[skillFile.state][1], children: SKILL_STATES[skillFile.state][0] }), " ", _jsx("code", { className: "dms-hint", children: skillFile.path })] }), skillFile.error ? _jsx("p", { className: "dms-err", children: skillFile.error }) : null, skillFile.mode === 'file' && skillFile.state !== 'foreign' ? (_jsxs(_Fragment, { children: [_jsx(Field, { label: "SKILL.md\uFF08\u542B frontmatter\uFF09", hint: "name \u987B\u4E3A\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u8FDE\u5B57\u7B26\uFF1Bdescription \u5FC5\u586B\u3002\u4FDD\u5B58\u540E\u76F4\u63A5\u5199\u5165\u6587\u4EF6\uFF0C\u4E0D\u9700\u8981\u70B9\u9875\u9762\u5E95\u90E8\u7684\u4FDD\u5B58\u3002", children: _jsx("textarea", { "data-skill-editor": true, rows: 22, spellCheck: false, value: skillText ?? skillFile.content ?? skillFile.generated, onChange: event => setSkillText(event.target.value) }) }), _jsxs("div", { className: "dms-key", children: [_jsx("button", { type: "button", "data-skill-action": "save", disabled: skillText === undefined || skillText === (skillFile.content ?? ''), onClick: () => skillAction('save'), children: "\u4FDD\u5B58\u6280\u80FD\u6587\u4EF6" }), _jsx("button", { type: "button", "data-skill-action": "restore", onClick: () => { if (skillFile.state === 'synced' || confirm('用插件生成的内容覆盖当前技能文件？'))
                                            void skillAction('restore'); }, children: "\u6062\u590D\u9ED8\u8BA4\u5185\u5BB9" }), skillText !== undefined ? _jsx("button", { type: "button", onClick: () => setSkillText(undefined), children: "\u653E\u5F03\u4FEE\u6539" }) : null, skillMessage ? _jsx("small", { className: skillMessage.startsWith('失败') ? 'dms-err' : 'dms-ok', role: "status", children: skillMessage }) : null] })] })) : null] })) : null] }));
    const research = (_jsxs(_Fragment, { children: [_jsxs("fieldset", { children: [_jsx("legend", { children: "\u6DF1\u5EA6\u7814\u7A76" }), _jsx("p", { className: "dms-hint", children: "\u8FD9\u4E9B\u4E0A\u9650\u4F1A\u5199\u8FDB deep-research \u6280\u80FD\uFF0C\u8C03\u7528\u6A21\u578B\u636E\u6B64\u5206\u5DE5\u548C\u63A7\u5236\u9884\u7B97\u3002\u6280\u80FD\u6587\u4EF6\u88AB\u624B\u52A8\u4FEE\u6539\u540E\uFF0C\u8FD9\u91CC\u7684\u6539\u52A8\u4E0D\u518D\u5199\u5165\u6587\u4EF6\u3002" }), _jsxs("div", { className: "dms-grid", children: [_jsx(Field, { label: "\u5B50\u667A\u80FD\u4F53\u6700\u5927\u6570\u91CF", children: num(['research', 'maxSubagents']) }), _jsx(Field, { label: "\u7814\u7A76\u8F6E\u6570\u4E0A\u9650", children: num(['research', 'maxRounds']) }), _jsx(Field, { label: "\u603B\u8BFB\u9875\u6570\u4E0A\u9650", children: num(['research', 'maxPages']) }), _jsx(Field, { label: "\u603B\u65F6\u957F\uFF08\u5206\u949F\uFF09", children: num(['research', 'timeMinutes']) }), _jsx(Field, { label: "search/fetch \u603B\u8C03\u7528\u6B21\u6570\u4E0A\u9650", children: num(['research', 'maxCalls']) })] }), toggle(['research', 'modelInvocable'], '允许模型在用户明确要求深度研究时自行加载技能'), _jsx("button", { type: "button", disabled: disabled, onClick: () => resetSection('research', '深度研究'), children: "\u6062\u590D\u9ED8\u8BA4" })] }), skillEditor] }));
    const pages = { overview, general, sources: sourceCards, routing, ranking, research };
    const unchanged = !dirty || deepEqual(draft, accepted) && Object.keys(texts).every(key => !key.endsWith('#json'));
    return (_jsxs("div", { className: "dms-settings", children: [!snapshot.writable ? _jsx("p", { className: "dms-warn", children: "\u5F53\u524D\u8BBE\u7F6E\u6587\u4EF6\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002" }) : null, _jsx("div", { className: "dms-tabs", role: "tablist", children: TABS.map(([id, label]) => _jsx("button", { type: "button", role: "tab", "aria-selected": tab === id, onClick: () => setTab(id), children: label }, id)) }), pages[tab], _jsxs("div", { className: "dms-actions", children: [_jsx("button", { type: "button", "data-action": "save", disabled: disabled || unchanged, onClick: () => void save(), children: saving === 'saving' ? '正在保存…' : '保存' }), _jsx("button", { type: "button", disabled: disabled || !dirty, onClick: discard, children: "\u653E\u5F03\u4FEE\u6539" }), saving === 'saved' ? _jsx("span", { className: "dms-ok", role: "status", children: "\u5DF2\u4FDD\u5B58\uFF0C\u7ACB\u5373\u751F\u6548" }) : null, saving === 'failed' ? _jsx("span", { className: "dms-err", role: "alert", children: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6807\u7EA2\u7684\u5B57\u6BB5" }) : null, dirty && saving === 'idle' ? _jsx("span", { className: "dms-hint", children: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539" }) : null] })] }));
}
