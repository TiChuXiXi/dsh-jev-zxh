/**
 * 浏览器半区的接线自测：不启浏览器，用假的 `window.__ModuleLoader__` / `require` /
 * ctx 把 client.js 跑起来，验证「注册进 plugins.item → 表单动作 → 密钥走凭据域」
 * 这条链路的每个接口名和参数形状都对。
 *
 * 它不能替代真机验证（真机的 SettingsFormModel 由 harness 提供），但能在发版前
 * 抓住拼错的字段名、漏掉的 ctx 服务、以及写错的凭据引用。
 *
 * 运行：node test/client.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

// ---------------------------------------------------------------- 断言
let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}
/**
 * 让已经排队的异步链跑完。
 *
 * `actions().save` 的真实签名是 `() => void`（form-model.d.ts），它内部的写入是
 * 异步的；所以断言前要放过一个宏任务，而不是 await 那个 void。
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ------------------------------------------------- 假平台：react + primitives
const h = (type, props, ...children) => ({
  type,
  props: { ...(props ?? {}), children: children.length === 0 ? undefined : children },
})
const SettingsForm = function SettingsForm() {}
const SettingsValueField = function SettingsValueField() {}
const SettingsSecretField = function SettingsSecretField() {}

/** 按 form-model.d.ts 的契约复刻一个最小 SettingsFormModel。 */
class SettingsFormModel {
  constructor(scope, specs, secrets = []) {
    this.scope = scope
    this.specs = specs
    this.secrets = secrets
    this.staged = new Map()
    this.saving = false
    this.failed = false
    this.unsubscribe = scope.subscribe(() => this.publish())
  }

  bind(project) {
    this.project = project
    this.store = {
      getSnapshot: () => project(),
      set: () => {},
      subscribe: () => () => {},
    }
    return this.store
  }

  shell() {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.staged.size > 0,
      invalid: false,
      saving: this.saving,
      failed: this.failed,
    }
  }

  field(name) {
    const snapshot = this.scope.getSnapshot()
    const staged = this.staged.get(name)
    if (staged !== undefined) return { text: staged === null ? '' : staged, overridden: true, invalid: false }
    const isSecret = this.secrets.some((spec) => spec.field === name)
    const spec = this.specs.find((candidate) => candidate.field === name)
    return { text: isSecret ? '' : spec.format(snapshot.value?.[name]), overridden: false, invalid: false }
  }

  actions() {
    return {
      edit: (field, text) => {
        this.staged.set(field, text)
        this.publish()
      },
      resetField: (field) => {
        this.staged.set(field, null)
        this.publish()
      },
      save: () => {
        this.save()
      },
      discard: () => {
        this.staged.clear()
        this.publish()
      },
    }
  }

  async save() {
    const ops = []
    const secretWrites = []
    for (const [field, text] of this.staged) {
      const spec = this.specs.find((candidate) => candidate.field === field)
      if (spec !== undefined) {
        ops.push(text === null ? { op: 'unset', path: [field] } : { op: 'set', path: [field], value: text })
        continue
      }
      const secret = this.secrets.find((candidate) => candidate.field === field)
      if (secret !== undefined && text !== null && text !== '') secretWrites.push([secret, text])
    }
    if (ops.length > 0) await this.scope.mutate(ops, this.scope.getSnapshot().revision)
    for (const [secret, text] of secretWrites) await secret.write(text)
    this.staged.clear()
    this.publish()
  }

  publish() {
    if (this.store !== undefined) this.store.set(this.project())
  }

  dispose() {
    this.unsubscribe()
  }
}

const settingsTextField = (field) => ({
  field,
  format: (value) => (typeof value === 'string' ? value : ''),
  parse: (text) => (text === '' ? { kind: 'clear' } : { kind: 'set', value: text }),
})

// ------------------------------------------------------------- 假模块加载器
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}
const require = (specifier) => {
  if (specifier === 'react') return { createElement: h }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    return { SettingsForm, SettingsValueField, SettingsSecretField, SettingsFormModel, settingsTextField }
  }
  throw new Error(`未预期的 require：${specifier}`)
}
// 执行浏览器半区源码：它自己会调 window.__ModuleLoader__.load。
new Function('window', 'require', source)(globalThis.window, require)

