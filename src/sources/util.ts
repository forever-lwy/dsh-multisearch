import type { SearchNeed, SourceHit, TimeRange } from '../types.js'
import { SourceError } from '../http.js'
import { normalizeDate } from '../text.js'

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : undefined

export const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined

export const arr = (value: unknown): any[] => Array.isArray(value) ? value : []

export const clip = (text: string | undefined, max: number): string | undefined => {
  if (text === undefined) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const DAYS: Record<TimeRange, number> = { day: 1, week: 7, month: 31, year: 366 }

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

/** Lower bound date implied by `after` or `time_range`. */
export function afterDate(need: SearchNeed): string | undefined {
  if (need.after) return need.after
  if (!need.timeRange) return undefined
  return isoDate(new Date(Date.now() - DAYS[need.timeRange] * 86_400_000))
}

export function rangeDays(need: SearchNeed): number | undefined {
  if (need.timeRange) return DAYS[need.timeRange]
  if (need.after) return Math.max(1, Math.ceil((Date.now() - Date.parse(need.after)) / 86_400_000))
  return undefined
}

/** Add `site:` operators for engines without a structured domain filter. */
export function withSiteOperators(query: string, need: SearchNeed): string {
  const include = need.sites.slice(0, 4)
  const parts = [query]
  if (include.length === 1) parts.push(`site:${include[0]}`)
  else if (include.length > 1) parts.push(`(${include.map(site => `site:${site}`).join(' OR ')})`)
  for (const site of need.excludeSites.slice(0, 4)) parts.push(`-site:${site}`)
  return parts.join(' ')
}

export const isCjk = (text: string): boolean => /[㐀-鿿豈-﫿]/.test(text)

export function requireKey(key: string | undefined, label: string): string {
  if (!key) throw new SourceError(`${label} 未配置 API Key`, 'no_credential')
  return key
}

export function hit(url: unknown, fields: Omit<SourceHit, 'url'>): SourceHit | undefined {
  const target = str(url)
  if (!target || !/^https?:\/\//i.test(target)) return undefined
  return { url: target, ...fields, publishedAt: normalizeDate(fields.publishedAt) }
}

export const hits = (items: (SourceHit | undefined)[]): SourceHit[] => items.filter((item): item is SourceHit => item !== undefined)

export const unixToIso = (seconds: unknown): string | undefined => {
  const value = num(seconds)
  return value === undefined ? undefined : new Date(value * 1000).toISOString()
}

export function joinUrl(base: string | undefined, fallback: string, path: string): string {
  return `${(base || fallback).replace(/\/+$/, '')}${path}`
}
