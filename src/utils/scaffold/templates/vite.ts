import type { ScaffoldTemplate } from '../templates'

export const VITE_ICONS = {
  vite: '<svg viewBox="0 0 256 257" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M255.153 37.938L134.897 252.976C132.414 257.416 126.035 257.442 123.515 253.024L0.874 37.958C-1.871 33.144 2.246 27.312 7.702 28.287L128.087 49.805C128.855 49.942 129.641 49.941 130.409 49.801L248.276 28.318C253.714 27.327 257.85 33.114 255.153 37.938Z" fill="#41D1FF"/><path d="M185.432 0.063L96.439 17.501C94.977 17.788 93.894 19.027 93.805 20.515L88.331 112.971C88.202 115.149 90.202 116.839 92.328 116.349L117.105 110.631C119.423 110.096 121.518 112.138 121.041 114.469L113.68 150.516C113.185 152.942 115.462 155.016 117.831 154.297L133.135 149.647C135.507 148.927 137.787 151.007 137.285 153.435L125.587 210.056C124.855 213.598 129.566 215.529 131.53 212.493L205.359 65.746C206.574 63.322 204.479 60.559 201.818 61.073L176.314 65.995C173.918 66.457 171.879 64.225 172.555 61.881L189.201 4.176C189.878 1.827 187.832 -0.407 185.432 0.063Z" fill="#FFEA83"/></svg>',
  react: '<svg viewBox="-11.5 -10.2 23 20.4" fill="none" stroke="#61dafb" stroke-width="1.2" xmlns="http://www.w3.org/2000/svg"><circle r="2" fill="#61dafb" stroke="none"/><ellipse rx="11" ry="4.2"/><ellipse rx="11" ry="4.2" transform="rotate(60)"/><ellipse rx="11" ry="4.2" transform="rotate(120)"/></svg>',
  vue: '<svg viewBox="0 0 256 221" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid"><path d="M204.8 0H256L128 220.8 0 0h51.2L128 132.48 204.8 0z" fill="#41B883"/><path d="M204.8 0H256L128 220.8 0 0h51.2L128 132.48 204.8 0z" fill="#41B883"/><path d="M0 0l128 220.8L256 0h-51.2L128 132.48 51.2 0H0z" fill="#35495E"/></svg>',
  svelte: '<svg viewBox="0 0 24 24" fill="none" stroke="#FF3E00" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M15 6a3 3 0 1 0-6 0c0 3 6 3 6 6a3 3 0 1 1-6 0M9 6V3m6 18v-3" /></svg>',
  solid: '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M128 0L32 128l96 128 96-128L128 0z" fill="#2c4f7c"/></svg>',
  preact: '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M128 0C57.3 0 0 57.3 0 128s57.3 128 128 128 128-57.3 128-128S198.7 0 128 0zm0 231.5c-57.1 0-103.5-46.4-103.5-103.5S70.9 24.5 128 24.5 231.5 70.9 231.5 128 185.1 231.5 128 231.5z" fill="#673ab8"/></svg>',
  lit: '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M128 0L32 96v64l96 96 96-96V96L128 0z" fill="#324fff"/></svg>',
  qwik: '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M128 0L32 128l96 128 96-128L128 0z" fill="#006af5"/></svg>',
  vanilla: '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h256v256H0z" fill="#f7df1e"/><path d="M121.3 181.2c0 31.6-18.4 43.1-46.7 43.1-23.7 0-41-10.4-49.3-25.5l25.8-15c5.3 9.4 11.5 15 22.9 15 11.9 0 18.2-5.1 18.2-22.3V82h29.1v99.2zm106.6-4.1c0 30.6-21.6 47.2-54.8 47.2-28 0-48.6-12.7-56.9-33.1l26.2-15.2c5.3 11.1 14.8 19.3 30 19.3 15.6 0 26.2-7 26.2-21.1s-10.4-18.9-30-27.4c-28.7-12.3-48.4-23.8-48.4-51.4 0-25.2 18.9-43.5 50.9-43.5 23 0 41 10.4 50.1 29.3l-24.6 15c-5.3-9.9-13.1-15.6-25-15.6-12.7 0-21.3 7-21.3 18.4 0 10.7 7.2 16 23.4 22.8 30.6 12.9 54.5 24 54.5 55.1z" fill="#000"/></svg>',
}

export const viteTemplate: ScaffoldTemplate = {
  id: 'vite',
  name: 'Vite',
  description: 'The modern web dev server. Fast, lean, and highly extensible.',
  category: 'fullstack',
  iconColor: '#BD34FE',
  command: 'npm init vite@latest',
  websiteUrl: 'https://vite.dev',
  options: [
    {
      id: 'framework',
      label: 'Framework',
      type: 'select',
      default: 'react',
      choices: [
        { label: 'Vanilla', value: 'vanilla' },
        { label: 'Vue', value: 'vue' },
        { label: 'React', value: 'react' },
        { label: 'Preact', value: 'preact' },
        { label: 'Lit', value: 'lit' },
        { label: 'Svelte', value: 'svelte' },
        { label: 'Solid', value: 'solid' },
        { label: 'Qwik', value: 'qwik' },
      ],
    },
    {
      id: 'variant',
      label: 'Variant',
      type: 'select',
      default: 'ts',
      choices: [
        { label: 'TypeScript', value: 'ts' },
        { label: 'JavaScript', value: 'js' },
      ],
    },
    {
      id: 'packageManager',
      label: 'Package Manager',
      type: 'select',
      default: 'pnpm',
      choices: [
        { label: 'npm', value: 'npm' },
        { label: 'pnpm', value: 'pnpm' },
        { label: 'yarn', value: 'yarn' },
        { label: 'bun', value: 'bun' },
        { label: 'deno', value: 'deno' },
      ],
    },
  ],
  args: (projectName, opts) => {
    const framework = opts.framework || 'react'
    const variant = opts.variant === 'ts' ? '-ts' : ''

    // Qwik special case for vite templates
    const template = framework === 'qwik' ? 'qwik' : `${framework}${variant}`

    return [projectName, '--template', template]
  },
}