// ------------------------------------------------------------------ 假 ctx
function makeScope(value, options = {}) {
  const listeners = new Set()
  let revision = 1
  return {
    mutateCalls: [],
    getSnapshot: () => ({ status: 'ready', value, base: {}, user: {}, writable: options.writable ?? true, revision }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async mutate(ops, expectedRevision) {
      this.mutateCalls.push({ ops, expectedRevision })
      for (const op of ops) {
        if (op.op === 'set') value[op.path[0]] = op.value
        else delete value[op.path[0]]
      }
      revision += 1
      return true
    },
  }
}

function makeContext(scopes) {
  const state = { dictionaries: [], registrations: [], effects: [], credentialEvents: [], credentials: {} }
  const context = {
    state,
    effect: (fn, label) => {
      state.effects.push(label)
      return fn()
    },
    locale: {
      bind: () => (key) => state.dictionary[key],
      register: (namespace, bundles) => {
        state.dictionaries.push({ namespace, bundles })
        state.dictionary = bundles.zh
        return () => {}
      },
    },
    configForms: {
      get: (id) => scopes[id],
      whileServed: (namespaces, register) => register(new Set(namespaces)),
    },
    slots: {
      inject: (name, register) => register(),
      register: (options, component) => {
        state.registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      $on: (event, listener) => {
        state.credentialEvents.push({ event, listener })
        return () => {}
      },
      credentials: {
        describe: async (refs) => ({
          ok: true,
          value: Object.fromEntries(refs.map((ref) => [ref, { configured: state.credentials[ref] !== undefined, writable: true }])),
        }),
        set: async (ref, value) => {
          state.credentials[ref] = value
          return { ok: true }
        },
      },
    },
  }
  return context
}

// -------------------------------------------------------------------- 跑
console.log('模块加载器')
check('id 是包名', loaded?.id === 'dsh-jev-zxh', String(loaded?.id))
const client = loaded.factory(require)
check('导出 apply / inject / NS', typeof client.apply === 'function' && Array.isArray(client.inject) && client.NS === 'settings.dshJev')
check('inject 覆盖 slots/locale/remote/credentials/configForms', JSON.stringify(client.inject) === JSON.stringify(['slots', 'locale', 'remote', 'remote.credentials', 'configForms']), JSON.stringify(client.inject))

console.log('挂载与注册')
const scope = makeScope({ apiKeyEnv: 'OPENROUTER_API_KEY', endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' })
const ctx = makeContext({ 'dsh-jev': scope })
client.apply(ctx)
check('注册了字典', ctx.state.dictionaries.length === 1 && ctx.state.dictionaries[0].namespace === 'settings.dshJev')
check('注册进 plugins.bundle.config', ctx.state.registrations.length === 1 && ctx.state.registrations[0].options.name === 'plugins.bundle.config')
const registration = ctx.state.registrations[0]
check('key 是包名', registration.options.key === 'dsh-jev-zxh', JSON.stringify(registration.options))
check('带 locale 命名空间', registration.options.locale === 'settings.dshJev')
check('监视了凭据引用变化', ctx.state.credentialEvents.length === 1 && ctx.state.credentialEvents[0].event === 'credentials/reference-updated')

const face = registration.options.inject()
check('inject 面含 hooks.jevCard', face.hooks !== undefined && typeof face.hooks.jevCard.getSnapshot === 'function')
check('inject 面含四个动作', ['edit', 'resetField', 'save', 'discard'].every((key) => typeof face[key] === 'function'))
const snapshot = face.hooks.jevCard.getSnapshot()
check('快照字段齐全', ['available', 'writable', 'dirty', 'saving', 'failed', 'endpoint', 'model', 'apiKey', 'apiKeyConfigured', 'apiKeyWritable'].every((key) => key in snapshot), Object.keys(snapshot).join(','))
check('初始未配置密钥', snapshot.apiKeyConfigured === false)

console.log('组件渲染')
const props = { t: (key) => ctx.state.dictionary[key], useJevCard: (select) => select(face.hooks.jevCard.getSnapshot()), view: 'form', ...face }
const summary = registration.component({ ...props, view: 'summary' })
check('summary 视图返回一行说明', typeof summary === 'string' && summary.includes('jev_decide'), String(summary))
const tree = registration.component(props)
check('form 视图渲染 SettingsForm', tree.type === SettingsForm)
check('三个控件：密钥 / 端点 / 模型', tree.props.children.length === 3 && tree.props.children[0].type === SettingsSecretField && tree.props.children[1].type === SettingsValueField && tree.props.children[2].type === SettingsValueField)
check('密钥控件显示未配置文案', tree.props.children[0].props.stateLabel === ctx.state.dictionary.apiKeyUnset)
check('端点控件带当前值', tree.props.children[1].props.text === 'https://openrouter.ai/api/alpha/decisions', tree.props.children[1].props.text)

console.log('保存：设置文档 + 凭据域')
face.edit('endpoint', 'https://api.typesafe.ai/v1/systemone')
face.edit('model', '~typesafe/jev-latest')
face.edit('apiKey', 'fake-key-value')
face.save()
await settle()
check('一次保存写一条 mutate（两个字段）', scope.mutateCalls.length === 1 && scope.mutateCalls[0].ops.length === 2, JSON.stringify(scope.mutateCalls))
check('mutate 带 revision 栅栏', scope.mutateCalls[0].expectedRevision === 1, String(scope.mutateCalls[0].expectedRevision))
check('端点写进设置文档', scope.getSnapshot().value.endpoint === 'https://api.typesafe.ai/v1/systemone')
check('模型写进设置文档', scope.getSnapshot().value.model === '~typesafe/jev-latest')
check('密钥写进凭据库、不进设置文档', ctx.state.credentials.OPENROUTER_API_KEY === 'fake-key-value' && scope.getSnapshot().value.apiKey === undefined)
check('保存后报告已配置', face.hooks.jevCard.getSnapshot().apiKeyConfigured === true)

console.log('凭据引用跟随 apiKeyEnv')
const scope2 = makeScope({ apiKeyEnv: 'MY_OWN_KEY', endpoint: '', model: '' })
const ctx2 = makeContext({ 'dsh-jev': scope2 })
client.apply(ctx2)
const face2 = ctx2.state.registrations[0].options.inject()
face2.edit('apiKey', 'sk-other')
face2.save()
await settle()
check('引用名取自 apiKeyEnv', ctx2.state.credentials.MY_OWN_KEY === 'sk-other', JSON.stringify(ctx2.state.credentials))
const scope3 = makeScope({})
const ctx3 = makeContext({ 'dsh-jev': scope3 })
client.apply(ctx3)
const face3 = ctx3.state.registrations[0].options.inject()
face3.edit('apiKey', 'sk-default')
face3.save()
await settle()
check('apiKeyEnv 缺失时回落到 OPENROUTER_API_KEY', ctx3.state.credentials.OPENROUTER_API_KEY === 'sk-default', JSON.stringify(ctx3.state.credentials))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
