/**
 * 复现脚本：走一遍 DSH 在【每次对话】都会跑的 schema 投影链路
 * （native function calling 的 parameters + PTC 模式的 TS/Python SDK 代码生成），
 * 看 dsh-jev 注册的工具定义会不会把某一步同步卡死。
 *
 * 用 fs.writeSync 同步写 stdout —— 如果是死循环卡住，异步的 console.log 永远刷不出来。
 *
 * 运行：node test/repro-schema.mjs
 */
import { writeSync } from 'node:fs'
import {
  jsonSchemaToTs,
  jsonSchemaToPy,
  renderToolsSdk,
  renderToolsSdkPy,
} from '@deepseek-ai/dsh-tools'

const step = (message) => writeSync(1, `[step] ${message}\n`)

step('import @deepseek-ai/dsh-tools ok')

const { apply, Config } = await import('../index.js')
step('import ../index.js ok')

let definition
apply(
  { tools: { register: (d) => { definition = d; return () => {} } }, get: () => undefined },
  Config({ apiKey: 'not-used-in-this-test' }),
)
step(`definition registered: ${definition.name}`)

const schema = definition.parameters
step(`parameters keys: ${Object.keys(schema).join(', ')}`)
step(`parameters.required: ${JSON.stringify(schema.required)}`)
const props = schema.properties
step(`properties keys: ${Object.keys(props).join(', ')}`)
step(`state node: ${JSON.stringify(props.state)}`)
step(`questions node: ${JSON.stringify(props.questions)}`)
step(`questions.items.additionalProperties: ${JSON.stringify(props.questions.items.additionalProperties)}`)
step(`questions.items.properties keys: ${Object.keys(props.questions.items.properties).join(', ')}`)
step(`criteria node: ${JSON.stringify(props.questions.items.properties.criteria)}`)

step('calling jsonSchemaToTs(parameters) ...')
const ts = jsonSchemaToTs(schema)
step(`jsonSchemaToTs ok (${ts.length} chars)`)

step('calling jsonSchemaToPy(parameters) ...')
const py = jsonSchemaToPy(schema)
step(`jsonSchemaToPy ok (${py.length} chars)`)

const sdkInput = [{
  name: definition.name,
  description: definition.description,
  parameters: schema,
  output: definition.output.schema,
}]

step('calling renderToolsSdk([tool]) ...')
const sdk = renderToolsSdk(sdkInput)
step(`renderToolsSdk ok (${sdk.length} chars)`)

step('calling renderToolsSdkPy([tool]) ...')
const sdkPy = renderToolsSdkPy(sdkInput)
step(`renderToolsSdkPy ok (${sdkPy.length} chars)`)

writeSync(1, '\n=== 生成的 TypeScript SDK 片段（前 2000 字符）===\n')
writeSync(1, `${sdk.slice(0, 2000)}\n`)
writeSync(1, '\n[step] ALL DONE\n')
