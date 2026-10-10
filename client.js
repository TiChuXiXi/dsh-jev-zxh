/**
 * dsh-jev-zxh —— 浏览器半区：在「插件」页给 dsh-jev 条目挂一张配置卡。
 *
 * 为什么必须有这个文件：DSH 的插件页配置区是 **slot 驱动**的，没有任何随发行版
 * 下发的客户端会按 Config schema 自动生成表单（`dsh-settings` 文档原话：
 * `autoGenerate` 默认为真，但 "no shipped client does so yet"）。所以哪怕宿主侧
 * Config 已经把字段标成 volatile，页面上也不会自己长出表单 —— 只能由插件自己的
 * 浏览器半区注册进 `plugins.item`。
 *
 * 形态与官方 `dsh-client-ui-settings-web-search` 完全一致：
 *   · 端点 / 模型走 `ctx.configForms`（作用域 = profile 条目 id `dsh-jev`），
 *     只在点「保存」时才写设置文档；
 *   · API key 是唯一的密文控件：字面值从不进设置文档，写入
 *     `remote.credentials.set`，引用名取自本节 `apiKeyEnv`（缺省
 *     `OPENROUTER_API_KEY`）——「设置 → 模型」页给 openrouter 写的也正是这个引用；
 *   · Host 服务该命名空间时才注册卡片，停止服务即撤下。
 *
 * 运行时约束（同 dsh-git-vcs）：只 require 平台模块表里的 specifier，产物是闭包
 * 工厂，不写 document.head，组件收不到 ctx（host 调用经注册项 inject 工厂闭包捕获）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-jev-zxh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const SettingsForm = primitives.SettingsForm
    const SettingsValueField = primitives.SettingsValueField
    const SettingsSecretField = primitives.SettingsSecretField
    const SettingsFormModel = primitives.SettingsFormModel
    const settingsTextField = primitives.settingsTextField

    /** 本插件在 profile 里的条目 id —— 同时是设置命名空间与 configForms 作用域 id。 */
    const ENTRY_ID = 'dsh-jev'
    /** 字典命名空间（本包自有）。 */
    const NS = 'settings.dshJev'
    /** 本节没写 apiKeyEnv 时用的凭据引用。 */
    const DEFAULT_API_KEY_REF = 'OPENROUTER_API_KEY'
    /** 密文控件在表单里暂存用的字段名。 */
    const API_KEY_FIELD = 'apiKey'

    /** English copy. */
    const en = {
      title: 'Jev',
      description: 'Typed probability judgments through TypeSafe Jev (the jev_decide tool).',
      apiKey: 'API key',
      apiKeyHint: 'Stored in the credential store, never in the settings file. Leave blank to keep the current key.',
      apiKeySet: 'A key is configured.',
      apiKeyUnset: 'No key is configured yet; jev_decide will fail until one is set.',
      endpoint: 'Endpoint',
      endpointHint: 'Leave blank to use the default (OpenRouter decisions endpoint).',
      model: 'Model',
      modelHint: 'Leave blank to use the pinned default; ~typesafe/jev-latest is the floating alias.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
    }
    /** Simplified Chinese copy. */
    const zh = {
      title: 'Jev 决策',
      description: '通过 TypeSafe Jev 拿到类型化的概率判断（jev_decide 工具）。',
      apiKey: 'API Key',
      apiKeyHint: '存在凭据库里，不写入设置文件。留空表示保持当前密钥。',
      apiKeySet: '已配置密钥。',
      apiKeyUnset: '尚未配置密钥；在填好之前 jev_decide 会直接失败。',
      endpoint: '接口地址',
      endpointHint: '留空则使用默认地址（OpenRouter decisions 端点）。',
      model: '模型',
      modelHint: '留空则使用锁定的默认版本；~typesafe/jev-latest 是浮动别名。',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
    }

    /**
     * 表单外壳的文案，从本页字典取。
     * @param t - 本页的字典读取器。
     * @returns 共享设置表单渲染的标签。
     */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }
    }

    /**
     * 按「插件」页的要求渲染本插件的一行说明或配置表单。
     * @param props - 视图类型、字典、表单快照与动作。
     * @returns 一行说明或表单。
     */
    function JevCard(props) {
      const { t } = props
      const state = props.useJevCard((snapshot) => snapshot)
      if (props.view === 'summary') return t('description')
      const disabled = !state.writable
      return h(
        SettingsForm,
        {
          labels: formLabels(t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h(SettingsSecretField, {
          id: 'plugin-config-dsh-jev-key',
          label: t('apiKey'),
          hint: t('apiKeyHint'),
          disabled: !state.apiKeyWritable,
          text: state.apiKey.text,
          configured: state.apiKeyConfigured,
          stateLabel: state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset'),
          onEdit: (text) => {
            props.edit(API_KEY_FIELD, text)
          },
        }),
        h(SettingsValueField, {
          id: 'plugin-config-dsh-jev-endpoint',
          label: t('endpoint'),
          hint: t('endpointHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('reset'),
          disabled,
          ...state.endpoint,
          onEdit: (text) => {
            props.edit('endpoint', text)
          },
          onReset: () => {
            props.resetField('endpoint')
          },
        }),
        h(SettingsValueField, {
          id: 'plugin-config-dsh-jev-model',
          label: t('model'),
          hint: t('modelHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('reset'),
          disabled,
          ...state.model,
          onEdit: (text) => {
            props.edit('model', text)
          },
          onReset: () => {
            props.resetField('model')
          },
        }),
      )
    }

    /**
     * 本页的暂存表单，架在 `dsh-jev` 设置命名空间与凭据域之上。
     *
     * 密钥是唯一不落在设置节里的控件：它的字面值从不随响应回传，所以本页只知道
     * 「是否已配置」，写入走凭据域、地址取自本节声明的 `apiKeyEnv`。它仍然和别的
     * 字段一起暂存，所以一次「保存」覆盖本页显示的全部内容。
     */
    class JevCardController {
      /**
       * @param scope - `dsh-jev` 命名空间的设置作用域。
       * @param ctx - 本页插件的上下文，用它的 `remote.credentials` 问凭据状态。
       */
      constructor(scope, ctx) {
        this.scope = scope
        this.ctx = ctx
        this.credential = { ref: '', configured: false, writable: true }
        this.form = new SettingsFormModel(
          scope,
          [settingsTextField('endpoint'), settingsTextField('model')],
          [{ field: API_KEY_FIELD, write: (text) => this.writeKey(text) }],
        )
        this.store = this.form.bind(() => this.projection())
        this.unsubscribe = scope.subscribe(() => {
          this.readCredential()
        })
        this.readCredential()
      }

      projection() {
        return {
          ...this.form.shell(),
          endpoint: this.form.field('endpoint'),
          model: this.form.field('model'),
          apiKey: this.form.field(API_KEY_FIELD),
          apiKeyConfigured: this.credential.configured,
          apiKeyWritable: this.credential.writable,
        }
      }

      /**
       * 问凭据域：本节当前声明的引用是什么状态。
       *
       * 回答连同它所描述的引用一起保存：`apiKeyEnv` 可能在请求与响应之间被改，
       * 两次读取也可能乱序落地，所以只有仍对应当前引用的响应才会被发布。
       */
      async readCredential() {
        const ref = refOf(this.scope.getSnapshot())
        if (ref !== this.credential.ref) {
          this.credential = { ref, configured: false, writable: true }
          this.store.set(this.projection())
        }
        const response = await this.ctx.remote.credentials.describe([ref])
        if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
        const view = response.value[ref]
        const next = {
          ref,
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        }
        if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
        this.credential = next
        this.store.set(this.projection())
      }

      /**
       * Host 报告本页监视的引用有变化时重读。
       *
       * 密钥可能在别处被写（「设置 → 模型」页写的是同一个引用），而设置节不会因此
       * 变化；没有这一步，徽标会一直报一个 Host 早已替换掉的状态。
       * @param ref - Host 报告发生变化的引用。
       */
      refreshCredential(ref) {
        if (ref !== this.credential.ref) return
        this.readCredential()
      }

      /**
       * 构造注册项 inject 工厂注入的面。
       * @returns 本页的快照来源与表单动作。
       */
      inject() {
        return {
          hooks: { jevCard: this.store },
          ...this.form.actions(),
        }
      }

      /**
       * 写入暂存的密钥，然后重读 Host 是否已持有。
       * @param value - 暂存的凭据字面值。
       * @returns Host 之后是否报告已配置。
       */
      async writeKey(value) {
        await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
        await this.readCredential()
        return this.credential.configured
      }

      /** 释放配置订阅。 */
      dispose() {
        this.unsubscribe()
        this.form.dispose()
      }
    }

    /**
     * 本节声明的凭据引用，或插件默认值。
     * @param snapshot - 当前作用域快照。
     * @returns 要寻址的引用。
     */
    function refOf(snapshot) {
      const declared = snapshot.value?.apiKeyEnv
      return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
    }

    /** 需要的服务（cordis fiber inject）。 */
    const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

    /**
     * Host 服务 `dsh-jev` 命名空间期间挂上本页。
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-jev: dictionaries')
      const card = new JevCardController(ctx.configForms.get(ENTRY_ID), ctx)
      ctx.effect(() => () => {
        card.dispose()
      }, 'dsh-jev: form subscription')
      ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => {
        card.refreshCredential(ref)
      }), 'dsh-jev: credential invalidations')
      ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'dsh-jev',
        order: 50,
        label: () => t('title'),
        locale: NS,
        inject: () => card.inject(),
      }, JevCard))), 'dsh-jev: page')
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
