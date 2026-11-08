import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Plugin from '../lib/index.js'
import { SECTIONS } from '../lib/config.js'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package declares an ungated bundle with a browser build that needs only client-provided modules', async () => {
  assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(packageJson.engines.dsh, '*')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /^window\.__ModuleLoader__\.load\(\{id:"@forever-lwy\/dsh-multisearch"/)
  assert.deepEqual([...new Set(client.match(/require\("[^"]+"\)/g))].sort(), ['require("react")', 'require("react/jsx-runtime")', 'require("zod")'])
})

test('one root row; its id is the settings namespace the page edits', async () => {
  const rows = composeEntries([loadOverlayPatches('multisearch-test', new URL('../cordis.patch.yml', import.meta.url).pathname)])
  assert.deepEqual(rows.map(row => [row.id, row.name]), [['multisearch', '@forever-lwy/dsh-multisearch']])
})

test('every top-level setting is volatile, so the settings form shows it and edits apply without a remount', () => {
  const fields = Object.entries(Plugin.Config.dict)
  assert.deepEqual(fields.map(([key]) => key).sort(), [...SECTIONS].sort())
  for (const [key, node] of fields) assert.equal(node.meta.volatile, true, key)
})

test('every Remote method declares the parameter names the browser sends', async () => {
  const { remoteInfo } = await import('../lib/remote.js')
  const sourceParameters = fn => {
    const source = Function.prototype.toString.call(fn)
    return source.slice(source.indexOf('(') + 1, source.indexOf(')')).split(',').map(part => part.trim()).filter(Boolean)
  }
  const methods = Object.entries(remoteInfo.methods)
  assert.equal(methods.length, 7)
  for (const [key, method] of methods) {
    const implementation = Plugin.MultisearchService.prototype[key.split('/')[1]]
    assert.equal(typeof implementation, 'function', key)
    assert.deepEqual(sourceParameters(implementation), [...method.parameters.map(p => p.wire), method.cancellation.parameter], key)
  }
})
