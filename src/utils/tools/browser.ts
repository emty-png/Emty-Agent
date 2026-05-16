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
  browserOpen,
  browserRead,
  browserReload,
  browserScreenshot,
  browserSwitchPage,
} from '@/utils/browser/controller'

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
      description: `\
Open a URL inside the built-in Emty Agent browser for the current chat tab.
This browser is embedded inside the app, not an external window, and is isolated per chat tab/browser tab.

Use this when you need a real browser page the agent can later inspect or interact with.
If the input is a plain domain like "vuejs.org", https:// is added automatically.
If the input looks like a search query, it is opened as a DuckDuckGo search.`,
      inputSchema: z.object({
        url: z.string().min(1).describe('URL, domain, localhost address, or search query to open.'),
        newTab: z.boolean().optional().describe('Open in a new browser tab within this chat tab. Default: false.'),
      }),
      execute: wrapExecute(async ({ url, newTab = false }) => browserOpen(ownerId, url, { newTab })),
    }),

    browser_tabs: tool({
      description: `\
Manage the browser tabs that belong to the current chat tab.
Use this to list open browser tabs, create a blank one, switch tabs, or close one.`,
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
      description: `\
Read structured information from the currently active embedded browser page.
Always call this after browser_open or browser_act to verify the page state before proceeding.
Use mode="snapshot" first to understand the page layout before targeting specific elements.
Use mode="element" only when you already know the selector or visible text of your target.`,
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
      description: `\
Interact with the currently active embedded browser page.
Supports clicking, typing, pressing a key, scrolling, and waiting for UI conditions.

IMPORTANT: Always take a snapshot first (browser_read mode="snapshot") so you know what
selectors and visible text are available. If an element is not found, re-read the page -
the DOM may not have loaded yet. Prefer CSS selectors over text matching when stable.

For press: use plain key names ("Enter", "Escape", "Tab", "ArrowDown") or modifier combos
like "Ctrl+A", "Ctrl+C", "Meta+R". Modifier prefixes: Ctrl, Alt, Shift, Meta.`,
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
      description: `\
Move backward or forward within the current browser tab's history, or reload the page.

back/forward use the browser's native history stack, so they work for any in-page
navigation (link clicks, form submits, JS pushState) - not only URLs opened via browser_open.`,
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
      description: `\
Capture a screenshot of the currently active browser page.
Returns a base64-encoded PNG that you can analyse to understand the visual state of the page
(layout, rendered content, CAPTCHA, login walls, etc.).
When a project is open, the PNG is also saved to that project's root folder and the saved path is returned.

Use this when browser_read does not give you enough context about the visual state.
This is a best-effort in-page capture, so sites with strict rendering or security rules may return a degraded image or fail.`,
      inputSchema: z.object({}),
      execute: wrapExecute(async () => browserScreenshot(ownerId)),
    }),

    browser_execute: tool({
      description: `\
Execute arbitrary JavaScript in the current browser page and return the result.

Use this for operations that the standard browser_act / browser_read tools cannot express:
reading computed DOM state, manipulating localStorage/sessionStorage, triggering custom events,
extracting deeply nested data, or calling page-defined JS APIs.

The script runs in the page's main frame. Promises are awaited automatically.
The return value must be JSON-serialisable (objects, arrays, primitives). DOM nodes are not serialisable.

Example: "return document.querySelectorAll('a').length" - returns number of links.
Example: "return localStorage.getItem('token')" - reads a storage value.`,
      inputSchema: z.object({
        script: z.string().min(1).describe(
          'JavaScript to execute. Use return to produce a value. '
          + 'The script runs as an async function body, so await is valid.',
        ),
      }),
      execute: wrapExecute(async ({ script }) => browserExecuteScript(ownerId, script)),
    }),

    browser_cookies: tool({
      description: `\
Get, set, or delete cookies for the current browser page origin.

- get: returns the cookies visible to page JavaScript for the active page URL.
- set: creates or overwrites a cookie. domain is inferred from the active page when omitted.
- delete: removes cookies matching a URL and optional name. Omit name to clear all cookies for that URL.

Useful for injecting auth tokens, reading session state, or cleaning up between tests.
Note: this does not expose HTTP-only cookies because the browser page itself cannot read them.`,
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
    default:
      return `Called ${toolName}`
  }
}
