import { tool } from 'ai'
import { z } from 'zod'
import {
  browserAct,
  browserClosePage,
  browserCookies,
  browserCreateBlankPage,
  browserExecuteScript,
  browserGoHistory,
  browserListPages,
  browserLogs,
  browserOpen,
  browserRead,
  browserReload,
  browserScreenshot,
  browserSwitchPage,
} from '@/utils/browser/controller'
import { DEFAULT_TOOL_DESCRIPTIONS } from './toolDescriptions'

const targetFields = {
  selector: z.string().optional().describe('CSS selector for the target element.'),
  text: z.string().optional().describe('Visible text to match when a selector is not available.'),
  index: z.number().int().min(0).optional().describe('Which match to use when multiple elements match the selector or text. Default: 0.'),
}

function wrapExecute<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    try {
      return await fn(args)
    }
    catch (err) {
      if (err instanceof Error)
        throw err

      const raw = String(err)
      const cleaned = raw.replace(/^undefined:\s*/, '').replace(/\nundefined$/, '').trim()
      throw new Error(cleaned || 'Unknown browser error')
    }
  }
}

export function createBrowserTools(ownerId: string) {
  return {
    browser_open: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_open,
      inputSchema: z.object({
        url: z.string().min(1).describe('URL, domain, localhost address, or search query to open.'),
        newTab: z.boolean().optional().describe('Open in a new browser tab within this chat tab. Default: false.'),
      }),
      execute: wrapExecute(async ({ url, newTab = false }) => browserOpen(ownerId, url, { newTab })),
    }),

    browser_tabs: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_tabs,
      inputSchema: z.object({
        action: z.enum(['list', 'new', 'switch', 'close']),
        pageId: z.string().optional().describe('Browser page ID to switch to or close. Get this from action="list".'),
      }),
      execute: wrapExecute(async ({ action, pageId }) => {
        switch (action) {
          case 'list':
            return { pages: browserListPages(ownerId) }
          case 'new':
            return browserCreateBlankPage(ownerId)
          case 'switch':
            if (!pageId)
              throw new Error('browser_tabs action="switch" requires pageId')
            return browserSwitchPage(ownerId, pageId)
          case 'close':
            if (!pageId)
              throw new Error('browser_tabs action="close" requires pageId')
            return { pages: await browserClosePage(ownerId, pageId) }
        }
      }),
    }),

    browser_read: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_read,
      inputSchema: z.object({
        mode: z.enum(['snapshot', 'element']),
        ...targetFields,
        maxItems: z.number().int().min(1).max(40).optional().describe('Max number of headings/links/buttons/inputs to include in snapshot mode.'),
        maxChars: z.number().int().min(200).max(12000).optional().describe('Max text length to include in the returned page excerpt or element dump.'),
        timeoutMs: z.number().int().min(250).max(30000).optional().describe('How long to wait for the DOM to become ready before reading.'),
      }),
      execute: wrapExecute(async ({ mode, ...rest }) => browserRead(ownerId, mode, rest)),
    }),

    browser_act: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_act,
      inputSchema: z.object({
        action: z.enum(['click', 'type', 'press', 'scroll', 'wait']),
        ...targetFields,
        value: z.string().optional().describe('Text to type for action="type".'),
        replace: z.boolean().optional().describe('Clear the field before typing. Default: true.'),
        submit: z.boolean().optional().describe('Press Enter after typing. Default: true. Pass false to type without submitting.'),
        key: z.string().optional().describe(
          'Key for action="press". Plain keys: Enter, Escape, Tab, Backspace, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12. '
          + 'Modifier combos: Ctrl+C, Ctrl+A, Ctrl+Z, Meta+R, Shift+Tab, Alt+F4, etc.',
        ),
        direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Scroll direction for action="scroll".'),
        amount: z.number().int().min(1).optional().describe('Pixel amount for action="scroll".'),
        urlContains: z.string().optional().describe('For action="wait": wait until the current URL contains this text.'),
        selectorAppears: z.string().optional().describe('For action="wait": wait until this CSS selector exists in the DOM.'),
        selectorDisappears: z.string().optional().describe('For action="wait": wait until this CSS selector is removed from the DOM.'),
        timeoutMs: z.number().int().min(250).max(30000).optional().describe('Timeout in ms for wait operations. Default: 5000.'),
      }),
      execute: wrapExecute(async ({ action, ...rest }) => {
        if (action === 'type' && typeof rest.value !== 'string')
          throw new Error('browser_act action="type" requires a "value" string')
        if (action === 'press' && typeof rest.key !== 'string')
          throw new Error('browser_act action="press" requires a "key" string (e.g. "Enter", "Ctrl+A")')
        if (action === 'scroll' && !rest.direction)
          throw new Error('browser_act action="scroll" requires a "direction" (up | down | top | bottom)')
        if (action === 'wait' && !rest.urlContains && !rest.selectorAppears && !rest.selectorDisappears)
          throw new Error('browser_act action="wait" requires at least one of: urlContains, selectorAppears, selectorDisappears')

        const result = await browserAct(ownerId, action, rest)

        if (action === 'type' && rest.submit !== false)
          await browserAct(ownerId, 'press', { key: 'Enter' })

        return result
      }),
    }),

    browser_history: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_history,
      inputSchema: z.object({
        action: z.enum(['back', 'forward', 'reload']),
      }),
      execute: wrapExecute(async ({ action }) => {
        switch (action) {
          case 'back':
            return browserGoHistory(ownerId, 'back')
          case 'forward':
            return browserGoHistory(ownerId, 'forward')
          case 'reload':
            return browserReload(ownerId)
        }
      }),
    }),

    browser_screenshot: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_screenshot,
      inputSchema: z.object({}),
      execute: wrapExecute(async () => browserScreenshot(ownerId)),
    }),

    browser_execute: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_execute,
      inputSchema: z.object({
        script: z.string().min(1).describe(
          'JavaScript to execute. Use return to produce a value. '
          + 'The script runs as an async function body, so await is valid.',
        ),
      }),
      execute: wrapExecute(async ({ script }) => browserExecuteScript(ownerId, script)),
    }),

    browser_cookies: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_cookies,
      inputSchema: z.object({
        action: z.enum(['get', 'set', 'delete']),
        url: z.string().optional().describe('URL filter for get/delete. Defaults to the active page URL.'),
        cookie: z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional().describe('Default: /'),
          expires: z.number().optional().describe('Unix timestamp (seconds). Omit for session cookie.'),
          httpOnly: z.boolean().optional(),
          secure: z.boolean().optional(),
          sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
        }).optional().describe('Cookie to create/overwrite. Required for action="set".'),
        name: z.string().optional().describe('Cookie name to delete. Omit to delete all cookies for the URL.'),
      }),
      execute: wrapExecute(async ({ action, url, cookie, name }) =>
        browserCookies(ownerId, action, { url, cookie, name }),
      ),
    }),

    browser_logs: tool({
      description: DEFAULT_TOOL_DESCRIPTIONS.browser_logs,
      inputSchema: z.object({
        clear: z.boolean().optional().describe('Clear the logs array after retrieving them. Default: true.'),
      }),
      execute: wrapExecute(async ({ clear = true }) => browserLogs(ownerId, clear)),
    }),
  } as const
}

