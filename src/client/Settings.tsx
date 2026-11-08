/** Settings → 多源搜索 (also the bundle's page on the Plugins page). Edits stay local until Save. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { MultisearchRemote, MultisearchStatus, ProviderModels, SkillStatus } from '../remote.js'
import { DECISION_DEFAULT_KEY, DECISION_ENDPOINTS, DECISION_PROTOCOLS, RERANK_PROVIDERS, RERANK_PROVIDER_IDS, decisionWire, rerankTarget, type DecisionProtocol, type RerankProvider } from '../presets.js'
import { deepEqual, diffOps, getIn, setIn, splitList } from './draft.js'

export interface FormLike {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: unknown; user: unknown; revision: number | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>
}

export interface SettingsProps {
  form: FormLike
  remote: () => MultisearchRemote | undefined
  view?: 'summary' | 'page'
}

type Value = Record<string, any>
type Load<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; error: string }

const TABS = [
  ['overview', '概览'], ['general', '常规与档位'], ['sources', '搜索源与密钥'], ['routing', '路由与抓取'], ['ranking', '重排与决策模型'], ['research', '深度研究'],
] as const
type Tab = typeof TABS[number][0]

const TYPE_LABELS: Record<string, string> = {
  web: '网页', news: '新闻', documentation: '文档', code: '代码', academic: '学术', social: '社媒', community: '社区',
  finance: '财经', government: '政府', 'ai-models': 'AI 模型', company: '企业', chinese: '中文', answer: '生成答案',
}

const TUNING: [string, string, 'number' | 'boolean'][] = [
  ['parallelSources', '并行来源数量', 'number'], ['queryConcurrency', '查询并发数', 'number'], ['perSourceResults', '每源候选数量', 'number'],
  ['returnResults', '返回条数', 'number'], ['outputTokens', '证据输出预算（约 tokens）', 'number'], ['snippetChars', '每条片段字符数', 'number'],
  ['candidateLimit', '参与重排的候选数', 'number'], ['rerank', '启用重排', 'boolean'],
  ['autoFollowUp', '自动补搜', 'boolean'], ['followUpRounds', '补搜轮数', 'number'], ['minResults', '结果少于此数触发补搜', 'number'],
  ['duplicateRatio', '重复占比高于此值触发补搜（0–1）', 'number'],
  ['requestTimeoutMs', '单请求超时（毫秒）', 'number'], ['callTimeoutMs', '单次调用总时限（毫秒）', 'number'],
  ['fetchConcurrency', '抓取并发数', 'number'], ['fetchMaxChars', '每页返回字符数', 'number'], ['fetchRetries', '同一服务重试次数', 'number'],
  ['fetchFallbacks', '同一 URL 最多尝试服务数', 'number'], ['cacheTtlMinutes', '正文缓存时效（分钟）', 'number'],
]

const LIMITS: [string, string][] = [
  ['maxQueries', '单次最多查询数'], ['maxParallelSources', '并行来源数上限'], ['maxPerSourceResults', '每源候选数上限'],
  ['maxReturnResults', '返回条数上限'], ['maxOutputTokens', '输出预算上限'], ['maxCallTimeoutMs', '单次调用时限上限（毫秒）'],
  ['maxRequestTimeoutMs', '单请求超时上限（毫秒）'], ['maxFetchUrls', '单次抓取 URL 上限'], ['maxFetchChars', '单页字符上限'],
  ['maxFollowUpRounds', '补搜轮数上限'], ['maxCrawlPages', '站内爬取页数上限'], ['maxCrawlDepth', '站内爬取深度上限'],
]

function useLoad<T>(load: ((signal: AbortSignal) => Promise<T>) | undefined): [Load<T>, () => void] {
  const [state, setState] = useState<Load<T>>({ status: 'loading' })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!load) { setState({ status: 'failed', error: '插件服务未连接' }); return }
    const abort = new AbortController()
    setState(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    load(abort.signal).then(
      value => { if (!abort.signal.aborted) setState({ status: 'ready', value }) },
      error => { if (!abort.signal.aborted) setState({ status: 'failed', error: error instanceof Error ? error.message : String(error) }) },
    )
    return () => abort.abort()
  }, [load, generation])
  return [state, useCallback(() => setGeneration(value => value + 1), [])]
}

function Field(props: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="dms-field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
      {props.error ? <small className="dms-err" role="alert">{props.error}</small> : null}
    </label>
  )
}

function Badge(props: { state: 'ok' | 'off' | 'bad'; children: ReactNode; title?: string }) {
  return <span className="dms-badge" data-state={props.state} title={props.title}>{props.children}</span>
}

export function MultisearchSettings(props: SettingsProps) {
  const snapshot = useSyncExternalStore(props.form.subscribe.bind(props.form), () => props.form.getSnapshot())
  const accepted = useMemo(() => (snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : {}) as Value, [snapshot.value])
  const [draft, setDraft] = useState<Value>(accepted)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [tab, setTab] = useState<Tab>('overview')
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [keyStatus, setKeyStatus] = useState<Record<string, string>>({})
  const remote = props.remote()
  const loadStatus = useMemo(() => remote ? (signal: AbortSignal) => remote.status(signal) : undefined, [remote])
  const loadModels = useMemo(() => remote && tab === 'ranking' ? (signal: AbortSignal) => remote.models(signal) : undefined, [remote, tab])
  const [status, reloadStatus] = useLoad<MultisearchStatus>(loadStatus)
  const [models] = useLoad<ProviderModels>(loadModels)
  const loadSkill = useMemo(() => remote && tab === 'research' ? (signal: AbortSignal) => remote.skillStatus(signal) : undefined, [remote, tab])
  const [skill, reloadSkill] = useLoad<SkillStatus>(loadSkill)
  const [skillText, setSkillText] = useState<string | undefined>(undefined)
  const [skillMessage, setSkillMessage] = useState('')
  const [probe, setProbe] = useState<{ rerank?: string; decision?: string }>({})
  // A settings save can rewrite a file the plugin still owns; read it again (the plugin syncs asynchronously).
  useEffect(() => { const timer = setTimeout(reloadSkill, 400); return () => clearTimeout(timer) }, [accepted, reloadSkill])

  // Follow Host changes (another window, a reset) until the user starts editing.
  useEffect(() => { if (!dirty) { setDraft(accepted); setTexts({}); setErrors({}) } }, [accepted, dirty])
  // Saved settings change readiness (enabled sources, zones, credential refs): refresh it.
  useEffect(() => { reloadStatus() }, [accepted, reloadStatus])

  if (props.view === 'summary') return <>多源搜索与网页抓取：来源、密钥、档位、重排、决策模型与深度研究预算。</>
  if (snapshot.status === 'loading') return <div className="dms-settings"><p className="dms-hint">正在读取设置…</p></div>
  if (snapshot.status === 'unavailable') return <div className="dms-settings"><p className="dms-hint">插件未运行，无法读取设置。请确认插件已启用。</p></div>

  const disabled = !snapshot.writable || saving === 'saving'
  const get = (path: string[]) => getIn(draft, path)
  const set = (path: string[], value: unknown) => {
    setDraft(previous => setIn(previous, path, value))
    setDirty(true)
    if (saving !== 'saving') setSaving('idle')
  }
  const textKey = (path: string[]) => path.join('.')
  const listText = (path: string[], separator = ', ') => texts[textKey(path)] ?? ((get(path) as string[] | undefined) ?? []).join(separator)
  const editList = (path: string[], text: string) => {
    setTexts(previous => ({ ...previous, [textKey(path)]: text }))
    set(path, splitList(text))
  }

  const num = (path: string[], options: { optional?: boolean; step?: string; placeholder?: string } = {}) => {
    const value = get(path) as number | undefined
    return (
      <input type="number" step={options.step ?? '1'} value={value ?? ''} placeholder={options.placeholder} disabled={disabled}
        onChange={event => {
          const text = event.target.value
          if (text === '') { if (options.optional) set(path, undefined); return }
          const parsed = Number(text)
          if (Number.isFinite(parsed)) set(path, parsed)
        }} />
    )
  }
  const text = (path: string[], placeholder?: string) => (
    <input type="text" value={(get(path) as string | undefined) ?? ''} placeholder={placeholder} disabled={disabled} onChange={event => set(path, event.target.value)} />
  )
  const toggle = (path: string[], label: string, hint?: string) => (
    <label className="dms-toggle">
      <input type="checkbox" checked={Boolean(get(path))} disabled={disabled} onChange={event => set(path, event.target.checked)} />
      <span><span>{label}</span>{hint ? <><br /><small className="dms-hint">{hint}</small></> : null}</span>
    </label>
  )
  const select = (path: string[], options: [string, string][]) => (
    <select value={(get(path) as string | undefined) ?? ''} disabled={disabled} onChange={event => set(path, event.target.value)}>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  )

  const save = async () => {
    // Parse JSON editors into the draft first; any error blocks the write.
    let next = draft
    const nextErrors: Record<string, string> = {}
    for (const [key, value] of Object.entries(texts)) {
      if (!key.endsWith('#json')) continue
      try { next = setIn(next, key.slice(0, -5).split('.'), JSON.parse(value)) } catch (error) { nextErrors[key] = `JSON 无效：${error instanceof Error ? error.message : String(error)}` }
    }
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) { setSaving('failed'); return }
    const ops = diffOps(accepted, next)
    if (ops.length === 0) { setDirty(false); return }
    setSaving('saving')
    try {
      const ok = await props.form.mutate(ops, snapshot.revision)
      setSaving(ok ? 'saved' : 'failed')
      if (ok) setDirty(false)
    } catch {
      setSaving('failed')
    }
  }
  const discard = () => { setDraft(accepted); setTexts({}); setErrors({}); setDirty(false); setSaving('idle') }
  const resetSection = async (section: string, label: string) => {
    if (!window.confirm(`把“${label}”恢复为默认值？`)) return
    setSaving('saving')
    try { setSaving(await props.form.mutate([{ op: 'unset', path: [section] }], snapshot.revision) ? 'saved' : 'failed') } catch { setSaving('failed') }
  }
  const json = (path: string[], fallback: unknown, rows: number) => {
    const key = `${textKey(path)}#json`
    return (
      <textarea rows={rows} spellCheck={false} disabled={disabled} aria-invalid={errors[key] ? true : undefined}
        value={texts[key] ?? JSON.stringify(get(path) ?? fallback, null, 2)}
        onChange={event => { setTexts(previous => ({ ...previous, [key]: event.target.value })); setErrors(previous => ({ ...previous, [key]: '' })); setDirty(true); setSaving('idle') }} />
    )
  }

  const sources = status.status === 'ready' ? status.value.sources : []
  const sourceIds = sources.map(s => s.id)
  const presets = status.status === 'ready' ? status.value.presets : {}
  const profile = (get(['profile']) as string | undefined) ?? 'balanced'

  const writeKey = async (ref: string, clear: boolean) => {
    const client = props.remote()
    if (!client) return
    setKeyStatus(previous => ({ ...previous, [ref]: '正在保存…' }))
    try {
      const result = clear ? await client.clearCredential(ref) : await client.setCredential(ref, keys[ref] ?? '')
      setKeys(previous => ({ ...previous, [ref]: '' }))
      setKeyStatus(previous => ({ ...previous, [ref]: clear ? '已清除' : result.configured ? '已保存' : '已保存，但未检测到密钥' }))
      reloadStatus()
    } catch (error) {
      setKeyStatus(previous => ({ ...previous, [ref]: `失败：${error instanceof Error ? error.message : String(error)}` }))
    }
  }
  const keyEditor = (credential: { ref: string; configured: boolean; writable: boolean; optional?: boolean } | undefined, savedRef: boolean) => {
    if (!credential) return null
    const message = keyStatus[credential.ref]
    return (
      <div className="dms-key">
        <Badge state={credential.configured ? 'ok' : credential.optional ? 'off' : 'bad'}>{credential.configured ? '密钥已配置' : credential.optional ? '未配置（可选）' : '未配置密钥'}</Badge>
        <input type="password" autoComplete="new-password" placeholder={`输入 ${credential.ref} 的值`} value={keys[credential.ref] ?? ''}
          disabled={!credential.writable || !savedRef} onChange={event => setKeys(previous => ({ ...previous, [credential.ref]: event.target.value }))} />
        <button type="button" disabled={!credential.writable || !savedRef || !(keys[credential.ref] ?? '').trim()} onClick={() => writeKey(credential.ref, false)}>保存密钥</button>
        <button type="button" disabled={!credential.writable || !savedRef || !credential.configured} onClick={() => writeKey(credential.ref, true)}>清除</button>
        {!credential.writable ? <small className="dms-hint">此凭据由只读来源（如环境变量）提供</small> : null}
        {!savedRef ? <small className="dms-warn">凭据引用名已修改，先保存设置再填写密钥</small> : null}
        {message ? <small className={message.startsWith('失败') ? 'dms-err' : 'dms-ok'}>{message}</small> : null}
      </div>
    )
  }

  const overview = (
    <>
      <p>插件提供 <code>{(get(['tools', 'searchName']) as string) || 'search'}</code> 与 <code>{(get(['tools', 'fetchName']) as string) || 'fetch'}</code> 两个工具和 <code>deep-research</code> 技能。下表是各来源当前能否使用；在“搜索源与密钥”中启用来源并填写密钥。</p>
      {status.status === 'loading' ? <p className="dms-hint">正在读取来源状态…</p> : null}
      {status.status === 'failed' ? <p className="dms-err">来源状态读取失败：{status.error} <button type="button" onClick={reloadStatus}>重试</button></p> : null}
      {status.status === 'ready' ? (
        <table className="dms-table">
          <thead><tr><th>来源</th><th>启用</th><th>搜索</th><th>抓取</th></tr></thead>
          <tbody>{sources.map(s => {
            const enabled = Boolean(getIn(accepted, ['sources', s.id, 'enabled']) ?? s.defaultEnabled)
            const cell = (supported: boolean, ready: { ok: boolean; reason?: string }) => !supported ? <Badge state="off">不支持</Badge>
              : !enabled ? <Badge state="off">未启用</Badge> : ready.ok ? <Badge state="ok">可用</Badge> : <Badge state={ready.reason?.startsWith('已关闭') ? 'off' : 'bad'} title={ready.reason}>{ready.reason ?? '不可用'}</Badge>
            return <tr key={s.id}><td>{s.label}</td><td>{enabled ? '是' : '否'}</td><td>{cell(s.search, s.searchReady)}</td><td>{cell(s.fetch, s.fetchReady)}</td></tr>
          })}</tbody>
        </table>
      ) : null}
    </>
  )

  const general = (
    <>
      <fieldset>
        <legend>工具</legend>
        <div className="dms-grid">
          <Field label="默认档位" hint="单次调用可用 profile 参数覆盖">{select(['profile'], [['fast', 'fast 快速'], ['balanced', 'balanced 均衡'], ['deep', 'deep 深入']])}</Field>
          <Field label="搜索工具名">{text(['tools', 'searchName'], 'search')}</Field>
          <Field label="抓取工具名">{text(['tools', 'fetchName'], 'fetch')}</Field>
        </div>
        {toggle(['tools', 'search'], '注册搜索工具')}
        {toggle(['tools', 'fetch'], '注册抓取工具')}
        {toggle(['tools', 'guidance'], '在系统提示词中加入简短使用说明')}
      </fieldset>
      <fieldset>
        <legend>逐项覆盖档位默认值</legend>
        <p className="dms-hint">留空即使用当前档位（{profile}）的值，占位文字就是档位值。优先级：单次调用参数 ＞ 这里的设置 ＞ 档位默认值，均受硬性上限约束。</p>
        <div className="dms-grid">
          {TUNING.map(([key, label, kind]) => {
            const preset = presets[profile]?.[key]
            if (kind === 'boolean') {
              const value = get(['overrides', key]) as boolean | undefined
              return (
                <Field key={key} label={label}>
                  <select value={value === undefined ? '' : value ? 'on' : 'off'} disabled={disabled}
                    onChange={event => set(['overrides', key], event.target.value === '' ? undefined : event.target.value === 'on')}>
                    <option value="">跟随档位（{preset === undefined ? '…' : preset ? '开' : '关'}）</option>
                    <option value="on">开</option><option value="off">关</option>
                  </select>
                </Field>
              )
            }
            return <Field key={key} label={label}>{num(['overrides', key], { optional: true, step: key === 'duplicateRatio' ? '0.05' : '1', placeholder: preset === undefined ? '' : String(preset) })}</Field>
          })}
        </div>
        <button type="button" disabled={disabled} onClick={() => resetSection('overrides', '逐项覆盖')}>全部跟随档位</button>
      </fieldset>
      <fieldset>
        <legend>硬性上限</legend>
        <div className="dms-grid">{LIMITS.map(([key, label]) => <Field key={key} label={label}>{num(['limits', key])}</Field>)}</div>
        <button type="button" disabled={disabled} onClick={() => resetSection('limits', '硬性上限')}>恢复默认</button>
      </fieldset>
    </>
  )

  const types = status.status === 'ready' ? status.value.resourceTypes : Object.keys(TYPE_LABELS)
  const sourceCards = (
    <>
      <p className="dms-hint">密钥直接存入 DSH 凭据存储，不写入设置文件；“保存密钥”立即生效，不需要点页面底部的保存。其他改动需点“保存”。</p>
      {status.status === 'failed' ? <p className="dms-err">来源列表读取失败：{status.error} <button type="button" onClick={reloadStatus}>重试</button></p> : null}
      {status.status === 'loading' ? <p className="dms-hint">正在读取来源…</p> : null}
      {sources.map(s => {
        const base = ['sources', s.id]
        const enabled = Boolean(get([...base, 'enabled']) ?? s.defaultEnabled)
        const savedRef = !s.credential || (get([...base, 'apiKey']) ?? s.credential.ref) === (getIn(accepted, [...base, 'apiKey']) ?? s.credential.ref)
        const selectedTypes = (get([...base, 'types']) as string[] | undefined) ?? []
        return (
          <div className="dms-card" key={s.id} data-enabled={enabled}>
            <div className="dms-card-head">
              <label className="dms-toggle" style={{ margin: 0 }}>
                <input type="checkbox" checked={enabled} disabled={disabled} onChange={event => set([...base, 'enabled'], event.target.checked)} />
                <strong>{s.label}</strong>
              </label>
              <Badge state={s.search ? (s.searchReady.ok ? 'ok' : s.searchReady.reason?.startsWith('已关闭') ? 'off' : 'bad') : 'off'} title={s.searchReady.reason}>搜索{s.search ? (s.searchReady.ok ? ' ✓' : `：${s.searchReady.reason}`) : '：不支持'}</Badge>
              <Badge state={s.fetch ? (s.fetchReady.ok ? 'ok' : s.fetchReady.reason?.startsWith('已关闭') ? 'off' : 'bad') : 'off'} title={s.fetchReady.reason}>抓取{s.fetch ? (s.fetchReady.ok ? ' ✓' : `：${s.fetchReady.reason}`) : '：不支持'}</Badge>
              <code className="dms-hint">{s.id}</code>
            </div>
            <small>{s.blurb}</small>
            {s.search || s.fetch ? (
              <span className="dms-checks" style={{ margin: '6px 0 2px' }}>
                {([['search', '使用搜索', s.search], ['fetch', '使用抓取', s.fetch]] as const).filter(([, , supported]) => supported).map(([cap, label]) => (
                  <label key={cap}><input type="checkbox" data-cap={cap} disabled={disabled || !enabled} checked={(get([...base, cap]) as boolean | undefined) ?? true}
                    onChange={event => set([...base, cap], event.target.checked)} />{label}</label>
                ))}
              </span>
            ) : null}
            {keyEditor(s.credential, savedRef)}
            <details className="dms-more">
              <summary>高级设置</summary>
              <div className="dms-grid">
                {s.credential ? <Field label="凭据引用名" hint={`默认 ${s.credential.ref}`}>{text([...base, 'apiKey'], s.credential.ref)}</Field> : null}
                <Field label="优先级（0–100）" hint={`默认 ${s.defaultPriority}`}>{num([...base, 'priority'])}</Field>
                <Field label="自定义接口地址" hint="留空使用官方地址">{text([...base, 'baseURL'])}</Field>
              </div>
              <Field label="能力标签" hint={`都不勾选时使用内置标签：${s.defaultTypes.map(t => TYPE_LABELS[t] ?? t).join('、')}`}>
                <span className="dms-checks">{types.map(type => (
                  <label key={type}><input type="checkbox" disabled={disabled} checked={selectedTypes.includes(type)}
                    onChange={event => set([...base, 'types'], event.target.checked ? [...selectedTypes, type] : selectedTypes.filter(t => t !== type))} />{TYPE_LABELS[type] ?? type}</label>
                ))}</span>
              </Field>
              {Object.keys(s.defaultOptions).length || getIn(accepted, [...base, 'options']) ? (
                <Field label="来源专属参数（JSON）" hint={`默认 ${JSON.stringify(s.defaultOptions)}`} error={errors[`${base.join('.')}.options#json`]}>
                  {json([...base, 'options'], s.defaultOptions, 4)}
                </Field>
              ) : null}
            </details>
          </div>
        )
      })}
    </>
  )

  const routing = (
    <>
      <fieldset>
        <legend>来源与路由</legend>
        {toggle(['routing', 'autoRoute'], '按需求自动选源', '关闭后只使用下面的通用组合（或调用方指定的来源）')}
        <Field label="通用组合（按顺序取可用来源）" hint={`可用 ID：${sourceIds.join(', ')}`}>
          <input type="text" value={listText(['routing', 'defaultSources'])} disabled={disabled} onChange={event => editList(['routing', 'defaultSources'], event.target.value)} />
        </Field>
        <div className="dms-grid">
          <Field label="共用底层引擎扣分">{num(['routing', 'overlapPenalty'])}</Field>
        </div>
        <Field label="额外视为官方资料的域名（每行一个）">
          <textarea rows={3} value={listText(['routing', 'officialDomains'], '\n')} disabled={disabled} onChange={event => editList(['routing', 'officialDomains'], event.target.value)} />
        </Field>
        <Field label="自定义匹配规则（JSON 数组）" hint='例：[{"name":"前端文档","types":["documentation"],"keywords":["react"],"sites":[],"sources":["context7"],"boost":40}]' error={errors['routing.rules#json']}>
          {json(['routing', 'rules'], [], 5)}
        </Field>
        <button type="button" disabled={disabled} onClick={() => resetSection('routing', '来源与路由')}>恢复默认</button>
      </fieldset>
      <fieldset>
        <legend>抓取</legend>
        <Field label="抓取服务回退顺序" hint={`默认：${status.status === 'ready' ? status.value.defaultFetchOrder.join(', ') : ''}。只认识特定网站的读取器会自动排在最前，模型转述总在最后。`}>
          <input type="text" value={listText(['fetching', 'order'])} disabled={disabled} onChange={event => editList(['fetching', 'order'], event.target.value)} />
        </Field>
        <div className="dms-grid">
          <Field label="少于该字符数视为空内容">{num(['fetching', 'minContentChars'])}</Field>
        </div>
        <Field label="优先用渲染型服务的域名（每行一个）">
          <textarea rows={3} value={listText(['fetching', 'preferRender'], '\n')} disabled={disabled} onChange={event => editList(['fetching', 'preferRender'], event.target.value)} />
        </Field>
        {toggle(['fetching', 'allowPrivateNetwork'], '允许直接请求本机与内网地址', '默认关闭，避免模型读取内网服务')}
        <button type="button" disabled={disabled} onClick={() => resetSection('fetching', '抓取')}>恢复默认</button>
      </fieldset>
    </>
  )

  const extraKey = (ref: string) => status.status === 'ready' ? status.value.extraCredentials.find(c => c.ref === ref) : undefined
  const rerankProvider = ((get(['rerank', 'provider']) as string | undefined) ?? 'jina') as RerankProvider
  const preset = RERANK_PROVIDERS[rerankProvider] ?? RERANK_PROVIDERS.custom
  const savedRerank = rerankTarget((getIn(accepted, ['rerank']) ?? {}) as any)
  const draftRerank = rerankTarget((get(['rerank']) ?? {}) as any)
  // The key box follows the draft: preset references are known to the Host before the switch is saved.
  const rerankKey = draftRerank.apiKey ? extraKey(draftRerank.apiKey) : undefined
  const backend = ((get(['decision', 'backend']) as string | undefined) ?? 'dsh') as 'dsh' | 'openai' | 'decisions'
  const protocol = ((get(['decision', 'protocol']) as string | undefined) ?? 'openai') as DecisionProtocol
  const wire = decisionWire({ backend, protocol, baseURL: (get(['decision', 'baseURL']) as string | undefined) ?? '' })
  const decisionRef = (get(['decision', 'apiKey']) as string | undefined) || DECISION_DEFAULT_KEY
  const savedBackend = (getIn(accepted, ['decision', 'backend']) as string | undefined) ?? 'dsh'
  const providerOptions = models.status === 'ready' ? models.value.providers : []
  const provider = (get(['decision', 'provider']) as string | undefined) ?? ''
  const modelList = providerOptions.find(p => p.provider === provider)?.models ?? []
  const stages = (get(['decision', 'stages']) as string[] | undefined) ?? []
  const runProbe = async (which: 'rerank' | 'decision') => {
    const client = props.remote()
    if (!client) return
    setProbe(previous => ({ ...previous, [which]: '正在测试…' }))
    try {
      const result = await (which === 'rerank' ? client.testRerank() : client.testDecision())
      setProbe(previous => ({ ...previous, [which]: `${result.ok ? '通过' : '失败'}：${result.detail}${result.ms ? `（${(result.ms / 1000).toFixed(1)} 秒）` : ''}` }))
    } catch (error) {
      setProbe(previous => ({ ...previous, [which]: `失败：${error instanceof Error ? error.message : String(error)}` }))
    }
  }
  const probeLine = (which: 'rerank' | 'decision', label: string) => (
    <div className="dms-key">
      <button type="button" data-probe={which} disabled={!deepEqual(draft, accepted)} onClick={() => runProbe(which)}>{label}</button>
      {!deepEqual(draft, accepted) ? <small className="dms-warn">先保存设置再测试</small> : null}
      {probe[which] ? <small className={probe[which]!.startsWith('通过') ? 'dms-ok' : probe[which] === '正在测试…' ? 'dms-hint' : 'dms-err'} role="status">{probe[which]}</small> : null}
    </div>
  )
  const ranking = (
    <>
      <fieldset>
        <legend>结果重排</legend>
        <div className="dms-grid">
          <Field label="重排方式">{select(['rerank', 'mode'], [['rules', '规则'], ['service', '专用重排服务'], ['model', '决策模型']])}</Field>
          <Field label="重排服务供应商">
            <select value={rerankProvider} disabled={disabled} onChange={event => {
              set(['rerank', 'provider'], event.target.value)
              // Overrides belong to the previous provider; drop the ones that were filled in.
              for (const field of ['url', 'model', 'apiKey']) if (get(['rerank', field])) set(['rerank', field], undefined)
            }}>
              {RERANK_PROVIDER_IDS.map(id => <option key={id} value={id}>{RERANK_PROVIDERS[id].label}</option>)}
            </select>
          </Field>
          <Field label="重排服务地址" hint={preset.url ? `留空使用 ${preset.url}` : '自定义供应商须填写，接口须兼容 Jina/Cohere rerank'}>{text(['rerank', 'url'], preset.url)}</Field>
          <Field label="重排模型" hint={preset.model ? `留空使用 ${preset.model}` : undefined}>{text(['rerank', 'model'], preset.model)}</Field>
          <Field label="凭据引用名" hint={preset.apiKey ? `留空使用 ${preset.apiKey}` : '服务需要 Key 时填写'}>{text(['rerank', 'apiKey'], preset.apiKey)}</Field>
        </div>
        {draftRerank.apiKey && !rerankKey && status.status === 'ready'
          ? <p className="dms-warn">凭据引用名 {draftRerank.apiKey} 是新填写的，先点页面底部的“保存”，再在这里填写密钥。</p>
          : keyEditor(rerankKey, true)}
        {draftRerank.apiKey !== savedRerank.apiKey || (get(['rerank', 'provider']) ?? 'jina') !== (getIn(accepted, ['rerank', 'provider']) ?? 'jina')
          ? <p className="dms-warn">供应商或凭据已改动但还没保存：密钥可以先存，记得点页面底部的“保存”让重排改用新供应商。</p> : null}
        {probeLine('rerank', '测试重排服务')}
      </fieldset>
      <fieldset>
        <legend>决策模型（如 Jev、gpt-6-luna）</legend>
        <p className="dms-hint">用于选源、相关性判断和是否补搜；关闭、超时或输出无效时回退到规则。</p>
        {toggle(['decision', 'enabled'], '启用决策模型')}
        <div className="dms-grid">
          <Field label="后端">{select(['decision', 'backend'], [
            ['dsh', 'DSH 已配置的供应商（大模型输出 JSON）'],
            ['openai', '单独配置：OpenAI 兼容 Chat Completions（大模型输出 JSON）'],
            ['decisions', '单独配置：决策接口（Decisions / System One）'],
          ])}</Field>
        </div>
        <div className="dms-wire" data-decision-wire={backend}>
          <p><strong>接口：</strong><code>{wire}</code></p>
          {backend === 'dsh' ? <p className="dms-hint">经 DSH 的 llm.stream 调用，实际协议由该供应商在 DSH 中的路由决定（如 openai 路由走 POST /v1/responses，Google 走 generateContent）。<strong>本质是让通用大模型按提示输出 JSON</strong>，插件再解析；DSH 目前不提供决策接口，所以 gpt-6-luna 等决策模型在这里也会被当成聊天模型调用。</p> : null}
          {backend === 'openai' ? <p className="dms-hint">非流式、temperature 0。<strong>本质是让通用大模型按提示输出 JSON</strong>，插件再解析；输出不是合法 JSON 时回退到规则。</p> : null}
          {backend === 'decisions' ? <p className="dms-hint">把状态和带类型的问题发给决策模型，直接返回概率与分数，<strong>不生成文字、不解析 JSON 文本</strong>。OpenAI 格式发送 input + questions 数组；System One 格式发送 state + questions 对象（Jev/TypeSafe 官方、OpenRouter、Vercel AI Gateway 使用）。补搜判断只决定是否继续、选哪些源，不会提出新的搜索词。</p> : null}
        </div>
        <div className="dms-grid">
          {backend === 'dsh' ? (
            <>
              <Field label="供应商" hint={models.status === 'failed' ? `模型列表读取失败：${models.error}` : models.status === 'loading' ? '正在读取模型列表…' : undefined}>
                {providerOptions.length ? (
                  <select value={provider} disabled={disabled} onChange={event => { set(['decision', 'provider'], event.target.value); set(['decision', 'model'], '') }}>
                    <option value="">（未选择）</option>
                    {providerOptions.map(p => <option key={p.provider} value={p.provider}>{p.name}</option>)}
                    {provider && !providerOptions.some(p => p.provider === provider) ? <option value={provider}>{provider}</option> : null}
                  </select>
                ) : text(['decision', 'provider'], '供应商 ID')}
              </Field>
              <Field label="模型">
                {modelList.length ? (
                  <select value={(get(['decision', 'model']) as string) ?? ''} disabled={disabled} onChange={event => set(['decision', 'model'], event.target.value)}>
                    <option value="">（未选择）</option>
                    {modelList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    {get(['decision', 'model']) && !modelList.some(m => m.id === get(['decision', 'model'])) ? <option value={get(['decision', 'model']) as string}>{get(['decision', 'model']) as string}</option> : null}
                  </select>
                ) : text(['decision', 'model'], '模型 ID')}
              </Field>
              <Field label="思考强度 ID（可选）">{text(['decision', 'reasoning'])}</Field>
            </>
          ) : backend === 'openai' ? (
            <>
              <Field label="接口地址" hint="填到 /v1 即可，如 https://api.siliconflow.cn/v1；也可填完整的 …/chat/completions">{text(['decision', 'baseURL'], 'https://api.example.com/v1')}</Field>
              <Field label="模型 ID">{text(['decision', 'model'], '如 Qwen/Qwen3-8B')}</Field>
              <Field label="凭据引用名" hint={`默认 ${DECISION_DEFAULT_KEY}`}>{text(['decision', 'apiKey'], DECISION_DEFAULT_KEY)}</Field>
              <Field label="reasoning_effort（可选）" hint="留空不发送；不支持该参数的接口请留空">{text(['decision', 'reasoning'])}</Field>
            </>
          ) : (
            <>
              <Field label="快速填入" hint="填入接口格式、地址和模型；凭据引用名不变">
                <select value="" disabled={disabled} data-decision-preset onChange={event => {
                  const preset = DECISION_ENDPOINTS[event.target.value as keyof typeof DECISION_ENDPOINTS]
                  if (!preset) return
                  set(['decision', 'protocol'], preset.protocol)
                  set(['decision', 'baseURL'], preset.baseURL)
                  set(['decision', 'model'], preset.model)
                }}>
                  <option value="">（选择一个预设）</option>
                  {Object.entries(DECISION_ENDPOINTS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
                </select>
              </Field>
              <Field label="接口格式">{select(['decision', 'protocol'], Object.entries(DECISION_PROTOCOLS).map(([id, p]) => [id, p.label] as [string, string]))}</Field>
              <Field label="接口地址" hint={`填到 /v1 时自动补 /${DECISION_PROTOCOLS[protocol].path}；也可填完整地址（有的服务用 …/decisions 提供 System One 格式）`}>{text(['decision', 'baseURL'], 'https://api.openai.com/v1')}</Field>
              <Field label="模型 ID">{text(['decision', 'model'], protocol === 'systemone' ? '如 typesafe/jev-1.14' : '如 gpt-6-luna')}</Field>
              <Field label="凭据引用名" hint={`默认 ${DECISION_DEFAULT_KEY}；以 Bearer 发送`}>{text(['decision', 'apiKey'], DECISION_DEFAULT_KEY)}</Field>
            </>
          )}
          <Field label="单次判断超时（毫秒）">{num(['decision', 'timeoutMs'])}</Field>
          <Field label="相关性低于此值降权（0–1）">{num(['decision', 'keepThreshold'], { step: '0.05' })}</Field>
          <Field label="单批判断候选数">{num(['decision', 'maxCandidates'])}</Field>
        </div>
        {backend !== 'dsh' ? (extraKey(decisionRef)
          ? keyEditor(extraKey(decisionRef), true)
          : status.status === 'ready' ? <p className="dms-warn">凭据引用名 {decisionRef} 是新填写的，先点页面底部的“保存”，再在这里填写密钥。</p> : null) : null}
        {backend !== 'dsh' && savedBackend !== backend ? <p className="dms-warn">后端切换还没保存：密钥可以先存，记得点页面底部的“保存”。</p> : null}
        <Field label="使用环节">
          <span className="dms-checks">{([['route', '选源'], ['rerank', '相关性重排'], ['followup', '补搜判断']] as const).map(([id, label]) => (
            <label key={id}><input type="checkbox" disabled={disabled} checked={stages.includes(id)} onChange={event => set(['decision', 'stages'], event.target.checked ? [...stages, id] : stages.filter(s => s !== id))} />{label}</label>
          ))}</span>
        </Field>
        {probeLine('decision', '测试决策模型')}
      </fieldset>
    </>
  )

  const skillAction = async (action: 'save' | 'restore') => {
    const client = props.remote()
    if (!client) return
    setSkillMessage(action === 'save' ? '正在保存…' : '正在恢复…')
    try {
      await (action === 'save' ? client.saveSkill(skillText ?? '') : client.restoreSkill())
      setSkillText(undefined)
      setSkillMessage(action === 'save' ? '已保存，立即生效' : '已恢复为插件生成的内容')
      reloadSkill()
    } catch (error) {
      setSkillMessage(`失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const SKILL_STATES: Record<SkillStatus['state'], [string, 'ok' | 'off' | 'bad']> = {
    synced: ['与设置同步：修改上面的预算后会自动更新', 'ok'],
    modified: ['已手动修改：插件不再覆盖，预算改动不会写入', 'off'],
    deleted: ['文件已删除（可在技能管理的回收站恢复，或点“恢复默认内容”）', 'bad'],
    foreign: ['该位置已有一个不是本插件写入的同名技能，插件没有覆盖它', 'bad'],
    builtin: ['内置模式：技能由插件在内存中注册，技能管理插件看不到', 'off'],
  }
  const skillFile = skill.status === 'ready' ? skill.value : undefined
  const skillEditor = (
    <fieldset>
      <legend>技能文件</legend>
      <Field label="提供方式" hint="文件模式下技能是一个普通的 SKILL.md，DSH 的本地技能加载器会加载它，技能管理插件可以列出、停用或移入回收站。">
        {select(['research', 'skillMode'], [['file', '文件（推荐）'], ['builtin', '插件内置']])}
      </Field>
      {skill.status === 'loading' ? <p className="dms-hint">正在读取技能文件…</p> : null}
      {skill.status === 'failed' ? <p className="dms-err">技能文件读取失败：{skill.error} <button type="button" onClick={reloadSkill}>重试</button></p> : null}
      {skillFile ? (
        <>
          <p><Badge state={SKILL_STATES[skillFile.state][1]}>{SKILL_STATES[skillFile.state][0]}</Badge> <code className="dms-hint">{skillFile.path}</code></p>
          {skillFile.error ? <p className="dms-err">{skillFile.error}</p> : null}
          {skillFile.mode === 'file' && skillFile.state !== 'foreign' ? (
            <>
              <Field label="SKILL.md（含 frontmatter）" hint="name 须为小写字母、数字和连字符；description 必填。保存后直接写入文件，不需要点页面底部的保存。">
                <textarea data-skill-editor rows={22} spellCheck={false} value={skillText ?? skillFile.content ?? skillFile.generated}
                  onChange={event => setSkillText(event.target.value)} />
              </Field>
              <div className="dms-key">
                <button type="button" data-skill-action="save" disabled={skillText === undefined || skillText === (skillFile.content ?? '')} onClick={() => skillAction('save')}>保存技能文件</button>
                <button type="button" data-skill-action="restore" onClick={() => { if (skillFile.state === 'synced' || confirm('用插件生成的内容覆盖当前技能文件？')) void skillAction('restore') }}>恢复默认内容</button>
                {skillText !== undefined ? <button type="button" onClick={() => setSkillText(undefined)}>放弃修改</button> : null}
                {skillMessage ? <small className={skillMessage.startsWith('失败') ? 'dms-err' : 'dms-ok'} role="status">{skillMessage}</small> : null}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </fieldset>
  )

  const research = (
    <>
    <fieldset>
      <legend>深度研究</legend>
      <p className="dms-hint">这些上限会写进 deep-research 技能，调用模型据此分工和控制预算。技能文件被手动修改后，这里的改动不再写入文件。</p>
      <div className="dms-grid">
        <Field label="子智能体最大数量">{num(['research', 'maxSubagents'])}</Field>
        <Field label="研究轮数上限">{num(['research', 'maxRounds'])}</Field>
        <Field label="总读页数上限">{num(['research', 'maxPages'])}</Field>
        <Field label="总时长（分钟）">{num(['research', 'timeMinutes'])}</Field>
        <Field label="search/fetch 总调用次数上限">{num(['research', 'maxCalls'])}</Field>
      </div>
      {toggle(['research', 'modelInvocable'], '允许模型在用户明确要求深度研究时自行加载技能')}
      <button type="button" disabled={disabled} onClick={() => resetSection('research', '深度研究')}>恢复默认</button>
    </fieldset>
    {skillEditor}
    </>
  )

  const pages: Record<Tab, ReactNode> = { overview, general, sources: sourceCards, routing, ranking, research }
  const unchanged = !dirty || deepEqual(draft, accepted) && Object.keys(texts).every(key => !key.endsWith('#json'))
  return (
    <div className="dms-settings">
      {!snapshot.writable ? <p className="dms-warn">当前设置文件只读，无法保存。</p> : null}
      <div className="dms-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {pages[tab]}
      <div className="dms-actions">
        <button type="button" data-action="save" disabled={disabled || unchanged} onClick={() => void save()}>{saving === 'saving' ? '正在保存…' : '保存'}</button>
        <button type="button" disabled={disabled || !dirty} onClick={discard}>放弃修改</button>
        {saving === 'saved' ? <span className="dms-ok" role="status">已保存，立即生效</span> : null}
        {saving === 'failed' ? <span className="dms-err" role="alert">保存失败，请检查标红的字段</span> : null}
        {dirty && saving === 'idle' ? <span className="dms-hint">有未保存的修改</span> : null}
      </div>
    </div>
  )
}
