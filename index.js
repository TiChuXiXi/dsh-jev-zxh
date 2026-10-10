/**
 * dsh-jev —— 把 TypeSafe Jev（System One 决策模型）接成 DSH 工具。
 *
 * Jev 不生成文本：给它一份 state 和若干「带类型的问题」，它直接回带概率的
 * 类型化答案（choice / noul / score）。这个插件只做一件事——把那次 HTTP
 * 调用包成一个模型可调用的工具，并把概率原样交回模型，供其做数值分支判断。
 *
 * 上游：POST https://openrouter.ai/api/alpha/decisions（OpenRouter alpha 端点，
 * 不在 /api/v1 下，chat completions 形状不适用）。文档见
 * https://openrouter.ai/docs/guides/community/jev
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-jev'
export const inject = ['tools']

/**
 * 插件配置。两处标记不是装饰，改之前先读这里：
 *
 * - `.volatile()`：DSH 的「设置 → 插件」表单【只渲染 volatile 字段】。安装者
 *   就是在那里填 API key 与 endpoint 的，所以这几个字段必须是 volatile；改了
 *   立即生效，不会重挂插件（本插件在 execute 里读 config，天然支持热改）。
 * - `role('secret')`：密钥字段。设置页读取时被脱敏，客户端只拿到「已设置 /
 *   未设置」标记，不会把密钥回显到浏览器。
 *
 * `timeoutMs` 故意【不】标 volatile：它在注册工具时被固化进工具超时
 * （timeoutMs + 5000），标了 volatile 会出现「表单改了、工具超时没跟着改」的
 * 半生效状态。改它请改配置文件，那会重挂插件，两处才一致。
 */
export const Config = Schema.object({
  /** OpenRouter / TypeSafe API key。留空则回落到 apiKeyEnv 指定的环境变量。 */
  apiKey: Schema.string().role('secret').default('').volatile(),
  /** apiKey 为空时读取的环境变量名。 */
  apiKeyEnv: Schema.string().role('credential-ref').default('OPENROUTER_API_KEY').volatile(),
  /** Decisions 端点。改成 https://api.typesafe.ai/v1/systemone 可直连 TypeSafe。 */
  endpoint: Schema.string().default('https://openrouter.ai/api/alpha/decisions').volatile(),
  /** 模型 id。~typesafe/jev-latest 是浮动别名，默认锁具体版本便于复现。 */
  model: Schema.string().default('typesafe/jev-1.13').volatile(),
  /** 单次请求的总超时（毫秒），含连接与读完整响应体。见上文：不要标 volatile。 */
  timeoutMs: Schema.number().default(60000),
  /** OpenRouter 归因头 X-Title。 */
  appTitle: Schema.string().default('dsh-jev-zxh').volatile(),
  /** OpenRouter 归因头 HTTP-Referer。留空则不发。 */
  appReferer: Schema.string().default('').volatile(),
})

/** Jev 的三种原语。 */
const QUESTION_TYPES = ['choice', 'noul', 'score']

/**
 * 把工具参数里的问题数组编译成 Decisions API 的 questions 对象。
 * 校验失败一律抛错——坏问题绝不能变成一次「看起来成功」的调用。
 */
function compileQuestions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('questions must be a non-empty array of question objects.')
  }

  const questions = {}
  for (let i = 0; i < raw.length; i += 1) {
    const question = raw[i]
    const at = `questions[${i}]`
    if (question === null || typeof question !== 'object' || Array.isArray(question)) {
      throw new Error(`${at} must be an object.`)
    }

    const id = question.id
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`${at}.id must be a non-empty string; answers come back keyed by it.`)
    }
    if (Object.hasOwn(questions, id)) {
      throw new Error(`${at}.id "${id}" is already used; question ids must be unique.`)
    }

    const type = question.type
    if (!QUESTION_TYPES.includes(type)) {
      throw new Error(`${at}.type must be one of ${QUESTION_TYPES.join(' | ')}, got ${JSON.stringify(type)}.`)
    }

    const instructions = question.instructions
    if (typeof instructions !== 'string' || instructions.trim() === '') {
      throw new Error(`${at}.instructions must be a non-empty string stating the exact condition to judge.`)
    }

    const compiled = { type, instructions }
    const criteria = question.criteria

    if (type === 'choice') {
      if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
        throw new Error(
          `${at}.criteria for a choice must be an object mapping every option label to its description, `
          + 'for example {"billing": "Charges, invoices and refunds", "technical": "Bugs and broken features"}.',
        )
      }
      const labels = Object.keys(criteria)
      if (labels.length < 2) {
        throw new Error(`${at}.criteria for a choice needs at least 2 option labels, got ${labels.length}.`)
      }
      if (labels.length > 255) {
        throw new Error(`${at}.criteria for a choice accepts at most 255 option labels, got ${labels.length}.`)
      }
      const options = {}
      for (const label of labels) {
        if (label.trim() === '') throw new Error(`${at}.criteria has a blank option label.`)
        const description = criteria[label]
        if (description !== null && typeof description !== 'string') {
          throw new Error(`${at}.criteria["${label}"] must be a string description or null.`)
        }
        options[label] = description
      }
      compiled.criteria = options
    } else if (type === 'score') {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) {
        throw new Error(
          `${at}.criteria for a score must be an array of 2 to 10 ordered level descriptions, lowest first. `
          + 'Level 0 is the first entry.',
        )
      }
      compiled.criteria = criteria.map((level, index) => {
        if (typeof level !== 'string' || level.trim() === '') {
          throw new Error(`${at}.criteria[${index}] must be a non-empty level description.`)
        }
        return level
      })
    } else if (criteria !== undefined && criteria !== null) {
      // noul：criteria 可选，只允许 { true, false } 两个描述键。
      if (typeof criteria !== 'object' || Array.isArray(criteria)) {
        throw new Error(`${at}.criteria for a noul is optional and must be an object like {"true": "...", "false": "..."}.`)
      }
      const described = {}
      for (const key of ['true', 'false']) {
        const description = criteria[key]
        if (description === undefined || description === null) continue
        if (typeof description !== 'string') {
          throw new Error(`${at}.criteria.${key} must be a string description.`)
        }
        described[key] = description
      }
      if (Object.keys(described).length > 0) compiled.criteria = described
    }

    questions[id] = compiled
  }

  return questions
}

