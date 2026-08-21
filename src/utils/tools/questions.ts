/**
 * src/utils/tools/questions.ts
 *
 * The ask_questions tool lets the agent ask the user up to 5 clarifying
 * questions in a single batch before proceeding with a task.
 *
 * Architecture:
 *   execute() stores a Promise resolver in a module-level variable and sets
 *   the reactive `pendingBatch` ref that QuestionOverlay observes directly.
 *   When the user finishes answering, the overlay calls submitAnswers(),
 *   which resolves the Promise and lets the agent loop continue.
 *
 *   The abort signal from streamText() is wired into the Promise — calling
 *   stopGeneration() clears the overlay and resolves with "skipped" answers
 *   instead of leaving the tool hanging.
 *
 * Note: Do not call this tool more than once in the same response step.
 * The module-level resolver is a singleton by design — concurrent executions
 * would overwrite each other. The AI SDK calls tools sequentially in a step
 * when stopWhen: isLoopFinished() is used, so this is safe in practice.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

// ── types ─────────────────────────────────────────────────────────────────────

export interface QuestionSpec {
  question: string
  options: string[]
  dependsOn?: {
    questionIndex: number
    whenAnswer: string
  }
}

export interface PendingBatch {
  questions: QuestionSpec[]
}

export interface QuestionAnswer {
  question: string
  /** The chosen option text, the user's custom free-text, or "skipped". */
  answer: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve which questions are active given answers collected so far.
 * A question with `dependsOn` is skipped unless the referenced answer
 * matches `whenAnswer` (case-insensitive prefix, so "TypeScript" matches "ts").
 */
function isQuestionActive(
  spec: QuestionSpec,
  index: number,
  answers: QuestionAnswer[],
): boolean {
  if (!spec.dependsOn)
    return true

  const { questionIndex, whenAnswer } = spec.dependsOn

  if (questionIndex >= index)
    return true // forward references don't make sense — show it

  const priorAnswer = answers[questionIndex]?.answer ?? ''
  return priorAnswer.toLowerCase().startsWith(whenAnswer.toLowerCase())
}

// ── tool factory ──────────────────────────────────────────────────────────────

export type QuestionsCallback = (
  questions: QuestionSpec[],
  resolve: (answers: QuestionAnswer[]) => void,
) => void

export function createQuestionsTool(onQuestions: QuestionsCallback) {
  return tool({
    description: DEFAULT_TOOL_DESCRIPTIONS.ask_questions,
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z
              .string()
              .min(1)
              .max(250)
              .describe('The question to ask. Keep it concise, highly specific, and under 250 characters.'),
            options: z
              .array(z.string().min(1).max(100))
              .min(2)
              .max(4)
              .describe(
                '2–4 highly distinct, mutually exclusive answer options. '
                + 'Order them from most recommended to least recommended. '
                + 'Do NOT include "Other" or "Custom" as the UI adds a free-text field automatically.',
              ),
            dependsOn: z
              .object({
                questionIndex: z
                  .number()
                  .int()
                  .min(0)
                  .describe('0-based index of the earlier question this depends on. Must be strictly less than the current question index.'),
                whenAnswer: z
                  .string()
                  .min(1)
                  .describe(
                    'Show this question only when the answer to questionIndex starts with this string (case-insensitive). '
                    + 'Example: "TypeScript" will match "TypeScript", "typescript", or "ts".',
                  ),
              })
              .optional()
              .describe(
                'If set, this question is only shown when a prior question was answered with a matching value. '
                + 'Use to avoid asking irrelevant follow-ups and keep the UI clean.',
              ),
          }),
        )
        .min(1)
        .max(5)
        .describe('Questions to ask in this batch. Group ALL related questions into one single call.'),
    }),
    execute: async ({ questions }, { abortSignal }) => {
      return new Promise<{ answers: QuestionAnswer[] }>(resolve => {
        // Already aborted before we even start — skip all questions immediately.
        if (abortSignal?.aborted) {
          resolve({ answers: questions.map(q => ({ question: q.question, answer: 'skipped' })) })
          return
        }

        let isResolved = false

        const safeResolve = (answers: QuestionAnswer[]) => {
          if (!isResolved) {
            isResolved = true
            resolve({ answers })
          }
        }

        // When stopGeneration() fires, resolve gracefully rather than hanging.
        const onAbort = () => {
          safeResolve(questions.map(q => ({ question: q.question, answer: 'skipped' })))
        }

        abortSignal?.addEventListener('abort', onAbort, { once: true })

        // Normalize: strip `dependsOn: undefined` so the objects satisfy
        // QuestionSpec under exactOptionalPropertyTypes (absent ≠ undefined).
        const normalizedQuestions: QuestionSpec[] = questions.map(q => ({
          question: q.question,
          options: q.options,
          ...(q.dependsOn != null ? { dependsOn: q.dependsOn } : {}),
        }))

        onQuestions(normalizedQuestions, (rawAnswers: QuestionAnswer[]) => {
          abortSignal?.removeEventListener('abort', onAbort)

          // Back-fill "skipped (condition not met)" for any dependsOn
          // questions whose condition wasn't satisfied.
          const resolved: QuestionAnswer[] = normalizedQuestions.map((spec, i) => {
            if (!isQuestionActive(spec, i, rawAnswers)) {
              return { question: spec.question, answer: 'skipped (condition not met)' }
            }
            return rawAnswers[i] ?? { question: spec.question, answer: 'skipped' }
          })

          safeResolve(resolved)
        })
      })
    },
  })
}

// ── display label ─────────────────────────────────────────────────────────────

function truncate(s: string, max = 52): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max)}\u2026` : t
}

export function questionsToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName !== 'ask_questions')
    return `Called ${toolName}`

  const questions = args.questions as Array<{ question: string }> | undefined
  if (!questions?.length)
    return 'Asked a question'
  if (questions.length === 1)
    return `Asked: ${truncate(questions[0]!.question)}`
  return `Asked ${questions.length} questions`
}
