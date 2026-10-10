# dsh-jev-zxh

DSH（DeepSeek Harness）插件：把 [TypeSafe Jev](https://openrouter.ai/docs/guides/community/jev) 这个 **System One 决策模型**接成模型可调用的工具 `jev_decide`。

Jev 不写文本。给它一份 `state` 和若干**带类型的问题**，它只回类型化答案 + 概率：

| 原语 | 问什么 | 回来什么 |
|---|---|---|
| `choice` | 这些选项里是哪一个？ | 选中的标签、每个选项的概率、`confidence` |
| `noul` | 这个命题成立吗？ | yes 的概率（本身就是全部答案，无单独 confidence） |
| `score` | 在有序刻度上的什么位置？ | 概率加权位置、每个等级的概率、`confidence` |

输出是类型化的，代码/模型可以直接按数值分支，没有自由文本要解析。

## 版本与兼容性

| 项目 | 值 |
|---|---|
| 插件版本 | `0.1.0` |
| npm 包名 | `dsh-jev-zxh` |
| 插件行 id / 工具名 | `dsh-jev` / `jev_decide` |
| 仓库 | <https://github.com/TiChuXiXi/dsh-jev-zxh> |
| 兼容的 DSH | `@deepseek-ai/dsh` ≥ `0.2.0-rc.2`（写在 `package.json` 的 `dsh.engines.dsh`） |
| 运行时依赖 | 无（`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 由 harness 提供，声明为 optional peer） |
| 构建 | 零构建，`index.js` 就是产物 |

> **包名为什么带 `-zxh`**：npm 上的 `dsh-jev` 已被另一个账号（`zhangxaochen`）占用，那是另一份实现，与本插件无关。装的时候认准 `dsh-jev-zxh`。

## 安装

```powershell
dsh plugin --profile web add dsh-jev-zxh
```

**必须重启 `dsh`**（bundle 层在进程启动时加载，刷新页面不够）。启动日志里应出现
`[dsh-jev] jev_decide registered (model=typesafe/jev-1.13)`。

生效时机：本机 web profile（`patchReload: live`）实测，装好后**不需要重启**、已有会话的工具列表里
就会出现 `jev_decide`；如果你的 profile 不是 live，或工具列表里没有，就重启 dsh 并**新建会话**
（工具 schema 在会话创建时锁定）。

本包**不带任何密钥**，装完还要填配置，见下节。

## 配置

安装后到 **设置 → 插件** 页找到 `dsh-jev`，填 `apiKey` 和 `endpoint`。表单只渲染标了
`.volatile()` 的字段，改了立即生效、不用重启；`apiKey` 标了 `role('secret')`，读取时被脱敏，
不会回显到浏览器。

也可以直接写进 profile 自己的 `cordis.patch.yml`（按行 id 覆盖）：

```yaml
- id: dsh-jev
  config:
    apiKey: 'sk-or-v1-...'
    endpoint: 'https://api.typesafe.ai/v1/systemone'
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | `''` | OpenRouter / TypeSafe 密钥。留空则读 `apiKeyEnv` 指向的环境变量。**密钥字段** |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | `apiKey` 为空时用的环境变量名 |
| `endpoint` | `https://openrouter.ai/api/alpha/decisions` | 改成 `https://api.typesafe.ai/v1/systemone` 可直连 TypeSafe |
| `model` | `typesafe/jev-1.13` | `~typesafe/jev-latest` 是浮动别名；默认锁版本便于复现 |
| `timeoutMs` | `60000` | 单次请求总超时（毫秒）。**故意不标 volatile**：它会被固化进工具超时（+5000ms），改它请改配置文件并重挂插件，两处才一致 |
| `appTitle` | `dsh-jev-zxh` | OpenRouter 归因头 `X-Title` |
| `appReferer` | `''` | OpenRouter 归因头 `HTTP-Referer`，留空不发 |

## 工具 `jev_decide`

```
jev_decide(
  state: string | object | array,          # Jev 要看的全部内容
  questions: [
    { id, type: 'choice', instructions, criteria: { label: '描述', ... } },
    { id, type: 'score',  instructions, criteria: ['最低', ..., '最高'] },
    { id, type: 'noul',   instructions, criteria?: { true: '…', false: '…' } },
  ]
)
```

返回 `{ answers, model, provider, id, input_tokens, output_tokens, cost_usd }`，`answers` 按 `id` 索引。

- `questions[].id` **不会发给模型**，所有语义必须写在 `instructions` 与 `criteria` 里。
- 一次调用把所有问题并行评完；多加一个问题只多花输入 token，几乎不增加延迟。
- 上游报错、缺答案、概率越界都会让工具调用**失败**，不会静默降级成「看起来成功」。

## 已知限制

- 只吃文本；图片/音频要先转写。
- Jev 读字面意思，不做算术、数数、日期比较和多跳推理，上下文越长越容易被无关内容干扰。
- `confidence` 是概率分布形状的统计量，不是「答案正确的概率」；阈值必须在自己的数据上调。
- 上游是 OpenRouter **alpha** 端点，形状可能变。
- `confidence` 高也不能让危险动作变安全：权限与不可逆操作的闸门要写在代码里。

## 开发调试（本地源码挂载）

正式安装走 npm；只有要改本仓库源码时才需要下面这套。

```powershell
cd <本仓库>
npm install --registry https://registry.npmjs.org      # index.js 需要本地 node_modules
pwsh -File .\install.ps1                                # 默认 web，-Profile tui 换 profile
pwsh -File .\uninstall.ps1                              # 反操作
```

`install.ps1` 在 `<DSH_HOME>\profiles\node_modules\dsh-jev-zxh` 建 junction 指向本目录，并把包名加进
`<DSH_HOME>\profiles\<Profile>\package.json` 的 `dsh.profile.bundles`。

为什么不直接 `dsh plugin add <绝对路径>`：Windows 上 pnpm 会把 `link:D:/...` 当**相对路径**，建出指向
`<profile 目录>\D:\...` 的死 junction，reconcile 随即报 `cannot resolve profile bundle`。profile 在 C:、
源码在 D: 时必踩。把源码挪到和 profile 同一个盘之后，标准的 `dsh plugin --profile web add <路径>` 也能用。

自检（真实调用上游，需要密钥）：

```powershell
$env:OPENROUTER_API_KEY = 'sk-or-v1-...'
node test/call.mjs
```

## 更新记录

| 版本 | 主要变化 |
|---|---|
| **0.1.0** | 首个发布版：`jev_decide` 工具（choice / noul / score 三原语）、严格校验与失败即抛、包内不含任何密钥、配置改为在「设置 → 插件」页填写 |

## 上游事实

- `typesafe/jev-1.13`，2026-09-18 发布，32K 上下文，**$0.042 / 1M 输入 token，输出免费**。
- 实测单次三问题调用约 476–848 输入 token，`usage.cost ≈ $0.00002–0.00004`。
