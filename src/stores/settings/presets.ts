import type { ProviderPreset } from './types'

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    requiresKey: false,
    description: 'Local models on your machine',
  },
  {
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    requiresKey: false,
    description: 'Local model server with a UI',
  },
  {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    description: 'Ultra-fast LPU inference',
  },
  {
    name: 'Mistral',
    baseURL: 'https://api.mistral.ai/v1',
    requiresKey: true,
    description: 'European frontier models',
  },
  {
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    requiresKey: true,
    description: 'Open-source model catalogue',
  },
  {
    name: 'Deepseek',
    baseURL: 'https://api.deepseek.com/v1',
    requiresKey: true,
    description: 'Powerful reasoning models',
  },
  {
    name: 'Perplexity',
    baseURL: 'https://api.perplexity.ai',
    requiresKey: true,
    description: 'Search-augmented generation',
  },
  {
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    requiresKey: true,
    description: 'Fast serverless inference',
  },
  {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    description: '300+ models, one API key',
  },
  {
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    requiresKey: true,
    description: 'Wafer-scale AI chips',
  },
  {
    name: 'xAI Grok',
    baseURL: 'https://api.x.ai/v1',
    requiresKey: true,
    description: 'Grok models by xAI',
  },
  {
    name: 'Novita AI',
    baseURL: 'https://api.novita.ai/v3/openai',
    requiresKey: true,
    description: 'Affordable open-model hosting',
  },
  {
    name: 'Anyscale',
    baseURL: 'https://api.endpoints.anyscale.com/v1',
    requiresKey: true,
    description: 'Scalable model endpoints',
  },
]