/** 校验并规范化上游返回的 answers；缺答案或概率越界都视为失败。 */
function compileAnswers(raw, expectedIds) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Jev returned no answers object.')
  }
  const missing = expectedIds.filter((id) => raw[id] === undefined)
  if (missing.length > 0) {
    throw new Error(`Jev did not answer: ${missing.join(', ')}`)
  }

  const answers = {}
  for (const id of expectedIds) {
    const answer = raw[id]
    if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new Error(`Jev returned a malformed answer for "${id}".`)
    }
    const probabilities = answer.probabilities
    if (probabilities !== undefined) {
      if (probabilities === null || typeof probabilities !== 'object' || Array.isArray(probabilities)) {
        throw new Error(`Jev returned malformed probabilities for "${id}".`)
      }
      for (const [label, value] of Object.entries(probabilities)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error(`Jev returned probability ${String(value)} for "${id}".${label}; expected a number in [0, 1].`)
        }
      }
    } else if (answer.type !== 'noul') {
      throw new Error(`Jev returned no probabilities for "${id}".`)
    }
    if (answer.type === 'noul') {
      if (typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
        throw new Error(`Jev returned noul ${String(answer.noul)} for "${id}"; expected a number in [0, 1].`)
      }
    } else if (answer.type === 'choice') {
      if (typeof answer.choice !== 'string' || answer.choice === '') {
        throw new Error(`Jev returned no choice label for "${id}".`)
      }
    } else if (answer.type === 'score') {
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score)) {
        throw new Error(`Jev returned score ${String(answer.score)} for "${id}"; expected a finite number.`)
      }
    } else {
      throw new Error(`Jev returned unknown answer type ${JSON.stringify(answer.type)} for "${id}".`)
    }
    answers[id] = answer
  }
  return answers
}

/** 一行一条的答案摘要，供模型直接阅读。 */
function summarize(value) {
  const lines = []
  for (const [id, answer] of Object.entries(value.answers)) {
    if (answer.type === 'noul') {
      lines.push(`${id}  noul=${answer.noul}  (yes 概率)`)
    } else if (answer.type === 'choice') {
      lines.push(`${id}  choice=${JSON.stringify(answer.choice)}  confidence=${answer.confidence}  probabilities=${JSON.stringify(answer.probabilities)}`)
    } else if (answer.type === 'score') {
      lines.push(`${id}  score=${answer.score}  confidence=${answer.confidence}  probabilities=${JSON.stringify(answer.probabilities)}`)
    } else {
      lines.push(`${id}  ${JSON.stringify(answer)}`)
    }
  }
  lines.push(
    `model=${value.model} provider=${value.provider} input_tokens=${value.input_tokens} `
    + `output_tokens=${value.output_tokens} cost_usd=${value.cost_usd}`,
  )
  return lines.join('\n')
}

