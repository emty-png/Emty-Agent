const USAGE_KEY = 'emty-skill-usage'

interface SkillUsage {
  skillId: string
  lastUsed: number
  count: number
}

export function recordSkillUsage(skillId: string): void {
  const raw = localStorage.getItem(USAGE_KEY)
  const usage: Record<string, SkillUsage> = raw ? JSON.parse(raw) : {}

  if (usage[skillId]) {
    usage[skillId].lastUsed = Date.now()
    usage[skillId].count++
  }
  else {
    usage[skillId] = { skillId, lastUsed: Date.now(), count: 1 }
  }

  localStorage.setItem(USAGE_KEY, JSON.stringify(usage))
}

export function getSkillUsage(skillId: string): SkillUsage | null {
  const raw = localStorage.getItem(USAGE_KEY)
  if (!raw)
    return null

  const usage: Record<string, SkillUsage> = JSON.parse(raw)
  return usage[skillId] ?? null
}

export function getMostUsedSkills(limit = 5): SkillUsage[] {
  const raw = localStorage.getItem(USAGE_KEY)
  if (!raw)
    return []
  const usage: Record<string, SkillUsage> = JSON.parse(raw)
  return Object.values(usage)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
