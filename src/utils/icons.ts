export function getDeviconForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // Custom mappings for common file types
  const map: Record<string, string> = {
    // Web & Styles
    html: 'html5',
    htm: 'html5',
    css: 'css3',
    scss: 'sass',
    sass: 'sass',
    less: 'less',
    styl: 'stylus',

    // JS/TS & Variants
    js: 'javascript',
    cjs: 'javascript',
    mjs: 'javascript',
    jsx: 'react',
    ts: 'typescript',
    tsx: 'react',
    coffee: 'coffeescript',

    // Frameworks
    vue: 'vuejs',
    svelte: 'svelte',
    astro: 'astro',
    angular: 'angularjs',

    // Data & Config
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    md: 'markdown',
    mdx: 'markdown',
    graphql: 'graphql',
    gql: 'graphql',
    sql: 'postgresql',

    // Languages
    py: 'python',
    pyw: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    class: 'java',
    jar: 'java',
    c: 'c',
    h: 'c',
    cpp: 'cplusplus',
    hpp: 'cplusplus',
    cc: 'cplusplus',
    hh: 'cplusplus',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    dart: 'dart',
    scala: 'scala',
    hs: 'haskell',
    lua: 'lua',
    pl: 'perl',
    pm: 'perl',
    r: 'r',
    clj: 'clojure',
    cljs: 'clojure',
    cljc: 'clojure',
    edn: 'clojure',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hrl: 'erlang',
    zig: 'zig',
    nim: 'nim',
    jl: 'julia',
    d: 'd',
    cr: 'crystal',
    elm: 'elm',
    fs: 'fsharp',
    fsi: 'fsharp',
    fsx: 'fsharp',
    groovy: 'groovy',
    ml: 'ocaml',
    mli: 'ocaml',
    sol: 'solidity',
    tf: 'terraform',
    tfvars: 'terraform',
    tfstate: 'terraform',
    proto: 'google',
    asm: 'embeddedc',
    s: 'embeddedc',
    cmake: 'cmake',
    make: 'c',

    // Web & Tooling
    prisma: 'prisma',
    wasm: 'webassembly',

    // Shell & Scripts
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    bat: 'windows8',
    cmd: 'windows8',
    ps1: 'powershell',

    // Dev Tools & Infra
    gitignore: 'git',
    gitconfig: 'git',
    dockerfile: 'docker',
    dockerignore: 'docker',
    vagrantfile: 'vagrant',
    jenkinsfile: 'jenkins',
    circleci: 'circleci',
    travis: 'travis',

    // Multimedia & Design
    svg: 'aftereffects', // Devicon doesn't have a great "svg" plain icon usually, but let's map some design ones
    png: 'canva',
    ai: 'illustrator',
    psd: 'photoshop',
    fig: 'figma',
    xd: 'xd',
    sketch: 'sketch',

    // Cloud & DB
    aws: 'amazonwebservices',
    azure: 'azure',
    gcp: 'googlecloud',
    firebase: 'firebase',
    heroku: 'heroku',
    netlify: 'netlify',
    vercel: 'vercel',
    mongodb: 'mongodb',
    mysql: 'mysql',
    postgresql: 'postgresql',
    sqlite: 'sqlite',
    redis: 'redis',
    mariadb: 'mariadb',

  }

  // Specific Filename Overrides
  const lowerName = filename.toLowerCase()
  if (lowerName === 'package.json')
    return 'devicon-npm-original-wordmark'
  if (lowerName === 'package-lock.json')
    return 'devicon-npm-original-wordmark'
  if (lowerName === 'pnpm-lock.yaml' || lowerName === 'pnpm-workspace.yaml')
    return 'devicon-pnpm-plain'
  if (lowerName === 'yarn.lock')
    return 'devicon-yarn-plain'
  if (lowerName === 'bun.lockb')
    return 'devicon-bun-plain'
  if (lowerName.includes('vite.config'))
    return 'devicon-vitejs-plain'
  if (lowerName.includes('tailwind.config'))
    return 'devicon-tailwindcss-plain'
  if (lowerName.includes('eslint.config') || lowerName.startsWith('.eslintrc'))
    return 'devicon-eslint-plain'
  if (lowerName.includes('vitest.config'))
    return 'devicon-vitest-plain'
  if (lowerName.includes('jest.config') || lowerName.includes('.jest'))
    return 'devicon-jest-plain'
  if (lowerName.includes('mocha.config'))
    return 'devicon-mocha-plain'
  if (lowerName.includes('playwright.config'))
    return 'devicon-playwright-plain'
  if (lowerName.includes('tsconfig'))
    return 'devicon-typescript-plain'
  if (lowerName.startsWith('babel.config') || lowerName.startsWith('.babelrc'))
    return 'devicon-babel-plain'
  if (lowerName.startsWith('webpack.config'))
    return 'devicon-webpack-plain'
  if (lowerName.startsWith('rollup.config'))
    return 'devicon-rollup-plain'
  if (lowerName.startsWith('postcss.config'))
    return 'devicon-postcss-plain'
  if (lowerName === 'cargo.toml' || lowerName === 'cargo.lock')
    return 'devicon-rust-plain'
  if (lowerName === 'go.mod' || lowerName === 'go.sum')
    return 'devicon-go-plain'
  if (lowerName === 'gemfile')
    return 'devicon-ruby-plain'
  if (lowerName === 'composer.json')
    return 'devicon-php-plain'
  if (lowerName === 'procfile')
    return 'devicon-heroku-plain'
  if (lowerName === 'netlify.toml')
    return 'devicon-netlify-plain'
  if (lowerName === 'vercel.json')
    return 'devicon-vercel-plain'

  // Environment files
  if (lowerName.startsWith('.env'))
    return 'devicon-bash-plain'

  const mapped = map[ext]
  if (mapped) {
    return `devicon-${mapped}-plain`
  }

  return ''
}