export function apply(ctx, config) {
  const logger = ctx.get('logger')

  ctx.tools.register(defineTool({
    name: 'jev_decide',
    description: [
      'Ask TypeSafe Jev (a System One decision model) for typed, calibrated judgments about a piece of text.',
      'Jev never writes prose: it answers only the questions you give it and returns one probability per option,',
      'so you branch on numbers instead of parsing a sentence out of another model\'s reply.',
      '',
      'Reach for it when the acceptable answers can be enumerated before the question is asked:',
      'which category does X belong to, does this condition hold, how severe / risky / relevant is X on a fixed scale,',
      'which candidate best matches, does this draft contradict the provided source, is this action reversible.',
      'Fan out many questions in one call — each extra question costs input tokens but almost no wall-clock time.',
      '',
      'Do NOT use it to compose text (summaries, replies, patches, explanations), for arithmetic or counting,',
      'for date comparisons, or for multi-hop questions about a property of a property. Keep those in code or a chat model.',
      'A confidence threshold alone never makes an action safe: enforce permissions and irreversible-action limits in code.',
    ].join('\n'),
    parameters: {
      state: {
        type: 'json',
        required: true,
        description: [
          'Everything Jev should look at: a string, a JSON object of named fields, or an array of text lines.',
          'Questions may reference object fields by name inside backticks.',
          'Keep it trimmed: accuracy drops as irrelevant content grows, and state plus all questions must fit the context window.',
        ].join(' '),
      },
      questions: {
        type: 'array',
        required: true,
        description: 'One or more typed questions, all answered in a single pass over the same state.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Short answer key, unique within this call. Jev never sees it, so all meaning must live in instructions and criteria.',
            },
            type: {
              type: 'string',
              enum: QUESTION_TYPES,
              required: true,
              description: 'choice = pick one label from criteria; noul = yes/no probability; score = position on ordered levels.',
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'The single proposition to judge, stated exactly. Jev reads literally: spell out the condition and put boundary cases in the criteria.',
            },
            criteria: {
              type: 'json',
              description: [
                'choice: object mapping each option label to its description, e.g. {"billing": "Charges and refunds", "technical": "Bugs and broken features"}. 2 to 255 labels.',
                'score: array of 2 to 10 level descriptions, lowest first, e.g. ["Cosmetic", "Degraded but workaround exists", "Blocking"]; level 0 is the first entry.',
                'noul: optional object {"true": "...", "false": "..."} describing what each answer means. Omit to judge the instructions alone.',
              ].join(' '),
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', description: 'The dated snapshot that actually served the request.' },
          provider: { type: 'string' },
          id: { type: 'string', description: 'Generation id, for cost reconciliation.' },
          input_tokens: { type: 'integer' },
          output_tokens: { type: 'integer' },
          cost_usd: { type: 'number', description: 'Actual charge for this call in USD.' },
          answers: {
            type: 'object',
            additionalProperties: true,
            description: 'One entry per question id. noul: {type, noul}. choice: {type, choice, confidence, probabilities}. score: {type, score, confidence, probabilities, legend}.',
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: summarize(value) }],
    },
    timeoutMs: config.timeoutMs + 5000,
    // 纯网络读取，无共享状态：同一批问题可以并行发出。
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      // volatile 字段是 Volatile<T> 引用：值必须在【调用时】经 .get() 读。
      // loader 会原地更新引用而不重挂插件，所以「设置 → 插件」页改完立即生效。
      const configuredKey = (config.apiKey.get() ?? '').trim()
      const apiKeyEnv = (config.apiKeyEnv.get() ?? '').trim()
      const apiKey = configuredKey !== ''
        ? configuredKey
        : (process.env[apiKeyEnv] ?? '').trim()
      if (apiKey === '') {
        throw new Error(
          `No OpenRouter API key: set "apiKey" for entry dsh-jev in 设置 → 插件, or export ${apiKeyEnv}.`,
        )
      }
      if (args.state === undefined || args.state === null) {
        throw new Error('state is required: send the text or object the questions are about.')
      }

      const questions = compileQuestions(args.questions)
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
      const appTitle = (config.appTitle.get() ?? '').trim()
      const appReferer = (config.appReferer.get() ?? '').trim()
      if (appTitle !== '') headers['X-Title'] = appTitle
      if (appReferer !== '') headers['HTTP-Referer'] = appReferer

      const timeout = AbortSignal.timeout(config.timeoutMs)
      const signal = exec?.signal === undefined ? timeout : AbortSignal.any([exec.signal, timeout])

      let response
      try {
        response = await fetch(config.endpoint.get(), {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({ model: config.model.get(), state: args.state, questions }),
        })
      } catch (error) {
        if (timeout.aborted) throw new Error(`Jev request timed out after ${config.timeoutMs} ms.`)
        throw new Error(`Jev request failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Jev returned HTTP ${response.status}: ${text.slice(0, 800)}`)
      }

      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw new Error(`Jev returned a non-JSON body: ${text.slice(0, 400)}`)
      }

      const answers = compileAnswers(payload.answers, Object.keys(questions))
      const usage = payload.usage ?? {}

      return {
        model: typeof payload.model === 'string' ? payload.model : config.model.get(),
        provider: typeof payload.provider === 'string' ? payload.provider : '',
        id: typeof payload.id === 'string' ? payload.id : '',
        input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
        output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
        cost_usd: typeof usage.cost === 'number' ? usage.cost : 0,
        answers,
      }
    },
  }))

  logger?.info?.(`[dsh-jev] jev_decide registered (model=${config.model.get()})`)
}
