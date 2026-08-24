/**
 * Centralized platform detection for security logic.
 * Sync version uses navigator + process fallback; async version prefers Tauri plugin-os.
 */

export type SecurityPlatform = 'windows' | 'linux' | 'macos' | 'unknown'

export function getPlatformSync(): SecurityPlatform {
  if (typeof navigator !== 'undefined') {
    const nav: unknown = navigator as unknown
    const platformStr = (nav as { platform?: string })?.platform?.toLowerCase() ?? ''
    const uaStr = (nav as { userAgent?: string })?.userAgent?.toLowerCase() ?? ''
    const combined = `${platformStr} ${uaStr}`
    if (combined.includes('win'))
      return 'windows'
    if (combined.includes('mac'))
      return 'macos'
    if (combined.includes('linux') || combined.includes('x11'))
      return 'linux'
  }
  // eslint-disable-next-line node/prefer-global/process
  const maybeProcess = (globalThis as unknown as { process?: { platform?: string } }).process
  if (maybeProcess?.platform) {
    const p = maybeProcess.platform
    if (p === 'win32')
      return 'windows'
    if (p === 'darwin')
      return 'macos'
    if (p === 'linux')
      return 'linux'
  }
  return 'unknown'
}

export async function getPlatformAsync(): Promise<SecurityPlatform> {
  try {
    const { platform } = await import('@tauri-apps/plugin-os')
    const p = await platform()
    if (p === 'windows')
      return 'windows'
    if (p === 'macos')
      return 'macos'
    if (p === 'linux')
      return 'linux'
  }
  catch {
    // fallback to sync
  }
  return getPlatformSync()
}
