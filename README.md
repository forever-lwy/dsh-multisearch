# dsh-multisearch

DeepSeek Harness 的多源搜索与网页抓取插件，提供 `search`、`fetch` 两个工具和一个 `deep-research`（深度研究）技能，用来替代内置的 `web_search` / `web_fetch`。

- **search**：按调用模型给出的结构化需求（资料类型、官方偏好、站点、时间、版本……）选出互补来源并行检索，统一字段、归一化 URL、合并重复页面与转载，RRF 融合排名后按约束重排，再按输出预算精简。每条结果有任务内稳定的引用 ID（S1、S2……）。
- **fetch**：按 URL 或引用 ID 读取正文，多个 URL 并行；同一 URL 按顺序回退抓取服务，识别登录墙、空内容、截断；支持关键词定位（保留标题、条件句、表头和代码前提）、按偏移继续读取、站内发现与小范围爬取。
- **deep-research 技能**：用户明确要求深度研究时加载，指导模型规划方向、按插件设置的上限分派子智能体、检索核实、检查缺口并汇总。

## 安装

在 dsh 的“插件 → 添加插件”输入：

```text
github:forever-lwy/dsh-multisearch
```

安装后打开 **设置 → 多源搜索**（插件页里本插件的详情页显示同一页面）：

- **概览**：每个来源当前能否搜索、能否抓取，不能用时写明原因（缺密钥、缺 zone、自建服务没有搜索等）。
- **搜索源与密钥**：启用来源、填写密钥（点“保存密钥”立即写入 DSH 凭据存储，不进设置文件）；高级设置里可改凭据引用名、优先级、接口地址、能力标签和来源专属参数。
- **常规与档位**：默认档位、工具名、逐项覆盖档位值（留空跟随档位）、硬性上限。
- **路由与抓取**、**重排与决策模型**、**深度研究**：对应下文各节。

页面其余改动点“保存”后立即生效，不需要重启（所有设置都是热更新字段，工具名、工具说明和深度研究技能会随之重建）。默认只启用无需 Key 的来源（Keenable 公开端点、Jina Reader、Hacker News、Hugging Face、Context7、Arctic Shift、DSH 内置网页服务、直接请求）。

要让模型只用本插件，请在 Agent 预设中停用内置 `@deepseek-ai/dsh-tool-web`（两者工具名不同，可以并存）。

## 凭据

每个来源的 “API Key 凭据引用” 是凭据名（如 `EXA_API_KEY`），密钥存放在 DSH 凭据存储或进程环境变量里，不写进设置文件。

特殊格式：

| 来源 | 说明 |
| --- | --- |
| 元宝搜索 | 凭据值可以是服务 API KEY（走 `api.wsa.cloud.tencent.com`，Bearer），也可以是 `SecretId:SecretKey`（走 `wsa.tencentcloudapi.com`，TC3 签名）；`options.edition` 为 `lite` 时不发送 Mode/Cnt/Industry |
| Crawl4AI | 默认 `options.mode: cloud`，使用官方云 `api.crawl4ai.com` 和 `CRAWL4AI_API_KEY`（`sk_live_…`）；改为 `self-hosted` 并填写 `baseURL` 即使用自建服务（自建版没有搜索） |
| SciVerse | `SCIVERSE_API_TOKEN`（`sv-…`） |
| Bright Data | 搜索需要 `options.serpZone`，抓取需要 `options.unlockerZone`，两者分别生效 |
| Consensus | `options` 可开 `fullTextChunks`（付费计划返回全文相关段落）、`excludePreprints`、`medicalMode`、`domain`（学科代码） |
| Linkup | `options.renderJs`（默认开）、`fetchMode`（`standard` / `pro`） |
| Gemini / OpenAI | `options.model` 指定模型；Gemini 默认沿用 `GOOGLE_API_KEY` |

## 来源与能力

每个来源的搜索和抓取能力独立判断是否可用：缺少凭据或必需设置时，结果的“执行情况”里会写明原因。

