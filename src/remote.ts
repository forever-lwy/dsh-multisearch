/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

export const SERVICE = 'multisearch'

const empty = z.object({}).strict()
const readiness = z.object({ ok: z.boolean(), reason: z.string().optional() })

export const statusSchema = z.object({
  sources: z.array(z.object({
    id: z.string(),
    label: z.string(),
    blurb: z.string(),
    search: z.boolean(),
    fetch: z.boolean(),
    map: z.boolean(),
    defaultTypes: z.array(z.string()),
    defaultPriority: z.number(),
    defaultOptions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    defaultEnabled: z.boolean(),
    /** Credential reference the source currently uses, when it takes one. */
    credential: z.object({ ref: z.string(), optional: z.boolean(), configured: z.boolean(), writable: z.boolean() }).optional(),
    searchReady: readiness,
    fetchReady: readiness,
  })),
  /** Credentials used outside sources (the rerank service). */
  extraCredentials: z.array(z.object({ ref: z.string(), configured: z.boolean(), writable: z.boolean() })),
  resourceTypes: z.array(z.string()),
  presets: z.record(z.string(), z.record(z.string(), z.union([z.number(), z.boolean()]))),
  defaultFetchOrder: z.array(z.string()),
})
export type MultisearchStatus = z.infer<typeof statusSchema>

export const credentialRequestSchema = z.object({ ref: z.string().min(1).max(200), value: z.string().max(8192).optional() }).strict()
export const credentialResultSchema = z.object({ configured: z.boolean() })

export const modelsSchema = z.object({
  providers: z.array(z.object({
    provider: z.string(),
    name: z.string(),
    models: z.array(z.object({ id: z.string(), name: z.string() })),
    error: z.string().optional(),
  })),
})
export type ProviderModels = z.infer<typeof modelsSchema>

const codec = (schema: z.ZodType, typeSymbol: string) => ({ mode: 'strict' as const, typeSymbol, create: () => schema })
const method = (input: z.ZodType, output: z.ZodType) => ({
  service: SERVICE, invocation: { kind: 'direct' as const },
  parameters: [{ name: 'request', source: 'json' as const, codec: codec(input, 'MultisearchRequest'), strictCodec: codec(input, 'MultisearchRequest') }],
  result: codec(output, 'MultisearchResult'), cancellation: { parameter: 'signal' as const },
})

export const remoteInfo = createTypertRemoteInfo({ package: '@forever-lwy/dsh-multisearch', methods: {
  'multisearch/status': method(empty, statusSchema),
  'multisearch/setCredential': method(credentialRequestSchema, credentialResultSchema),
  'multisearch/clearCredential': method(credentialRequestSchema, credentialResultSchema),
  'multisearch/models': method(empty, modelsSchema),
} }, z)

async function invoke<T>(remote: unknown, key: string, request: unknown, signal?: AbortSignal): Promise<T> {
  const result = await (remoteInfo.methods as any)[key].invoke(remote, { request }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Browser-side calls bound to one mounted remote. */
export interface MultisearchRemote {
  status(signal?: AbortSignal): Promise<MultisearchStatus>
  setCredential(ref: string, value: string, signal?: AbortSignal): Promise<{ configured: boolean }>
  clearCredential(ref: string, signal?: AbortSignal): Promise<{ configured: boolean }>
  models(signal?: AbortSignal): Promise<ProviderModels>
}

export function bindRemote(remote: unknown): MultisearchRemote {
  return {
    status: signal => invoke(remote, 'multisearch/status', {}, signal),
    setCredential: (ref, value, signal) => invoke(remote, 'multisearch/setCredential', { ref, value }, signal),
    clearCredential: (ref, signal) => invoke(remote, 'multisearch/clearCredential', { ref }, signal),
    models: signal => invoke(remote, 'multisearch/models', {}, signal),
  }
}
