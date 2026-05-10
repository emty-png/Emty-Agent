// ── languages to pre-load ─────────────────────────────────────────────────────
export const LANGS = [
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

// ── extension → language map ──────────────────────────────────────────────────
export const EXT_MAP: Record<string, string> = {
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
