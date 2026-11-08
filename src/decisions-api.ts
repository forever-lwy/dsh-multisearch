/**
 * Decision APIs: a model answers typed questions about a state with probabilities and scores,
 * instead of writing text. Two wire formats are in use:
 *
 * - OpenAI Decisions — `POST …/decisions`, `{ model, input, questions: [{ type, name, instructions, choices | levels }] }`,
 *   answers `[{ name, type: predicate|choice|score|refusal, probability | choice | score }]`.
 * - System One (TypeSafe Jev; also OpenRouter, Vercel AI Gateway) — `POST …/systemone` (some hosts: `…/decisions`),
 *   `{ model, state, questions: { id: { type: noul|choice|score, instructions, criteria } } }`,
 *   answers `{ id: { type, noul | choice | score } }`.
 *
 * The reply parser accepts either answer shape, so a host that pairs one request format with the
 * other's reply layout still works.
 */
import { http } from './http.js'
import { decisionsUrl, type DecisionProtocol } from './presets.js'

export type Question =
  | { id: string; type: 'bool'; instructions: string; true: string; false: string }
  | { id: string; type: 'score'; instructions: string; levels: { label: string; description?: string }[] }
  | { id: string; type: 'choice'; instructions: string; choices: { value: string; description?: string }[] }

/** bool → probability of true; score → 0–1 position across the levels; choice → chosen value. */
export type Answer = number | string

export interface DecisionsTarget {
  protocol: DecisionProtocol
  baseURL: string
  model: string
  apiKey?: string
  timeoutMs: number
  signal: AbortSignal
}

/** Hosts cap questions per request (OpenAI 400, some System One hosts 128); stay well below. */
export const MAX_QUESTIONS = 100

export function openAIRequest(model: string, state: object, questions: Question[]): Record<string, unknown> {
  return {
    model,
    input: JSON.stringify(state),
    questions: questions.map(question => {
      if (question.type === 'bool') {
        return { type: 'predicate', name: question.id, instructions: `${question.instructions}\n\nTrue means: ${question.true}\nFalse means: ${question.false}` }
      }
      if (question.type === 'score') return { type: 'score', name: question.id, instructions: question.instructions, levels: question.levels }
      return { type: 'choice', name: question.id, instructions: question.instructions, choices: question.choices }
    }),
  }
}

export function systemOneRequest(model: string, state: object, questions: Question[]): Record<string, unknown> {
  return {
    model,
    state,
    questions: Object.fromEntries(questions.map(question => {
      if (question.type === 'bool') return [question.id, { type: 'noul', instructions: question.instructions, criteria: { true: question.true, false: question.false } }]
      if (question.type === 'score') {
        return [question.id, { type: 'score', instructions: question.instructions, criteria: question.levels.map(l => l.description ? `${l.label}: ${l.description}` : l.label) }]
      }
      return [question.id, { type: 'choice', instructions: question.instructions, criteria: Object.fromEntries(question.choices.map(c => [c.value, c.description ?? c.value])) }]
    })),
  }
}

const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Answers from either reply layout; questions without a usable answer (refusals included) are left out. */
export function parseAnswers(body: any, questions: Question[]): Map<string, Answer> {
  const raw = body?.answers ?? body?.result?.answers ?? body?.result?.result?.answers
  const byId = new Map<string, any>()
  if (Array.isArray(raw)) {
    raw.forEach((answer, index) => {
      const id = typeof answer?.name === 'string' ? answer.name : questions[index]?.id
      if (id) byId.set(id, answer)
    })
  } else if (raw && typeof raw === 'object') {
    for (const [id, answer] of Object.entries(raw)) byId.set(id, answer)
  }
  const out = new Map<string, Answer>()
  for (const question of questions) {
    const answer = byId.get(question.id)
    if (!answer || typeof answer !== 'object' || answer.type === 'refusal') continue
    if (question.type === 'bool') {
      const p = finite(answer.probability) ?? finite(answer.noul) ?? finite(answer.value)
      if (p !== undefined) out.set(question.id, clamp(p))
    } else if (question.type === 'score') {
      const score = finite(answer.score)
      if (score !== undefined) out.set(question.id, clamp(score / Math.max(1, question.levels.length - 1)))
    } else if (typeof answer.choice === 'string') {
      out.set(question.id, answer.choice)
    }
  }
  return out
}

/** Ask all questions about one state; batches stay under the per-request cap. Throws on transport failure. */
export async function askDecisions(target: DecisionsTarget, state: object, questions: Question[]): Promise<Map<string, Answer>> {
  const url = decisionsUrl(target.baseURL, target.protocol)
  const headers: Record<string, string> = target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}
  const batches: Question[][] = []
  for (let i = 0; i < questions.length; i += MAX_QUESTIONS) batches.push(questions.slice(i, i + MAX_QUESTIONS))
  const replies = await Promise.all(batches.map(async batch => {
    const body = target.protocol === 'systemone' ? systemOneRequest(target.model, state, batch) : openAIRequest(target.model, state, batch)
    const data = await http.json(url, { body, headers, signal: target.signal, timeoutMs: target.timeoutMs })
    return parseAnswers(data, batch)
  }))
  return new Map(replies.flatMap(reply => [...reply]))
}