| ID | 服务 | 搜索 | 抓取 | 主要类型 | 接入状态 |
| --- | --- | --- | --- | --- | --- |
| keenable | Keenable | ✓ | ✓ | web, news, documentation | 在线实测（无 Key 公开端点） |
| anysearch | AnySearch | ✓ | ✓ | 通用、学术、财经、代码、社媒、中文 | Key 实测（2026-11-08） |
| exa | Exa | ✓ | ✓（/contents） | 文档、代码、论文、企业 | Key 实测（2026-11-08） |
| tavily | Tavily | ✓ | ✓（/extract，另有站点发现） | web, news, finance | Key 实测（2026-11-08） |
| parallel | Parallel | ✓ | ✓（/v1/extract） | 复杂比较、背景调查 | 按官方 OpenAPI（实测时账户余额不足，返回 402） |
| nimble | Nimble | ✓ | ✓（/v2/extract；`options.render` 开启浏览器渲染，默认关闭，实测开启要两分钟以上） | web, news, company | Key 实测（2026-11-08） |
| brave | Brave Search API | ✓ | — 官方无按 URL 读取接口 | web, news | 按官方文档 |
| you | You.com | ✓ | ✓（Contents API） | web, news | Key 实测（2026-11-08） |
| linkup | Linkup | ✓ | ✓（/v1/fetch，可渲染 JS） | 事实核查、企业 | Key 实测（2026-11-08） |
| yuanbao | 元宝搜索 | ✓ | — 官方只有 SearchPro 搜索接口 | 中文、新闻、政府、学术、财经 | Key 实测（2026-11-08）（服务 API KEY） |
| gemini | Gemini + Google Search | ✓（生成） | ✓（URL Context，生成的转述；实测约 60 秒，常超出单请求超时） | answer | Key 实测（2026-11-08） |
| openai | OpenAI + Web Search | ✓（生成） | ✓（模型打开网页后转述；实测约 60 秒，常超出单请求超时） | answer | Key 实测（2026-11-08） |
| brightdata | Bright Data | ✓（Google SERP，`data_format: parsed_light`；实测 10–70 秒） | ✓（Web Unlocker） | 受限站点 | 搜索Key 实测（2026-11-08）；抓取未实测 |
| firecrawl | Firecrawl | ✓ | ✓（另有站点发现） | 文档站、PDF | Key 实测（2026-11-08）（v2） |
| contextdev | Context.dev | ✓ | ✓ | 企业、品牌、新闻 | Key 实测（2026-11-08） |
| jina | Jina | ✓（需 Key） | ✓（Reader，无 Key 可用） | 正文读取、PDF | 读取在线实测 |
| scrapingant | ScrapingAnt | ✓（经代理抓取 DuckDuckGo 结果页） | ✓（/v2/markdown） | 动态网页 | Key 实测（2026-11-08） |
| crawl4ai | Crawl4AI 官方云 / 自建 | ✓（仅官方云） | ✓ | 浏览器抓取 | 官方云Key 实测（2026-11-08） |
| weir | Weir | ✓ | ✓（X/Reddit 帖子与评论） | X、Reddit | Key 实测（2026-11-08） |
| arcticshift | Arctic Shift | ✓（须在 sites 指定 `reddit.com/r/<社区>`；全文检索 422 超时时改按标题检索） | ✓（Reddit 帖子与评论树） | Reddit 归档 | 在线实测；公共服务负载高时会返回 422 |
| hackernews | Hacker News (Algolia) | ✓ | ✓（HN 帖子与评论） | 技术社区 | 在线实测 |
| consensus | Consensus | ✓ | — 官方无读取接口（付费计划可在搜索中附全文段落） | 学术证据 | Key 实测（2026-11-08） |
| sciverse | SciVerse | ✓（agentic-search） | ✓（按 doc_id 或 DOI 读全文） | 学术文献 | Key 实测（2026-11-08） |
| huggingface | Hugging Face | ✓ | ✓（模型/数据集卡片、论文摘要） | 模型、数据集、论文 | 在线实测 |
| context7 | Context7 | ✓ | ✓（按库读取文档） | 编程库文档 | 在线实测 |
| builtin | DSH 内置网页服务 | ✓ | ✓ | web | 依赖部署配置 |
| http | 直接请求 | — | ✓ | web | 在线实测；默认拒绝本机与内网地址 |

“按官方文档/OpenAPI”表示请求和解析按服务文档实现并有模拟测试，但没有用真实 Key 调用过；首次使用请留意结果中的“执行情况”。生成类来源和 Bright Data 响应较慢，单请求超时（`requestTimeoutMs`，deep 档 20 秒）内可能来不及返回。

只认识特定站点的读取器（Weir、Arctic Shift、Hacker News、Hugging Face、Context7、SciVerse）只用于对应站点的链接，并排在回退顺序最前；Gemini、OpenAI 的模型转述总是排在最后，结果标注“服务生成的转述（非原文）”。

