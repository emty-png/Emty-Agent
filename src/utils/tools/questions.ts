/**
 * src/utils/tools/questions.ts
 *
 * The ask_questions tool lets the agent ask the user up to 5 clarifying
 * questions in a single batch before proceeding with a task.
 *
 * FIX 2: Each question now accepts 2–4 pre-written options (was exactly 3).
 * The UI still appends a free-text "something else" field as a final option.
 *
 * FIX 2: Questions may declare a `dependsOn` field — a reference to a prior
 * question index and the answer value that should trigger this question.
 * The UI skips a dependent question when its condition isn't met, and the
 * tool resolves it with answer: "skipped (condition not met)".
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
 * FIX 2: Resolve which questions are active given answers collected so far.
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
    description: `Ask the user clarifying questions before proceeding. Use when the answer will meaningfully change your approach — not when you could read the codebase or make a reasonable assumption instead.

Rules:
- Batch ALL related questions in one call (max 5). Never call this multiple times for related questions.
- Each question needs 2–4 distinct options. The UI appends a free-text field automatically.
- Use dependsOn to skip irrelevant follow-ups based on a prior answer.
- Treat a "skipped" answer as "no preference — use your judgment".
- Don't ask yes/no questions with an obvious answer. Don't ask what you can find by reading files.`,
    inputSchema: z.object({
      questions: z
        .array(
          z.object({
            question: z
              .string()
              .min(1)
              .describe('The question to ask. Keep it concise and specific.'),
            options: z
              .array(z.string())
              // FIX 2: was .min(3).max(3) — now 2–4 for flexibility
              .min(2)
              .max(4)
              .describe(
                '2–4 pre-written answer options. '
                + 'Make them meaningfully distinct and cover the most likely choices. '
                + 'The UI always appends a free-text "something else" input as a final option. '
                + 'Use 2 options for binary choices, 3–4 for multi-way decisions.',
              ),
            // FIX 2: optional conditional display
            dependsOn: z
              .object({
                questionIndex: z
                  .number()
                  .int()
                  .min(0)
                  .describe('0-based index of the earlier question this depends on.'),
                whenAnswer: z
                  .string()
                  .describe(
                    'Show this question only when the answer to questionIndex starts with this string (case-insensitive). '
                    + 'Example: whenAnswer: "TypeScript" will match answers "TypeScript", "typescript", "ts" (if user typed that).',
                  ),
              })
              .optional()
              .describe(
                'If set, this question is only shown when a prior question was answered with a matching value. '
                + 'Use to avoid asking irrelevant follow-ups.',
              ),
          }),
        )
        .min(1)
        .max(5)
        .describe('Questions to ask in this batch. Group all related questions into one call.'),
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

          // FIX 2: back-fill "skipped (condition not met)" for any dependsOn
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
