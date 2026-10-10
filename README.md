# dsh-jev-zxh

DSH（DeepSeek Harness）插件：把 [TypeSafe Jev](https://openrouter.ai/docs/guides/community/jev) 这个 **System One 决策模型**接成模型可调用的工具 `jev_decide`，并在「插件」页上提供一张配置卡。

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
| 插件版本 | `0.1.1` |
| npm 包名 | `dsh-jev-zxh` |
| 插件行 id / 工具名 | `dsh-jev` / `jev_decide` |
| 仓库 | <https://github.com/TiChuXiXi/dsh-jev-zxh> |
| 兼容的 DSH | `@deepseek-ai/dsh` ≥ `0.2.0-rc.2`（写在 `package.json` 的 `dsh.engines.dsh`） |
| 宿主半区 | `index.js`（注册工具、解析密钥、发请求） |
| 浏览器半区 | `client.js`（「插件」页上的配置卡；`dsh.client` + `exports["./client"]` 声明） |
| 运行时依赖 | 无（`@deepseek-ai/*` 由 harness 提供，声明为 optional peer） |
| 构建 | 零构建：两个半区都是手写产物，`client.js` 就是 classic script 形态的 bundle |

> **包名为什么带 `-zxh`**：npm 上的 `dsh-jev` 已被另一个账号（`zhangxaochen`）占用，那是另一份实现，与本插件无关。装的时候认准 `dsh-jev-zxh`。

## 安装

```powershell
dsh plugin --profile web add dsh-jev-zxh
```

**必须重启 `dsh`**（bundle 层在进程启动时加载）。启动日志里应出现
`[dsh-jev] jev_decide registered (model=typesafe/jev-1.13)`。

浏览器半区是客户端模块，装完还要**刷新页面**（F5）才会出现在「插件」页上。

本包**不带任何密钥**，装完要填一次配置，见下节。

## 配置

打开 **插件** 页，在列表里找到 **Jev 决策** 卡片，填三个字段后点保存：

| 字段 | 写到哪 | 说明 |
|---|---|---|
| **API Key** | **凭据库**（不进设置文件） | 引用名取自本节 `apiKeyEnv`，默认 `OPENROUTER_API_KEY`。字面值从不随任何响应回传；控件每次加载都是空的，只报告「是否已配置」 |
| **接口地址** | profile 的设置文档 | 留空用默认 `https://openrouter.ai/api/alpha/decisions`；直连 TypeSafe 填 `https://api.typesafe.ai/v1/systemone` |
| **模型** | profile 的设置文档 | 留空用 `typesafe/jev-1.13`；`~typesafe/jev-latest` 是浮动别名 |

密钥也可以从 **设置 → 模型** 页写：那条路写的是同一个引用（`OPENROUTER_API_KEY`），本卡片会通过 `credentials/reference-updated` 事件自动把徽标刷新过来。

### 密钥的解析顺序

`index.js` 按这个顺序取密钥，前一个取到就不看后面的：

1. 条目 `config.apiKey` 的**字面值**（写死在 profile 的 `cordis.patch.yml` 里，不推荐，密钥会留在配置文件里）；
2. **凭据库**里 `config.apiKeyEnv` 指向的引用（默认 `OPENROUTER_API_KEY`）—— 配置卡与「设置 → 模型」页写的就是这里；
3. 进程**环境变量** `config.apiKeyEnv`。

### 直接写 profile patch（不使用配置卡时）

```yaml
- id: dsh-jev
  config:
    endpoint: 'https://api.typesafe.ai/v1/systemone'
    model: '~typesafe/jev-latest'
```

`apiKey` 也可以写在这里（字面值），但密钥就落在配置文件里了；能走凭据库就走凭据库。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `apiKey` | `''` | 密钥字面值。留空则走凭据库 / 环境变量。**密钥字段**（设置页读取时脱敏） |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | 凭据引用名，同时兼作环境变量名 |
| `endpoint` | `https://openrouter.ai/api/alpha/decisions` | decisions 端点 |
| `model` | `typesafe/jev-1.13` | 模型 id |
| `timeoutMs` | `60000` | 单次请求总超时（毫秒）。**故意不标 volatile**：它会被固化进工具超时（+5000ms），所以不参与配置卡表单；改它请改配置文件并重挂插件，两处才一致 |
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

## 开发调试

```powershell
cd <本仓库>
npm install --registry https://registry.npmjs.org      # index.js 需要本地 node_modules

# 自检一：宿主半区（真实调用上游，需要密钥）
$env:OPENROUTER_API_KEY = 'sk-or-v1-...'
node test/call.mjs

# 自检二：浏览器半区接线（不需要浏览器、不联网）
node test/client.mjs
```

`test/client.mjs` 用假的 `window.__ModuleLoader__` / `require` / ctx 把 `client.js` 跑一遍，
验证注册进 `plugins.item`、表单动作、以及「密钥写凭据库、端点与模型写设置文档」这条链路。

本地源码直接挂进 profile（只有改源码时才需要；正式安装走 npm）：

```powershell
pwsh -File .\install.ps1      # 默认 web，-Profile tui 换 profile
pwsh -File .\uninstall.ps1    # 反操作
```

`install.ps1` 在 `<DSH_HOME>\profiles\node_modules\dsh-jev-zxh` 建 junction 指向本目录，并把包名加进
`<DSH_HOME>\profiles\<Profile>\package.json` 的 `dsh.profile.bundles`。

为什么不直接 `dsh plugin add <绝对路径>`：Windows 上 pnpm 会把 `link:D:/...` 当**相对路径**，建出指向
`<profile 目录>\D:\...` 的死 junction，reconcile 随即报 `cannot resolve profile bundle`。profile 在 C:、
源码在 D: 时必踩。

## 更新记录

| 版本 | 主要变化 |
|---|---|
| **0.1.1** | 新增**浏览器半区**：在「插件」页注册一张配置卡（API Key / 接口地址 / 模型）。密钥走凭据库（`remote.credentials.set`，引用名取 `apiKeyEnv`），端点与模型走 profile 设置文档；宿主半区的密钥解析顺序改为 `config.apiKey` → 凭据库 → 环境变量 |
| 0.1.0 | 首个发布版：`jev_decide` 工具（choice / noul / score 三原语）、严格校验与失败即抛、包内不含任何密钥 |

## 上游事实

- `typesafe/jev-1.13`，2026-09-18 发布，32K 上下文，**$0.042 / 1M 输入 token，输出免费**。
- 实测单次三问题调用约 476–848 输入 token，`usage.cost ≈ $0.00002–0.00004`。
