import { BUILD_BASE } from '@/prompts/build'
import { COMMIT_BASE } from '@/prompts/commit'
import { DESIGN_BASE } from '@/prompts/design'
import { PLAN_BASE } from '@/prompts/plan'
import { COMPACTION_SYSTEM } from '@/stores/chat/context/compaction'
import {
  DEBUGGER_BASE,
  EXPLORER_BASE,
  GENERAL_BASE,
  RESEARCHER_BASE,
} from '@/utils/tools/subagent'

export interface PromptItem {
  id: string
  label: string
  content: string
  group?: string
  description?: string
}

export const SYSTEM_PROMPTS: PromptItem[] = [
  {
    id: 'build',
    label: 'Build',
    content: BUILD_BASE,
    group: 'Agent Modes',
    description: 'Primary coding and problem solving system prompt.',
  },
  {
    id: 'plan',
    label: 'Plan',
    content: PLAN_BASE,
    group: 'Agent Modes',
    description: 'Codebase exploration and implementation planning prompt.',
  },
  {
    id: 'design',
    label: 'Design',
    content: DESIGN_BASE,
    group: 'Agent Modes',
    description: 'Frontend design and HTML/CSS/JS prototyping prompt.',
  },
  {
    id: 'commit',
    label: 'Commit Message',
    content: COMMIT_BASE,
    group: 'Agent Modes',
    description: 'Git commit message generation prompt.',
  },
  {
    id: 'subagent-explorer',
    label: 'SubAgent: Explorer',
    content: EXPLORER_BASE,
    group: 'Sub-Agents',
    description: 'Read-only codebase investigator subagent prompt.',
  },
  {
    id: 'subagent-researcher',
    label: 'SubAgent: Researcher',
    content: RESEARCHER_BASE,
    group: 'Sub-Agents',
    description: 'Web research and synthesis subagent prompt.',
  },
  {
    id: 'subagent-debugger',
    label: 'SubAgent: Debugger',
    content: DEBUGGER_BASE,
    group: 'Sub-Agents',
    description: 'Root cause bug investigation subagent prompt.',
  },
  {
    id: 'subagent-general',
    label: 'SubAgent: General',
    content: GENERAL_BASE,
    group: 'Sub-Agents',
    description: 'Full-capability general purpose subagent prompt.',
  },
  {
    id: 'compaction',
    label: 'Context Compaction',
    content: COMPACTION_SYSTEM,
    group: 'System',
    description: 'Conversation context summarization and compression prompt.',
  },
]
