import type { SelectedSkill, SkillMetadata } from './types'
import { STOP_WORDS } from './constants'

export function selectRelevantSkills(
  skills: SkillMetadata[],
  requestText: string,
  maxSkills = 3,
): SelectedSkill[] {
  return skills
    .map(skill => scoreSkill(skill, requestText))
    .filter((skill): skill is SelectedSkill => skill != null)
    .sort((a, b) => {
      if (b.score !== a.score)
        return b.score - a.score
      if (a.skill.source !== b.skill.source)
        return a.skill.source === 'builtin' ? -1 : 1
      return a.skill.title.localeCompare(b.skill.title)
    })
    .slice(0, maxSkills)
}

export function scoreSkill(skill: SkillMetadata, requestText: string): SelectedSkill | null {
  const normalizedRequest = requestText.toLowerCase()
  const matches: string[] = []
  let score = 0

  for (const term of uniqueTerms(skill)) {
    if (!normalizedRequest.includes(term))
      continue

    matches.push(term)
    score += term.includes(' ') ? 4 : 2
  }

  if (skill.id === 'builtin:frontend-design' && /\b(?:ui|ux|frontend|front-end|design|layout|component|theme|responsive|css|tailwind)\b/i.test(requestText))
    score += 6

  if (skill.id === 'builtin:skill-factory' && /\b(?:skill|skills|skill factory|SKILL\.md|agent capability)\b/i.test(requestText))
    score += 6

  if (score === 0)
    return null

  return {
    skill,
    matches: [...new Set(matches)].slice(0, 6),
    score,
  }
}

export function uniqueTerms(skill: SkillMetadata): string[] {
  const terms = new Set<string>()

  for (const phrase of skill.triggers)
    terms.add(phrase.toLowerCase())

  for (const phrase of skill.tags)
    terms.add(phrase.toLowerCase())

  terms.add(skill.name.toLowerCase())
  terms.add(skill.title.toLowerCase())

  for (const token of tokenize(skill.title))
    terms.add(token)

  return [...terms]
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+/.-]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token))
}
