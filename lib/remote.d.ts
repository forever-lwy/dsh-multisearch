/** Typert Remote contract shared by the Host service and the browser settings page. */
import { z } from 'zod';
export declare const SERVICE = "multisearch";
export declare const statusSchema: z.ZodObject<{
    sources: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        blurb: z.ZodString;
        search: z.ZodBoolean;
        fetch: z.ZodBoolean;
        map: z.ZodBoolean;
        defaultTypes: z.ZodArray<z.ZodString>;
        defaultPriority: z.ZodNumber;
        defaultOptions: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>;
        defaultEnabled: z.ZodBoolean;
        credential: z.ZodOptional<z.ZodObject<{
            ref: z.ZodString;
            optional: z.ZodBoolean;
            configured: z.ZodBoolean;
            writable: z.ZodBoolean;
        }, z.core.$strip>>;
        searchReady: z.ZodObject<{
            ok: z.ZodBoolean;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        fetchReady: z.ZodObject<{
            ok: z.ZodBoolean;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    extraCredentials: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        configured: z.ZodBoolean;
        writable: z.ZodBoolean;
    }, z.core.$strip>>;
    resourceTypes: z.ZodArray<z.ZodString>;
    presets: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodNumber, z.ZodBoolean]>>>;
    defaultFetchOrder: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type MultisearchStatus = z.infer<typeof statusSchema>;
export declare const credentialRequestSchema: z.ZodObject<{
    ref: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const credentialResultSchema: z.ZodObject<{
    configured: z.ZodBoolean;
}, z.core.$strip>;
export declare const modelsSchema: z.ZodObject<{
    providers: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        name: z.ZodString;
        models: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
        }, z.core.$strip>>;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProviderModels = z.infer<typeof modelsSchema>;
export declare const remoteInfo: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteInfo<Readonly<Record<string, import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "unary", never, unknown> | import("@deepseek-ai/dsh-typert-protocol").TypertRemoteMethod<object, unknown, "stream", unknown, unknown>>>>;
/** Browser-side calls bound to one mounted remote. */
export interface MultisearchRemote {
    status(signal?: AbortSignal): Promise<MultisearchStatus>;
    setCredential(ref: string, value: string, signal?: AbortSignal): Promise<{
        configured: boolean;
    }>;
    clearCredential(ref: string, signal?: AbortSignal): Promise<{
        configured: boolean;
    }>;
    models(signal?: AbortSignal): Promise<ProviderModels>;
}
export declare function bindRemote(remote: unknown): MultisearchRemote;
