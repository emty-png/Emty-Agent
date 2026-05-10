export const emberDark = {
  name: 'ember-dark',
  type: 'dark' as const,
  colors: {
    'editor.background': 'var(--color-bg-base)',
    'editor.foreground': 'var(--color-text-primary)',
    'editor.lineHighlightBackground': 'var(--color-bg-surface)',
    'editor.selectionBackground': 'var(--color-accent-muted-plus)',
    'editorLineNumber.foreground': 'var(--color-border-mid)',
    'editorLineNumber.activeForeground': 'var(--color-text-dim)',
  },
  tokenColors: [
    // ── base ──────────────────────────────────────────────────────────────────
    {
      scope: [''],
      settings: { foreground: 'var(--color-syntax-base)' },
    },

    // ── comments ──────────────────────────────────────────────────────────────
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: 'var(--color-syntax-comment)', fontStyle: 'italic' },
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
      settings: { foreground: 'var(--color-syntax-keyword)' },
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
      settings: { foreground: 'var(--color-syntax-storage)' },
    },

    // ── strings ───────────────────────────────────────────────────────────────
    {
      scope: ['string', 'string.quoted', 'string.template', 'string.regexp'],
      settings: { foreground: 'var(--color-syntax-string)' },
    },
    {
      scope: ['punctuation.definition.string'],
      settings: { foreground: 'var(--color-syntax-string-punct)' },
    },

    // ── template expression ───────────────────────────────────────────────────
    {
      scope: ['punctuation.definition.template-expression'],
      settings: { foreground: 'var(--color-syntax-operator)' },
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
      settings: { foreground: 'var(--color-syntax-number)' },
    },

    // ── constants / enum members ──────────────────────────────────────────────
    {
      scope: ['constant', 'variable.other.constant', 'support.constant'],
      settings: { foreground: 'var(--color-syntax-number)' },
    },

    // ── function names ─────────────────────────────────────────────────────────
    {
      scope: ['entity.name.function', 'meta.function-call.generic', 'support.function'],
      settings: { foreground: 'var(--color-syntax-function)' },
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
      settings: { foreground: 'var(--color-syntax-type)' },
    },

    // ── type parameters / generics ────────────────────────────────────────────
    {
      scope: ['entity.name.type.type-parameter'],
      settings: { foreground: 'var(--color-syntax-generic)' },
    },

    // ── decorators ────────────────────────────────────────────────────────────
    {
      scope: ['meta.decorator', 'entity.name.function.decorator'],
      settings: { foreground: 'var(--color-syntax-operator)' },
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
      settings: { foreground: 'var(--color-syntax-operator)' },
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
      settings: { foreground: 'var(--color-syntax-punct)' },
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
      settings: { foreground: 'var(--color-syntax-base)' },
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
      settings: { foreground: 'var(--color-syntax-base)' },
    },

    // ── HTML / JSX / Vue tags ─────────────────────────────────────────────────
    {
      scope: ['entity.name.tag', 'meta.tag.sgml', 'markup.deleted.git_gutter'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: { foreground: 'var(--color-syntax-number)' },
    },

    // ── CSS ───────────────────────────────────────────────────────────────────
    {
      scope: ['entity.name.tag.css', 'entity.other.attribute-name.pseudo-class'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },
    {
      scope: ['support.type.property-name.css'],
      settings: { foreground: 'var(--color-syntax-function)' },
    },
    {
      scope: ['constant.other.color', 'support.constant.property-value.css'],
      settings: { foreground: 'var(--color-syntax-string)' },
    },

    // ── imports / modules ─────────────────────────────────────────────────────
    {
      scope: ['keyword.control.import', 'keyword.control.export', 'keyword.control.from'],
      settings: { foreground: 'var(--color-syntax-keyword)' },
    },

    // ── Rust-specific ─────────────────────────────────────────────────────────
    {
      scope: ['entity.name.type.primitive.rust', 'storage.type.rust'],
      settings: { foreground: 'var(--color-syntax-generic)' },
    },
    {
      scope: ['keyword.operator.macro.dollar.rust', 'entity.name.function.macro.rust'],
      settings: { foreground: 'var(--color-syntax-operator)' },
    },

    // ── TOML ─────────────────────────────────────────────────────────────────
    {
      scope: ['keyword.key.toml', 'support.type.property-name.toml'],
      settings: { foreground: 'var(--color-syntax-function)' },
    },

    // ── Markdown ─────────────────────────────────────────────────────────────
    {
      scope: ['markup.heading', 'entity.name.section.markdown'],
      settings: { foreground: 'var(--color-syntax-keyword)', fontStyle: 'bold' },
    },
    {
      scope: ['markup.italic'],
      settings: { foreground: 'var(--color-syntax-base)', fontStyle: 'italic' },
    },
    {
      scope: ['markup.bold'],
      settings: { foreground: 'var(--color-syntax-base)', fontStyle: 'bold' },
    },
    {
      scope: ['markup.inline.raw', 'markup.fenced_code'],
      settings: { foreground: 'var(--color-syntax-base)' },
    },
    {
      scope: ['markup.underline.link'],
      settings: { foreground: 'var(--color-syntax-function)' },
    },

    // ── invalid ───────────────────────────────────────────────────────────────
    {
      scope: ['invalid', 'invalid.illegal'],
      settings: { foreground: 'var(--color-syntax-generic)', fontStyle: 'underline' },
    },
  ],
}
