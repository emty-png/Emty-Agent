// ── models.dev provider ID map ─────────────────────────────────────────────────
// Maps our preset names → the exact folder name in models.dev's providers/ dir.
// Icon URL: https://models.dev/logos/{mdevId}.svg
// If a provider isn't in models.dev, the CDN returns a generic fallback icon.

export const PRESET_MDEV_IDS: Record<string, string> = {
  Ollama: 'ollama',
  'LM Studio': 'lmstudio',
  Groq: 'groq',
  Mistral: 'mistral',
  'Together AI': 'togetherai',
  Deepseek: 'deepseek',
  Perplexity: 'perplexity',
  'Fireworks AI': 'fireworks',
  OpenRouter: 'openrouter',
  Cerebras: 'cerebras',
  'xAI Grok': 'xai',
  'Novita AI': 'novita',
  Anyscale: 'anyscale',
}

// Core provider IDs used by the three first-party providers
export const CORE_MDEV_IDS: Record<string, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
}
