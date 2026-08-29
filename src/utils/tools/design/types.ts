import type { DesignProjectType } from '@/stores/chat/core/types'

export type ActiveDesignGetter = () => { path: string; name: string } | null
export type ActiveProjectGetter = () => { path: string; name: string; type: DesignProjectType } | null
