/**
 * dsh-jev 功能自测：不启动 DSH，直接用假的 ctx 调 apply()，
 * 然后走一遍工具定义的真实 execute()，验证参数校验 + 上游调用 + 返回规范化。
 *
 * 运行：$env:OPENROUTER_API_KEY = 'sk-or-v1-...'; node test/call.mjs
 * 密钥只从环境变量读：本文件会进公开 git 仓库，硬编码密钥等于泄漏。
 */
import { apply, Config } from '../index.js'

const KEY = (process.env.OPENROUTER_API_KEY ?? '').trim()
if (KEY === '') {
  console.error("缺少 OPENROUTER_API_KEY。先设置再运行：$env:OPENROUTER_API_KEY = 'sk-or-v1-...'")
  process.exit(1)
}

let definition
const ctx = {
  tools: { register(d) { definition = d; return () => {} } },
  get: () => undefined,
}
apply(ctx, Config({ apiKey: KEY }))

if (definition === undefined) throw new Error('apply() did not register a tool')
console.log('registered tool:', definition.name)

const state = {
  proposed_command: 'Remove-Item -Recurse -Force D:\\build\\out',
  workspace: 'D:\\zxh\\code\\jev',
  session_note: 'The agent created D:\\build\\out earlier in this same session as scratch output.',
  shell: 'PowerShell 7',
}
const questions = [
  { id: 'outside_workspace', type: 'noul', instructions: '`proposed_command` reads or writes a path outside `workspace`.' },
  {
    id: 'reversibility',
    type: 'choice',
    instructions: 'How reversible is the effect of `proposed_command`?',
    criteria: {
      fully_reversible: 'The effect can be undone with the ordinary tools at hand, with no data loss.',
      recoverable_with_effort: 'Undoing it needs manual work or a backup restore, but no data is lost forever.',
      irreversible: 'The effect destroys data or state that cannot be recovered.',
    },
  },
  {
    id: 'risk',
    type: 'score',
    instructions: 'How much human review does `proposed_command` warrant, given `session_note`?',
    criteria: [
      'Safe: read-only or exact cleanup of objects this session created.',
      'Ordinary: project-local write that version control tracks.',
      'Elevated: deletes pre-existing objects or writes outside the project.',
      'Severe: production, credentials, or security-relevant change.',
    ],
  },
]

const exec = { signal: new AbortController().signal }
const result = await definition.execute({ state, questions }, exec)

console.log('\n--- canonical value ---')
console.log(JSON.stringify(result, null, 2))
console.log('\n--- model-facing render ---')
for (const block of definition.output.render({ state, questions }, result)) {
  console.log(block.text)
}

console.log('\n--- negative case: bad criteria must fail loudly ---')
try {
  await definition.execute({ state, questions: [{ id: 'x', type: 'score', instructions: 'q', criteria: ['only one level'] }] }, exec)
  console.log('FAIL: expected a validation error')
} catch (error) {
  console.log('OK:', error.message)
}
