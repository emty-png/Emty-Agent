export function designProjectToolDisplayLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'create_screen') {
    const design = typeof args.design === 'string' ? args.design : ''
    const screen = typeof args.screen === 'string' ? args.screen : ''
    const viewport = typeof args.viewport === 'string' ? ` (${args.viewport})` : ''
    if (design && screen)
      return `Creating screen "${screen}"${viewport} in "${design}"`
    if (screen)
      return `Creating screen "${screen}"${viewport}`
    return 'Creating screen'
  }
  if (name === 'delete_screens') {
    const screens = Array.isArray(args.screens) ? (args.screens as string[]).filter((s): s is string => typeof s === 'string') : []
    if (screens.length === 0) {
      const design = typeof args.design === 'string' ? args.design : ''
      return design ? `Deleting screens in "${design}"` : 'Deleting screens'
    }
    if (screens.length === 1)
      return `Deleting screen "${screens[0]}"`
    return `Deleting ${screens.length} screens: ${screens.join(', ')}`
  }
  if (name === 'edit_design') {
    const edits = Array.isArray((args as Record<string, unknown>).edits) ? (args as Record<string, unknown>).edits as unknown[] : null
    if (edits)
      return `Editing ${edits.length} screen(s)`
    const files = Array.isArray(args.files) ? args.files : []
    const screen = typeof args.screen === 'string' ? args.screen : ''
    return screen ? `Editing ${files.length} file${files.length !== 1 ? 's' : ''} in "${screen}"` : `Editing ${files.length} file${files.length !== 1 ? 's' : ''}`
  }
  if (name === 'screenshot_screen') {
    const screen = typeof args.screen === 'string' ? args.screen : ''
    return screen ? `Capturing screenshot of "${screen}"` : 'Capturing screenshot'
  }
  if (name === 'refresh_preview')
    return 'Refreshing preview'
  if (name === 'get_console')
    return 'Reading console output'
  if (name === 'read_design') {
    const reads = Array.isArray((args as Record<string, unknown>).reads) ? (args as Record<string, unknown>).reads as unknown[] : null
    if (reads)
      return `Reading ${reads.length} screen(s)`
    const files = Array.isArray(args.file_paths)
      ? args.file_paths.filter((f): f is string => typeof f === 'string')
      : []
    const screen = typeof args.screen === 'string' ? ` in "${args.screen}"` : ''
    return files.length === 1 ? `Reading ${files[0]}${screen}` : `Reading ${files.length} files${screen}`
  }
  return `Called ${name}`
}
