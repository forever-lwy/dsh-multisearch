/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
export const SERVICE = 'multisearch';
const empty = z.object({}).strict();
const readiness = z.object({ ok: z.boolean(), reason: z.string().optional() });
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
});
export const credentialRequestSchema = z.object({ ref: z.string().min(1).max(200), value: z.string().max(8192).optional() }).strict();
export const credentialResultSchema = z.object({ configured: z.boolean() });
export const modelsSchema = z.object({
    providers: z.array(z.object({
        provider: z.string(),
        name: z.string(),
        models: z.array(z.object({ id: z.string(), name: z.string() })),
        error: z.string().optional(),
    })),
});
const codec = (schema, typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => schema });
const method = (input, output) => ({
    service: SERVICE, invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: codec(input, 'MultisearchRequest'), strictCodec: codec(input, 'MultisearchRequest') }],
    result: codec(output, 'MultisearchResult'), cancellation: { parameter: 'signal' },
});
export const remoteInfo = createTypertRemoteInfo({ package: '@forever-lwy/dsh-multisearch', methods: {
        'multisearch/status': method(empty, statusSchema),
        'multisearch/setCredential': method(credentialRequestSchema, credentialResultSchema),
        'multisearch/clearCredential': method(credentialRequestSchema, credentialResultSchema),
        'multisearch/models': method(empty, modelsSchema),
    } }, z);
async function invoke(remote, key, request, signal) {
    const result = await remoteInfo.methods[key].invoke(remote, { request }, signal);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value;
}
export function bindRemote(remote) {
    return {
        status: signal => invoke(remote, 'multisearch/status', {}, signal),
        setCredential: (ref, value, signal) => invoke(remote, 'multisearch/setCredential', { ref, value }, signal),
        clearCredential: (ref, signal) => invoke(remote, 'multisearch/clearCredential', { ref }, signal),
        models: signal => invoke(remote, 'multisearch/models', {}, signal),
    };
}
