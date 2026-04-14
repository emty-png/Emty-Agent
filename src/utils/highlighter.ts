import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'

// ── custom ember-dark theme ───────────────────────────────────────────────────
const emberDark = {
  name: 'ember-dark',
  type: 'dark' as const,
  colors: {
    'editor.background': '#0c0a08',
    'editor.foreground': '#ede5d8',
    'editor.lineHighlightBackground': '#111009',
    'editor.selectionBackground': '#e0783022',
    'editorLineNumber.foreground': '#2e2618',
    'editorLineNumber.activeForeground': '#504438',
  },
  tokenColors: [
    // ── base ──────────────────────────────────────────────────────────────────
    {
      scope: [''],
      settings: { foreground: '#ede5d8' },
    },

    // ── comments ──────────────────────────────────────────────────────────────
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#504438', fontStyle: 'italic' },
    },

    // ── keywords ──────────────────────────────────────────────────────────────
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.delete',
        'keyword.operator.typeof',
        'keyword.operator.void',
        'keyword.operator.instanceof',
        'keyword.operator.in',
        'keyword.operator.of',
        'storage.modifier',
      ],
      settings: { foreground: '#f0a060' },
    },

    // ── storage types (class, function, var) ───────────────────────────────────
    {
      scope: [
        'storage.type',
        'storage.type.class',
        'storage.type.function',
        'storage.type.interface',
        'storage.type.enum',
        'storage.type.type',
      ],
      settings: { foreground: '#e07830' },
    },

    // ── strings ───────────────────────────────────────────────────────────────
    {
      scope: [
        'string',
        'string.quoted',
        'string.template',
        'string.regexp',
      ],
      settings: { foreground: '#88be94' },
    },
    {
      scope: ['punctuation.definition.string'],
      settings: { foreground: '#5e9468' },
    },

    // ── template expression ───────────────────────────────────────────────────
    {
      scope: ['punctuation.definition.template-expression'],
      settings: { foreground: '#c8651f' },
    },

    // ── numbers / booleans / null ─────────────────────────────────────────────
    {
      scope: [
        'constant.numeric',
        'constant.language.boolean',
        'constant.language.null',
        'constant.language.undefined',
        'constant.language.nan',
        'constant.language.infinity',
      ],
      settings: { foreground: '#d4aa68' },
    },

    // ── constants / enum members ──────────────────────────────────────────────
    {
      scope: [
        'constant',
        'variable.other.constant',
        'support.constant',
      ],
      settings: { foreground: '#d4aa68' },
    },

    // ── function names ─────────────────────────────────────────────────────────
    {
      scope: [
        'entity.name.function',
        'meta.function-call.generic',
        'support.function',
      ],
      settings: { foreground: '#90cce0' },
    },

    // ── types / classes / interfaces ──────────────────────────────────────────
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.name.interface',
        'entity.name.enum',
        'entity.other.inherited-class',
        'support.class',
        'support.type',
      ],
      settings: { foreground: '#d4aa68' },
    },

    // ── type parameters / generics ────────────────────────────────────────────
    {
      scope: ['entity.name.type.type-parameter'],
      settings: { foreground: '#d88080' },
    },

    // ── decorators ────────────────────────────────────────────────────────────
    {
      scope: ['meta.decorator', 'entity.name.function.decorator'],
      settings: { foreground: '#c8651f' },
    },

    // ── operators ─────────────────────────────────────────────────────────────
    {
      scope: [
        'keyword.operator',
        'keyword.operator.arithmetic',
        'keyword.operator.assignment',
        'keyword.operator.comparison',
        'keyword.operator.logical',
        'keyword.operator.bitwise',
        'keyword.operator.ternary',
        'keyword.operator.optional',
        'keyword.operator.rest',
        'keyword.operator.spread',
        'keyword.operator.type',
      ],
      settings: { foreground: '#c8651f' },
    },

    // ── punctuation ───────────────────────────────────────────────────────────
    {
      scope: [
        'punctuation',
        'punctuation.separator',
        'punctuation.terminator',
        'punctuation.accessor',
        'meta.brace',
      ],
      settings: { foreground: '#8a7868' },
    },

    // ── variables / parameters ────────────────────────────────────────────────
    {
      scope: [
        'variable',
        'variable.other',
        'variable.other.readwrite',
        'variable.parameter',
        'meta.parameter',
      ],
      settings: { foreground: '#ede5d8' },
    },

    // ── properties / members ──────────────────────────────────────────────────
    {
      scope: [
        'variable.other.property',
        'variable.other.object.property',
        'support.variable.property',
        'meta.object-literal.key',
        'entity.name.tag.yaml',
      ],
      settings: { foreground: '#ede5d8' },
    },

    // ── HTML / JSX / Vue tags ─────────────────────────────────────────────────
    {
      scope: [
        'entity.name.tag',
        'meta.tag.sgml',
        'markup.deleted.git_gutter',
      ],
      settings: { foreground: '#f0a060' },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: '#d4aa68' },
    },

    // ── CSS ───────────────────────────────────────────────────────────────────
    {
      scope: ['entity.name.tag.css', 'entity.other.attribute-name.pseudo-class'],
      settings: { foreground: '#f0a060' },
    },
    {
      scope: ['support.type.property-name.css'],
      settings: { foreground: '#90cce0' },
    },
    {
      scope: ['constant.other.color', 'support.constant.property-value.css'],
      settings: { foreground: '#88be94' },
    },

    // ── imports / modules ─────────────────────────────────────────────────────
    {
      scope: ['keyword.control.import', 'keyword.control.export', 'keyword.control.from'],
      settings: { foreground: '#f0a060' },
    },

    // ── Rust-specific ─────────────────────────────────────────────────────────
    {
      scope: ['entity.name.type.primitive.rust', 'storage.type.rust'],
      settings: { foreground: '#d88080' },
    },
    {
      scope: ['keyword.operator.macro.dollar.rust', 'entity.name.function.macro.rust'],
      settings: { foreground: '#c8651f' },
    },

    // ── TOML ─────────────────────────────────────────────────────────────────
    {
      scope: ['keyword.key.toml', 'support.type.property-name.toml'],
      settings: { foreground: '#90cce0' },
    },

    // ── Markdown ─────────────────────────────────────────────────────────────
    {
      scope: ['markup.heading', 'entity.name.section.markdown'],
      settings: { foreground: '#f0a060', fontStyle: 'bold' },
    },
    {
      scope: ['markup.italic'],
      settings: { foreground: '#ede5d8', fontStyle: 'italic' },
    },
    {
      scope: ['markup.bold'],
      settings: { foreground: '#ede5d8', fontStyle: 'bold' },
    },
    {
      scope: ['markup.inline.raw', 'markup.fenced_code'],
      settings: { foreground: '#88c0d8' },
    },
    {
      scope: ['markup.underline.link'],
      settings: { foreground: '#90cce0' },
    },

    // ── invalid ───────────────────────────────────────────────────────────────
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: '#d88080', fontStyle: 'underline' },
    },
  ],
}

// ── languages to pre-load ─────────────────────────────────────────────────────
const LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'vue',
  'html',
  'css',
  'scss',
  'json',
  'jsonc',
  'yaml',
  'toml',
  'rust',
  'python',
  'bash',
  'sh',
  'markdown',
  'mdx',
  'sql',
  'graphql',
  'diff',
  'plaintext',
] as const

// ── singleton ─────────────────────────────────────────────────────────────────
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
  }).then(h => {
    instance = h
    return h
  }).catch(err => {
    initPromise = null
    throw err
  })

  return initPromise
}

// ── extension → language map ──────────────────────────────────────────────────
const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  vue: 'vue',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  rs: 'rust',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  md: 'markdown',
  mdx: 'mdx',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  env: 'bash',
  lock: 'plaintext',
}

export function langFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MAP[ext] ?? 'plaintext'
}
