import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: true,
    formatters: true,
  },

  // ── core rules (all files) ──────────────────────────────────────────────────
  {
    rules: {
      // style
      'no-console': 'warn',
      'style/semi': ['error', 'never'],
      'style/quotes': ['error', 'single', { avoidEscape: true }],
      'style/quote-props': ['error', 'as-needed'],
      'style/max-statements-per-line': ['error', { max: 2 }],
      'style/member-delimiter-style': ['error', { multiline: { delimiter: 'none' } }],
      'style/arrow-parens': ['error', 'as-needed'],

      // imports
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'import/order': 'off', // antfu handles this via perfectionist

      // typescript
      'ts/no-explicit-any': 'warn',
      'ts/consistent-type-imports': 'off',
      'ts/no-import-type-side-effects': 'off',

      // general quality
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'always'],
      'no-useless-rename': 'error',
      'no-param-reassign': 'warn',
    },
  },

  // ── vue-only rules ──────────────────────────────────────────────────────────
  {
    files: ['**/*.vue'],
    rules: {
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/define-macros-order': ['error', { order: ['defineOptions', 'defineProps', 'defineEmits', 'defineSlots'] }],
      'vue/no-unused-refs': 'warn',
      'vue/padding-line-between-blocks': ['error', 'always'],
    },
  },

  // ── markdown overrides ──────────────────────────────────────────────────────
  {
    files: ['**/*.md'],
    rules: {
      'markdown/no-multiple-h1': 'off',
    },
  },

  // ── ignores ──────────────────────────────────────────────────────────────────
  {
    ignores: [
      'dist',
      'src-tauri',
      'coverage',
      'node_modules',
      '*.local',
      '*.d.ts',
      'vite.config.*',
    ],
  },
)
