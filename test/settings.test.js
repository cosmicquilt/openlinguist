import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, normalizeSettings } from '../src/settings.js'

test('fills in defaults for missing or broken input', () => {
  for (const input of [null, undefined, {}, 'text', { pair: 'x' }, { pair: ['eng', 'eng'] }]) assert.deepEqual(normalizeSettings(input), DEFAULTS)
})

test('keeps valid values', () => {
  const input = { pair: ['spa', 'eng'], learning: 'spa', colors: { enabled: false, palette: 'cool', opacity: 0.5, style: 'underline' } }
  assert.deepEqual(normalizeSettings(input), input)
})

test('rejects values that would end up in a path or in CSS, and clamps strength', () => {
  const { pair, learning, colors } = normalizeSettings({
    pair: ['../x', 'eng'],
    learning: 'fre',
    colors: { palette: '__proto__', style: '}body{display:none', opacity: 99, enabled: 'yes' },
  })
  assert.deepEqual(pair, DEFAULTS.pair)
  assert.equal(learning, 'spa')
  assert.deepEqual(colors, { ...DEFAULTS.colors, opacity: 0.8 })
})