## 工具参数

### search

| 参数 | 说明 |
| --- | --- |
| `queries` | 1 至上限条查询 |
| `goal` | 原始目标，用于选源和相关性判断 |
| `source_types` | `web` `news` `documentation` `code` `academic` `social` `community` `finance` `government` `ai-models` `company` `chinese` `answer` |
| `prefer_official` | 偏好官方、一手资料 |
| `sources` | 直接指定来源（只搜这些） |
| `sites` / `exclude_sites` | 限定或排除域名（可带路径前缀） |
| `time_range` / `after` / `before` | 时间约束 |
| `language` / `region` / `version` | 语言、地区、版本 |
| `alt_queries` | 自动补搜可用的备选查询 |
| `profile` | `fast` / `balanced` / `deep` |
| `max_results` / `auto_follow_up` / `options` | 单次覆盖，受硬性上限约束 |
| `more` | 查看某次搜索（如 `Q2`）剩余候选，不重新检索 |

返回：引用 ID、标题、URL、片段、命中渠道、日期/版本、内容类别（片段/已读正文）与读取状态、标记（官方、非指定站点、超出时间范围、版本不符……）；服务生成的概述单独标注为“非原文证据”；各来源的失败、超时原因；停止原因（正常完成、部分完成、超时）；补搜建议或已执行的补搜。

### fetch

| 参数 | 说明 |
| --- | --- |
| `urls` | URL 或引用 ID |
| `keywords` / `context_chars` | 只返回命中段落及其上下文 |
| `offset` / `max_chars` | 分段读取 |
| `live` | 跳过缓存 |
| `services` | 指定抓取服务顺序 |
| `focus` | 传给支持定向提取的服务 |
| `crawl` | `{mode: "map" | "crawl", max_pages, max_depth, include_paths, exclude_paths, same_domain}` |

## 选源与补搜

1. 指定 `sources` 时只用这些来源，补搜也不越界。
2. 否则按能力标签打分：请求类型、站点/措辞推断的线索、官方偏好、过滤能力、自定义规则和优先级；贪心选择互补组合，共用底层引擎（如 Bright Data 与 Gemini 都走 Google）的来源会扣分。
3. 启用决策模型并选择 `route` 环节时，加入模型给出的语义适配分。
4. 需求不明确时用 `routing.defaultSources`，不足时只用通用网页来源补齐；中文查询优先加入中文来源。

补搜触发条件：去重后结果不足、多个来源高度重复、缺少要求的资料类型、所有来源失败。默认只把建议（可尝试的来源和备选查询）返回给模型；`auto_follow_up` 或 deep 档位会在本次调用的来源范围、约束和时间预算内自动补搜：先复用本任务已有候选，再在未尝试的来源上用当前查询，最后才用调用方给的 `alt_queries`。

## 决策模型（如 Jev）

在“决策模型”中填写 DSH 模型设置里的供应商 ID 和模型 ID，选择使用环节（`route` 选源、`rerank` 相关性、`followup` 是否继续）。判断批量进行；关闭、超时或输出无效时回退到规则，模型未判断的项保持未知。也可以把“结果重排”设为 Jina/Cohere 兼容的专用重排服务。

## 配置优先级

单次调用参数 ＞ 设置中的逐项覆盖 ＞ 档位默认值，最后受“硬性上限”约束。

| 档位 | 并行来源 | 每源候选 | 返回条数 | 输出预算 | 单次时限 | 自动补搜 |
| --- | --- | --- | --- | --- | --- | --- |
| fast | 1 | 6 | 6 | ~2,000 tokens | 15 s | 否 |
| balanced | 2 | 8 | 8 | ~4,000 tokens | 30 s | 否（返回建议） |
| deep | 4 | 10 | 12 | ~8,000 tokens | 60 s | 是，最多 2 轮 |

## 任务内记忆

引用 ID、每次搜索的完整候选和已抓取正文按会话保存（子智能体与父会话共用），已抓取正文另有跨会话缓存（时效见 `cacheTtlMinutes`）。插件重载或 dsh 重启后清空。

## 开发

```sh
npm install
npm run build
npm run check
npm test
```

发版流程见部署仓库 README 的“自定义插件开发流程”：递增版本、提交，推 `v<版本>` 标签由 GitHub Actions 发布到 `release` 分支。
