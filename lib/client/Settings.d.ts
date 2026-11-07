import type { MultisearchRemote } from '../remote.js';
export interface FormLike {
    getSnapshot(): {
        status: 'loading' | 'ready' | 'unavailable';
        value: unknown;
        user: unknown;
        revision: number | undefined;
        writable: boolean;
    };
    subscribe(listener: () => void): () => void;
    mutate(ops: readonly unknown[], expectedRevision?: number): Promise<boolean>;
}
export interface SettingsProps {
    form: FormLike;
    remote: () => MultisearchRemote | undefined;
    view?: 'summary' | 'page';
}
export declare function MultisearchSettings(props: SettingsProps): import("react").JSX.Element;
