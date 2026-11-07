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

安装后在插件设置页配置。默认只启用无需 Key 的来源（Keenable 公开端点、Jina Reader、Hacker News、Hugging Face、Context7、Arctic Shift、DSH 内置网页服务、直接请求），其余来源填好凭据后打开“启用”。

要让模型只用本插件，请在 Agent 预设中停用内置 `@deepseek-ai/dsh-tool-web`（两者工具名不同，可以并存）。

## 凭据

每个来源的 “API Key 凭据引用” 是凭据名（如 `EXA_API_KEY`），密钥存放在 DSH 凭据存储或进程环境变量里，不写进设置文件。

特殊格式：

| 来源 | 说明 |
| --- | --- |
| 元宝搜索（腾讯云联网搜索） | 凭据值写成 `SecretId:SecretKey`；`options.edition` 为 `lite` 时不发送 Mode/Cnt/Industry |
| Bright Data | 需要在 `options` 里填 `serpZone`（搜索）和/或 `unlockerZone`（抓取） |
| Crawl4AI | 需要填写自建服务地址 `baseURL`；令牌可选 |
| Gemini / OpenAI | `options.model` 指定模型；Gemini 默认沿用 `GOOGLE_API_KEY` |

## 来源

| ID | 服务 | 搜索 | 抓取 | 站点发现 | 主要类型 | 接入状态 |
| --- | --- | --- | --- | --- | --- | --- |
| keenable | Keenable | ✓ | ✓ |  | web, news, documentation | 在线实测（无 Key 公开端点） |
| anysearch | AnySearch | ✓ | ✓ |  | 通用、学术、财经、代码、社媒、中文 | 按官方文档 |
| exa | Exa | ✓ | ✓ |  | 文档、代码、论文、企业 | 按官方文档 |
| tavily | Tavily | ✓ | ✓ | ✓ | web, news, finance | 按官方文档 |
| parallel | Parallel | ✓ | ✓ |  | 复杂比较、背景调查 | 搜索按官方文档；抓取未实测 |
| nimble | Nimble | ✓ | ✓ |  | web, news, company | 按官方文档 |
| brave | Brave Search API | ✓ |  |  | web, news | 按官方文档 |
| you | You.com | ✓ |  |  | web, news | 按官方文档 |
| linkup | Linkup | ✓ |  |  | 事实核查、企业 | 按官方文档 |
| yuanbao | 元宝搜索 | ✓ |  |  | 中文、新闻、政府、学术、财经 | 按官方文档（TC3 签名） |
| gemini | Gemini + Google Search | ✓（生成） |  |  | answer | 按官方文档 |
| openai | OpenAI + Web Search | ✓（生成） |  |  | answer | 按官方文档 |
| brightdata | Bright Data | ✓ | ✓ |  | Google SERP、受限站点 | 按官方文档 |
| firecrawl | Firecrawl | ✓ | ✓ | ✓ | 文档站、PDF | 按官方文档（v2） |
| contextdev | Context.dev | ✓ | ✓ |  | 企业、品牌、新闻 | 按官方文档 |
| jina | Jina Reader | ✓（需 Key） | ✓ |  | 正文读取、PDF | 抓取在线实测 |
| scrapingant | ScrapingAnt |  | ✓ |  | 动态网页 | 未实测 |
| crawl4ai | Crawl4AI（自建） |  | ✓ |  | 自建抓取 | 按官方文档 |
| weir | Weir | ✓ | ✓ |  | X、Reddit | 搜索按官方文档；帖子读取未实测 |
| arcticshift | Arctic Shift |  ✓ |  |  | Reddit 归档 | 在线实测；须在 sites 指定 `reddit.com/r/<社区>` |
| hackernews | Hacker News (Algolia) | ✓ | ✓ |  | 技术社区 | 在线实测 |
| consensus | Consensus | ✓ |  |  | 学术证据 | 官方文档不可读，按第三方资料，未实测 |
| huggingface | Hugging Face | ✓ |  |  | 模型、数据集、论文 | 在线实测 |
| context7 | Context7 | ✓ |  |  | 编程库文档 | 在线实测 |
| builtin | DSH 内置网页服务 | ✓ | ✓ |  | web | 依赖部署配置 |
| http | 直接请求 |  | ✓ |  | web | 在线实测；默认拒绝本机与内网地址 |

“按官方文档”表示请求和解析按服务文档实现并有模拟测试，但没有用真实 Key 调用过；首次使用请留意结果中的“执行情况”。

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
