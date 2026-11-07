import { bindRemote, remoteInfo, SERVICE } from '../remote.js';
import { MultisearchSettings } from './Settings.js';
import { styles } from './styles.js';
export const name = 'dsh-multisearch-client';
export const inject = ['slots', 'locale', 'configForms', 'remote'];
/** npm package name: the key of this bundle's page on the Plugins page. */
export const PACKAGE = '@forever-lwy/dsh-multisearch';
/** Host row id from cordis.patch.yml, also its settings namespace. */
export const ENTRY = 'multisearch';
const NAMESPACE = 'dshMultisearch';
export async function apply(ctx) {
    const c = ctx;
    try {
        const unmount = await c.remote.$mount(remoteInfo);
        ctx.effect(() => unmount, 'multisearch: remote schema');
    }
    catch (error) {
        console.warn('[dsh-multisearch] settings service unavailable', error);
    }
    let remote;
    ctx.inject([`remote.${SERVICE}`], (scoped) => {
        remote = bindRemote(scoped.remote);
        scoped.effect(() => () => { remote = undefined; }, 'multisearch: remote binding');
    });
    const getRemote = () => remote;
    ctx.effect(() => c.locale.register(NAMESPACE, 'zh', { nav: '多源搜索' }), 'multisearch: Chinese');
    ctx.effect(() => c.locale.register(NAMESPACE, 'en', { nav: 'Multi-source search' }), 'multisearch: English');
    ctx.effect(() => {
        const node = document.createElement('style');
        node.dataset.plugin = PACKAGE;
        node.textContent = styles;
        document.head.appendChild(node);
        return () => node.remove();
    }, 'multisearch: styles');
    const t = c.locale.bind(NAMESPACE);
    const form = c.configForms.get(ENTRY);
    const face = () => ({ form, remote: getRemote });
    ctx.effect(() => c.configForms.whileServed([ENTRY], () => {
        const disposers = [
            c.slots.inject('settings.section', () => c.slots.register({
                name: 'settings.section', id: 'dsh-multisearch', order: 60, label: () => t('nav'), inject: face,
            }, MultisearchSettings)),
            c.slots.inject('plugins.bundle.config', () => c.slots.register({
                name: 'plugins.bundle.config', key: PACKAGE, inject: face,
            }, MultisearchSettings)),
        ];
        return () => { for (const dispose of disposers.reverse())
            dispose(); };
    }), 'multisearch: settings page');
}
export { MultisearchSettings };
