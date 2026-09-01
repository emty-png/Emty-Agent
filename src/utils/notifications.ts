import type { PendingToolPermission } from '@/stores/chat/core/types'

const NOTIFICATION_TITLE = 'Awaiting Permission'

function buildPermissionBody(
  perm: Pick<PendingToolPermission, 'toolName' | 'toolLabel' | 'actionTitle' | 'actionDetails'>,
  queueCount: number,
): string {
  const label = perm.toolLabel?.trim()
  const base = label && !label.startsWith('Called ') ? label : perm.actionTitle.trim()
  const withQueue = queueCount > 1 ? `${base} (+${queueCount - 1} more)` : base
  return withQueue.length > 120 ? `${withQueue.slice(0, 117)}...` : withQueue
}

let lastNotificationAt = 0

export async function sendPermissionNotification(
  perm: Pick<PendingToolPermission, 'toolName' | 'toolLabel' | 'actionTitle' | 'actionDetails'>,
  queueCount = 1,
): Promise<void> {
  const now = Date.now()
  if (now - lastNotificationAt < 600)
    return
  lastNotificationAt = now

  const title = NOTIFICATION_TITLE
  const body = buildPermissionBody(perm, queueCount)

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
    let granted = await isPermissionGranted()
    if (!granted) {
      const res = await requestPermission()
      granted = res === 'granted'
    }
    if (granted) {
      sendNotification({ title, body })
      return
    }
  }
  catch {}

  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        // eslint-disable-next-line no-new -- Web Notification fallback
        new Notification(title, { body })
        return
      }
      if (Notification.permission !== 'denied') {
        const p = await Notification.requestPermission()
        if (p === 'granted')
          // eslint-disable-next-line no-new
          new Notification(title, { body })
      }
    }
  }
  catch {}
}
