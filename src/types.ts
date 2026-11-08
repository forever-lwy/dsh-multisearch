/** Shared vocabulary for sources, searches, fetches and results. */

/** Resource kinds a caller may ask for and a source may be good at. */
export const RESOURCE_TYPES = [
  'web', 'news', 'documentation', 'code', 'academic', 'social', 'community',
  'finance', 'government', 'ai-models', 'company', 'chinese', 'answer',
] as const
export type ResourceType = typeof RESOURCE_TYPES[number]

export const PROFILES = ['fast', 'balanced', 'deep'] as const
export type ProfileName = typeof PROFILES[number]

export const TIME_RANGES = ['day', 'week', 'month', 'year'] as const
export type TimeRange = typeof TIME_RANGES[number]

/** Structured search need, normalized from tool arguments. */
export interface SearchNeed {
  queries: string[]
  altQueries: string[]
  goal?: string
  types: ResourceType[]
  preferOfficial: boolean
  sites: string[]
  excludeSites: string[]
  timeRange?: TimeRange
  after?: string
  before?: string
  language?: string
  region?: string
  version?: string
}

/** One request sent to one source. */
export interface SourceQuery {
  query: string
  need: SearchNeed
  maxResults: number
  signal: AbortSignal
  timeoutMs: number
}

/** What a source returns: ranked hits and optional generated text. */
export interface SourceHit {
  url: string
  title?: string
  snippet?: string
  /** Longer cleaned text, when the service returns page content with the hit. */
  content?: string
  publishedAt?: string
  /** Extra short facts (score, author, subreddit …), kept compact. */
  meta?: Record<string, string | number | boolean>
}

export interface SourceSearchResult {
  hits: SourceHit[]
  /** Service-generated answer or summary (not original evidence). */
  generated?: string
}

export interface FetchRequest {
  url: string
  signal: AbortSignal
  timeoutMs: number
  maxChars: number
  /** Ask services that support it for a live rather than cached copy. */
  live: boolean
  /** Optional extraction focus forwarded to services that accept one. */
  focus?: string
}

export interface FetchedPage {
  url: string
  finalUrl?: string
  title?: string
  content: string
  /** True when the service itself reported or applied truncation. */
  truncated?: boolean
  statusCode?: number
  publishedAt?: string
  /** Content type when known, e.g. text/html, application/pdf. */
  contentType?: string
}

export interface CrawlRequest {
  url: string
  maxDepth: number
  maxPages: number
  includePaths: string[]
  excludePaths: string[]
  sameDomain: boolean
  signal: AbortSignal
  timeoutMs: number
}

export interface MappedLink { url: string; title?: string }

/** Capability flags of one source. */
export interface SourceCapabilities {
  search?: boolean
  fetch?: boolean
  map?: boolean
  /** Produces generated answers rather than (only) original results. */
  answer?: boolean
  /** Can render JavaScript or bypass simple blocks when fetching. */
  render?: boolean
  pdf?: boolean
}

export interface SourceFilters {
  site?: boolean
  time?: boolean
  language?: boolean
  region?: boolean
}

/** Static description of a source; adapters supply behavior. */
export interface SourceSpec {
  id: string
  label: string
  caps: SourceCapabilities
  types: ResourceType[]
  filters: SourceFilters
  /** Shared underlying engine; sources in one group overlap heavily. */
  engine: string
  /** Built-in priority 0–100, overridable per source in settings. */
  priority: number
  /** Default credential reference; undefined = no key needed. */
  credential?: string
  /** True when a missing key still works (anonymous tier). */
  keyOptional?: boolean
  /** Enabled by default (free and keyless sources only). */
  defaultEnabled?: boolean
  /** Hosts this source is the natural reader for (fetch routing). */
  hosts?: string[]
  /** The reader only understands these hosts (others are skipped, never attempted). */
  fetchHosts?: string[]
  /** Short model-facing description of strengths. */
  blurb: string
  /** A precondition on the need; routing skips the source unless it holds (explicit calls still try). */
  needs?: 'subreddit'
  /** Extra per-source settings with defaults (model id, zone …). */
  options?: Record<string, string | number | boolean>
}

/** Runtime context an adapter receives. */
export interface AdapterEnv {
  apiKey?: string
  baseURL?: string
  options: Record<string, string | number | boolean>
  http: HttpClient
}

export interface HttpClient {
  json(url: string, init: HttpInit): Promise<any>
  text(url: string, init: HttpInit): Promise<{ status: number; text: string; url: string; contentType: string; headers?: Record<string, string> }>
}

export interface HttpInit {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  signal: AbortSignal
  timeoutMs: number
  maxBytes?: number
}

/** Settings an adapter's gate sees. */
export interface GateInput {
  hasKey: boolean
  baseURL: string
  options: Record<string, string | number | boolean>
}

export interface SourceAdapter {
  spec: SourceSpec
  /** Per-capability readiness beyond the generic key check; return a reason when unavailable. */
  gate?(input: GateInput): { search?: string; fetch?: string }
  search?(q: SourceQuery, env: AdapterEnv): Promise<SourceSearchResult>
  fetch?(r: FetchRequest, env: AdapterEnv): Promise<FetchedPage>
  map?(r: CrawlRequest, env: AdapterEnv): Promise<MappedLink[]>
}

export type ContentKind = 'snippet' | 'page' | 'generated'
export type ReadStatus = 'unread' | 'fetched' | 'partial' | 'failed'

/** One merged candidate across sources and queries. */
export interface Candidate {
  key: string
  url: string
  title: string
  snippet: string
  content?: string
  publishedAt?: string
  version?: string
  /** source id → best rank (0-based) */
  ranks: Map<string, number[]>
  queries: Set<string>
  alsoAt: string[]
  meta: Record<string, string | number | boolean>
  score: number
  relevance?: number
  flags: Set<string>
}

export type SourceRunStatus = 'ok' | 'empty' | 'error' | 'timeout' | 'skipped' | 'cancelled'

export interface SourceRun {
  source: string
  query: string
  status: SourceRunStatus
  hits: number
  ms: number
  error?: string
  round: number
}

export type StopReason = 'completed' | 'partial' | 'timeout' | 'budget' | 'cancelled'
