import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'
import { LANGS } from './languages'
import { emberDark } from './theme'

let instance: Highlighter | null = null
let initPromise: Promise<Highlighter> | null = null

export async function getHighlighter(): Promise<Highlighter> {
  if (instance)
    return instance
  if (initPromise)
    return initPromise

  initPromise = createHighlighter({
    themes: [emberDark],
    langs: [...LANGS],
  })
    .then(h => {
      instance = h
      return h
    })
    .catch(err => {
      initPromise = null
      throw err
    })

  return initPromise
}