export function browserToolDisplayLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'browser_open':
      return `Open ${String(args.url ?? '').slice(0, 50)}`
    case 'browser_tabs': {
      const action = String(args.action ?? 'list')
      return action === 'list' ? 'List browser tabs' : `Tab: ${action}`
    }
    case 'browser_read':
      return `Read page (${String(args.mode ?? 'snapshot')})`
    case 'browser_act': {
      const action = String(args.action ?? '')
      if (action === 'type' && args.value)
        return `Type "${String(args.value).slice(0, 30)}"`
      if (action === 'click' && (args.selector || args.text))
        return `Click ${String(args.selector ?? args.text ?? '').slice(0, 40)}`
      if (action === 'press')
        return `Press ${String(args.key ?? '')}`
      if (action === 'scroll')
        return `Scroll ${String(args.direction ?? '')}`
      if (action === 'wait') {
        return `Wait for ${args.urlContains
          ? `URL "${String(args.urlContains).slice(0, 30)}"`
          : args.selectorAppears
            ? `"${String(args.selectorAppears).slice(0, 30)}"`
            : 'condition'}`
      }
      return `Browser ${action}`
    }
    case 'browser_history':
      return `Browser ${String(args.action ?? 'reload')}`
    case 'browser_screenshot':
      return 'Screenshot page'
    case 'browser_execute':
      return `Execute JS: ${String(args.script ?? '').slice(0, 40)}`
    case 'browser_cookies':
      return `Cookies: ${String(args.action ?? 'get')}`
    case 'browser_logs':
      return 'Get console logs'
    default:
      return `Called ${toolName}`
  }
}
