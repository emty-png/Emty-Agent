/**
 * src/utils/tools/questions.ts
 *
 * The ask_questions tool lets the agent ask the user up to 5 clarifying
 * questions in a single batch before proceeding with a task.
 *
 * Each question has exactly 3 pre-written option buttons. The UI always
 * appends a free-text "something else" field as a 4th option.
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
  /** Exactly 3 pre-written options. The UI always adds a free-text 4th option. */
  options: string[]
}

export interface PendingBatch {
  questions: QuestionSpec[]
}

export interface QuestionAnswer {
  question: string
  /** The chosen option text, the user's custom free-text, or "skipped". */
  answer: string
}

// ── tool factory ──────────────────────────────────────────────────────────────

export type QuestionsCallback = (
  questions: QuestionSpec[],
  resolve: (answers: QuestionAnswer[]) => void,
) => void

export function createQuestionsTool(onQuestions: QuestionsCallback) {
  return tool({
    description: `\
Ask the user one or more clarifying questions before proceeding with a task.
Use this when the task is ambiguous and the user's answer will produce a significantly better result.
Each question presents exactly 3 pre-written options; the UI automatically adds a free-text "something else" field.

Group all related questions into a single call — never call this tool multiple times for related questions.
Maximum 5 questions per call.

Good uses:
  • Confirming the user's goal before a large refactor or greenfield feature
  • Choosing between meaningfully different implementation approaches
  • Clarifying scope when the request could go several directions
  • Identifying the user's preferred framework, convention, or style when the codebase is ambiguous

Bad uses:
  • Questions you can answer by reading the codebase — read it first
  • Yes/no confirmation questions with an obvious answer
  • Asking when you could safely assume and state your assumption instead

The user may skip any question; treat a "skipped" answer as "no strong preference — use your judgment".`,
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
              .min(3)
              .max(3)
              .describe(
                'Exactly 3 pre-written answer options. '
                + 'Make them meaningfully distinct and cover the most likely choices. '
                + 'The UI always appends a free-text "something else" input as a 4th option.',
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
          resolve({
            answers: questions.map(q => ({ question: q.question, answer: 'skipped' })),
          })
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

        onQuestions(questions as QuestionSpec[], (answers: QuestionAnswer[]) => {
          abortSignal?.removeEventListener('abort', onAbort)
          safeResolve(answers)
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