export function getDeviconForFramework(framework: string): string {
  const n = framework.toLowerCase()
  if (n === 'electron' || n.includes('electron'))
    return 'devicon-electron-original' // Electron doesn't have a plain text-inheriting version sometimes, but let's try it. Actually original is fine.
  if (n === 'nextjs' || n.includes('next'))
    return 'devicon-nextjs-plain'
  if (n === 'sveltekit' || n.includes('svelte'))
    return 'devicon-svelte-plain'
  if (n === 'tauri' || n.includes('tauri'))
    return 'devicon-tauri-plain'
  if (n === 'vite' || n.includes('vite'))
    return 'devicon-vitejs-plain'
  if (n === 'react' || n.includes('react'))
    return 'devicon-react-plain'
  if (n === 'vue' || n.includes('vue'))
    return 'devicon-vuejs-plain'
  if (n === 'solid' || n.includes('solid'))
    return 'devicon-solidjs-plain'
  if (n === 'tailwindcss' || n.includes('tailwind'))
    return 'devicon-tailwindcss-plain'

  // Specific fallbacks or mappings if devicon lacks a plain version
  if (n === 'typescript' || n === 'ts')
    return 'devicon-typescript-plain'
  if (n === 'javascript' || n === 'js')
    return 'devicon-javascript-plain'
  if (n === 'vanilla')
    return 'devicon-javascript-plain'
  if (n === 'pnpm')
    return 'devicon-pnpm-plain'
  if (n === 'npm')
    return 'devicon-npm-original-wordmark'
  if (n === 'yarn')
    return 'devicon-yarn-plain'
  if (n === 'bun')
    return 'devicon-bun-plain'
  if (n === 'deno')
    return 'devicon-denojs-original'

  // Some frameworks might not exist in devicon or have different names
  // e.g., hono, astro, tsdown, docusaurus might be missing or under different names.
  // We can fallback to empty string if not found.
  return ''
}
