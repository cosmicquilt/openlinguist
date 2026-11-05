import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBestShift, mergeDual, shift } from '../src/align.js'

// Deterministic pseudo-random cues with irregular lengths and gaps, like real dialogue
function dialogue(count, seed = 7) {
  let x = seed
  const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const cues = []
  let t = 5000
  for (let i = 0; i < count; i++) {
    t += 300 + rand() * 4000
    const length = 800 + rand() * 3000
    cues.push({ start: Math.round(t), end: Math.round(t + length), text: `line ${i}` })
    t += length
  }
  return cues
}

test('recovers a constant offset', () => {
  const primary = dialogue(400)
  const secondary = shift(primary, { scale: 1, offset: -3200 })
  const fit = findBestShift(primary, secondary)
  assert.equal(fit.scale, 1)
  assert.ok(Math.abs(fit.offset - 3200) <= 25, `offset ${fit.offset}`)
  assert.ok(fit.score > 0.95)
})

test('recovers PAL speed-up drift plus an offset', () => {
  const primary = dialogue(400)
  // Timed against a 25fps release: everything runs 4% early, plus a 1.5s lead
  const secondary = shift(primary, { scale: 23.976 / 25, offset: -1500 })
  const fit = findBestShift(primary, secondary)
  assert.ok(Math.abs(fit.scale - 25 / 23.976) < 1e-9, `scale ${fit.scale}`)
  assert.ok(fit.score > 0.9, `score ${fit.score}`)
})

test('prefers no shift when files are already aligned', () => {
  const primary = dialogue(200)
  assert.deepEqual(
    (({ scale, offset }) => ({ scale, offset }))(findBestShift(primary, primary)),
    { scale: 1, offset: 0 },
  )
})

test('merges secondary lines into the primary cue they overlap most', () => {
  const primary = [
    { start: 1000, end: 3000, text: 'Hello' },
    { start: 4000, end: 6000, text: 'Goodbye' },
  ]
  const secondary = [
    { start: 1100, end: 2000, text: 'Hola' },
    { start: 2000, end: 2900, text: 'amigo' },
    // Mostly inside the second cue, though it starts during the first
    { start: 2800, end: 5000, text: 'Adiós' },
    // Overlaps nothing, so it's kept as its own cue
    { start: 7000, end: 8000, text: '¿Qué?' },
  ]
  assert.deepEqual(mergeDual(primary, secondary), [
    { start: 1000, end: 3000, text: 'Hello\n<i>Hola\namigo</i>' },
    { start: 4000, end: 6000, text: 'Goodbye\n<i>Adiós</i>' },
    { start: 7000, end: 8000, text: '<i>¿Qué?</i>' },
  ])
})
