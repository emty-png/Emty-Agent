import type { ScreenViewport } from './constants'
import { DESIGN_FILES, getViewportPreset } from './constants'

export function getTemplateFiles(
  name: string,
  viewport?: ScreenViewport | string,
): Array<{ path: (typeof DESIGN_FILES)[number]; content: string }> {
  const vp: ScreenViewport = typeof viewport === 'string'
    ? getViewportPreset(viewport)
    : (viewport ?? getViewportPreset('mobile'))
  const title = name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="starter">
    <h1>${title}</h1>
    <p>Edit these files to begin building your design.</p>
  </main>
  <script src="script.js"><\/script>
</body>
</html>
`

  const isDesktop = vp.preset === 'desktop'
  const isTablet = vp.preset === 'tablet'
  const stylesCss = isDesktop
    ? `/* ${title} — desktop ${vp.width}×${vp.height} */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #fafafa;
  color: #111;
}

.starter {
  max-width: 1120px;
  margin: 0 auto;
  min-height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 64px 48px;
}

.starter h1 {
  font-size: clamp(32px, 4vw, 56px);
  letter-spacing: -0.02em;
}

.starter p {
  margin-top: 12px;
  color: #666;
  font-size: 16px;
}
`
    : isTablet
      ? `/* ${title} — tablet ${vp.width}×${vp.height} */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #fafafa;
  color: #111;
}

.starter {
  max-width: 640px;
  margin: 0 auto;
  min-height: 100vh;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 48px 32px;
}

.starter h1 {
  font-size: clamp(28px, 5vw, 44px);
  letter-spacing: -0.02em;
}

.starter p {
  margin-top: 12px;
  color: #666;
}
`
      : `/* ${title} — mobile ${vp.width}×${vp.height} */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: #fafafa;
  color: #111;
}

.starter {
  text-align: center;
  padding: 48px 32px;
}

.starter h1 {
  font-size: clamp(28px, 5vw, 44px);
  letter-spacing: -0.02em;
}

.starter p {
  margin-top: 12px;
  color: #666;
}
`

  const scriptJs = `// ${title} — scripts
console.log('Design project ready')
`

  return [
    { path: 'index.html', content: indexHtml },
    { path: 'styles.css', content: stylesCss },
    { path: 'script.js', content: scriptJs },
  ]
}
