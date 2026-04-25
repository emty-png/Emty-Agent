function extToLang(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    vue: 'vue',
    svelte: 'svelte',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    rb: 'ruby',
    php: 'php',
    cs: 'csharp',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'css',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    xml: 'xml',
    swift: 'swift',
    dart: 'dart',
    lua: 'lua',
  }
  return map[ext.toLowerCase()] ?? ''
}

export function parseAtMentions(text: string): string[] {
  const seen = new Set<string>()
  const results: string[] = []
  const regex = /@([\w./\-]+)/g
  let match: RegExpExecArray | null = regex.exec(text)
  while (match !== null) {
    const path = match[1]!
    if (!seen.has(path)) {
      seen.add(path)
      results.push(path)
    }
    match = regex.exec(text)
  }
  return results
}

export async function buildMentionContext(messageText: string, projectPath: string | null): Promise<string> {
  if (!projectPath)
    return ''
  const paths = parseAtMentions(messageText)
  if (paths.length === 0)
    return ''

  const { readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
  const { join, normalize } = await import('@tauri-apps/api/path')

  const normProject = await normalize(projectPath)
  const sep = normProject.includes('\\') ? '\\' : '/'
  const projectDir = normProject.endsWith(sep) ? normProject : normProject + sep
  const SKIP = new Set(['node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', '__pycache__', '.venv', 'venv', 'target', '.cargo'])

  const blocks: string[] = [
    '<context>',
    'The user has referenced the following files/directories. Read and use this context before responding:',
  ]

  for (const rawPath of paths) {
    const isDir = rawPath.endsWith('/')
    const cleanPath = isDir ? rawPath.slice(0, -1) : rawPath
    try {
      const absPath = await join(projectPath, cleanPath)
      const norm = await normalize(absPath)
      if (norm !== normProject && !norm.startsWith(projectDir))
        continue

      if (isDir) {
        let items: Awaited<ReturnType<typeof readDir>>
        try { items = await readDir(norm) }
        catch { continue }
        const lines = [`\n@${rawPath} (directory listing):`]
        const dirs = items.filter(i => i.isDirectory && i.name && !SKIP.has(i.name!)).sort((a, b) => a.name!.localeCompare(b.name!))
        const files = items.filter(i => !i.isDirectory && i.name).sort((a, b) => a.name!.localeCompare(b.name!))
        for (const d of dirs) lines.push(`   ${d.name}/`)
        for (const f of files) lines.push(`   ${f.name}`)
        blocks.push(lines.join('\n'))
      }
      else {
        let content: string
        try { content = await readTextFile(norm) }
        catch { continue }
        const ext = cleanPath.split('.').pop() ?? ''
        const lang = extToLang(ext)
        const MAX = 40_000
        const trimmed = content.length > MAX
          ? `${content.slice(0, MAX / 2).trimEnd()}\n\n[... ${Math.round(content.length / 1024)} KB file trimmed ...]\n\n${content.slice(-(MAX / 2)).trimStart()}`
          : content
        blocks.push(`\n@${rawPath}:\n\`\`\`${lang}\n${trimmed}\n\`\`\``)
      }
    }
    catch { continue }
  }

  if (blocks.length === 2)
    return ''
  blocks.push('</context>')
  return blocks.join('\n')
}
