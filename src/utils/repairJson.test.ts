import { describe, expect, it } from 'vitest'
import { repairJson, safeJsonParse } from './repairJson'

describe('repairJson', () => {
  // ── Valid JSON passthrough ────────────────────────────────────────────────

  it('returns valid JSON unchanged', () => {
    const input = '{"name":"test","value":42}'
    expect(repairJson(input)).toBe(input)
  })

  it('returns valid array unchanged', () => {
    const input = '[1,2,3]'
    expect(repairJson(input)).toBe(input)
  })

  it('returns valid nested JSON unchanged', () => {
    const input = '{"html":"<div>Hello</div>","css":"body{color:red}","js":"console.log(1)"}'
    expect(repairJson(input)).toBe(input)
  })

  it('returns null for empty string', () => {
    expect(repairJson('')).toBeNull()
  })

  it('returns null for whitespace-only', () => {
    expect(repairJson('   \n  \t  ')).toBeNull()
  })

  // ── Code block extraction ────────────────────────────────────────────────

  it('extracts JSON from ```json code block', () => {
    const input = '```json\n{"key":"value"}\n```'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })

  it('extracts JSON from plain ``` code block', () => {
    const input = '```\n{"key":"value"}\n```'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })

  it('handles inline code block without newlines', () => {
    const input = '```json{"key":"value"}```'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })

  // ── Trailing commas ──────────────────────────────────────────────────────

  it('removes trailing comma in object', () => {
    const input = '{"a":1,"b":2,}'
    expect(repairJson(input)).toBe('{"a":1,"b":2}')
  })

  it('removes trailing comma in array', () => {
    const input = '[1,2,3,]'
    expect(repairJson(input)).toBe('[1,2,3]')
  })

  it('removes trailing comma with whitespace', () => {
    const input = '{"a":1,   }'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ a: 1 })
  })

  // ── Extra closing brackets (the "dumb AI mistake") ───────────────────────

  it('strips trailing }])', () => {
    const input = '{"name":"test"}])'
    expect(repairJson(input)).toBe('{"name":"test"}')
  })

  it('strips trailing }]', () => {
    const input = '{"key":"value"}]'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })

  it('strips trailing extra }', () => {
    const input = '{"a":1}}'
    expect(repairJson(input)).toBe('{"a":1}')
  })

  it('strips trailing ])', () => {
    const input = '[1,2,3])'
    expect(repairJson(input)).toBe('[1,2,3]')
  })

  // ── Missing closing brackets ─────────────────────────────────────────────

  it('closes unclosed object', () => {
    const input = '{"name":"test"'
    expect(repairJson(input)).toBe('{"name":"test"}')
  })

  it('closes unclosed array', () => {
    const input = '[1,2,3'
    expect(repairJson(input)).toBe('[1,2,3]')
  })

  it('closes nested unclosed brackets', () => {
    const input = '{"items":[{"id":1},{"id":2}'
    expect(repairJson(input)).toBe('{"items":[{"id":1},{"id":2}]}')
  })

  // ── Unclosed strings ─────────────────────────────────────────────────────

  it('closes unclosed string value', () => {
    const input = '{"name":"test","value":"hello}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toBeDefined()
  })

  // ── Comment removal ──────────────────────────────────────────────────────

  it('removes line comments', () => {
    const input = '{\n// comment\n"key":"value"\n}'
    const result = repairJson(input)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ key: 'value' })
  })

  it('removes block comments', () => {
    const input = '{"key":/* comment */"value"}'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })

  it('preserves strings that look like comments', () => {
    const input = '{"url":"http://example.com","key":"value"}'
    expect(repairJson(input)).toBe('{"url":"http://example.com","key":"value"}')
  })

  // ── Combined fixes ───────────────────────────────────────────────────────

  it('handles trailing comma + extra bracket', () => {
    const input = '{"a":1,"b":2,}}'
    expect(repairJson(input)).toBe('{"a":1,"b":2}')
  })

  it('handles trailing comma + unclosed object + extra brackets', () => {
    const input = '{"a":1,"b":2,]})'
    // Extremely degenerate case (mismatched bracket types + extras);
    // the parser may or may not recover — just verify no crash
    const result = repairJson(input)
    if (result !== null)
      expect(JSON.parse(result)).toBeDefined()
  })

  // ── Large payloads ───────────────────────────────────────────────────────

  it('handles large HTML payload', () => {
    const html = `<div class="container">${'<p>'.repeat(1000)}Hello${'</p>'.repeat(1000)}</div>`
    const input = JSON.stringify({ html, css: 'body{margin:0}', js: 'console.log(1)' })
    expect(repairJson(input)).toBe(input)
  })

  it('handles large payload with trailing bracket', () => {
    const html = `<div>${'x'.repeat(50000)}</div>`
    const base = JSON.stringify({ html, css: 'body{margin:0}', js: '' })
    const broken = `${base}])`
    const result = repairJson(broken)
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ html, css: 'body{margin:0}', js: '' })
  })

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('handles empty object', () => {
    expect(repairJson('{}')).toBe('{}')
  })

  it('handles empty array', () => {
    expect(repairJson('[]')).toBe('[]')
  })

  it('handles boolean and null values', () => {
    const input = '{"flag":true,"nothing":null}'
    expect(repairJson(input)).toBe(input)
  })

  it('handles escaped quotes in strings', () => {
    const input = '{"msg":"He said \\"hello\\""}'
    expect(repairJson(input)).toBe(input)
  })

  it('strips control characters at end', () => {
    const input = '{"key":"value"}\x00\x01\x02'
    expect(repairJson(input)).toBe('{"key":"value"}')
  })
})

describe('safeJsonParse', () => {
  it('returns parsed value for valid JSON', () => {
    expect(safeJsonParse('{"a":1}', {} as Record<string, number>)).toEqual({ a: 1 })
  })

  it('returns parsed array for valid JSON', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3])
  })

  it('repairs and returns value for fixable JSON', () => {
    expect(safeJsonParse('{"a":1},', {})).toEqual({ a: 1 })
  })

  it('repairs JSON with trailing bracket', () => {
    expect(safeJsonParse('{"key":"value"}]', {})).toEqual({ key: 'value' })
  })

  it('returns fallback for completely invalid JSON', () => {
    expect(safeJsonParse('not json at all', 'default')).toBe('default')
  })

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', 'fallback')).toBe('fallback')
  })

  it('returns fallback for null input treated as empty', () => {
    expect(safeJsonParse('', null)).toBe(null)
  })

  it('handles JSON.parse-compatible type parameter', () => {
    interface Config { x: number }
    const fallback: Config = { x: 0 }
    expect(safeJsonParse('{"x":42}', fallback)).toEqual({ x: 42 })
    expect(safeJsonParse('bad', fallback)).toEqual({ x: 0 })
  })
})
