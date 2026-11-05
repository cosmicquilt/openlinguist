import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestOption, distinctTimings, formatLength, hasRecap, lengthOf } from '../src/timing.js'

// Unevenly spaced cues, like real dialogue. Even spacing would overlap by chance at any offset.
const makeCues = ({ scale = 1, offset = 0, count = 300, text = 'Line' } = {}) => {
  let at = 500
  return Array.from({ length: count }, (_, i) => {
    const length = 1500 + (i * 7919) % 2500
    const cue = { start: at * scale + offset, end: (at + length) * scale + offset, text }
    at += length + 400 + (i * 104729) % 6000
    return cue
  })
}

test('keeps one file per timing group, in rank order', () => {
  const dvd = { name: 'dvd', cues: makeCues() }
  const sameAsDvd = { name: 'same', cues: makeCues({ offset: 300 }) }
  const pal = { name: 'pal', cues: makeCues({ scale: 23.976 / 25 }) }
  const recap = { name: 'recap', cues: makeCues({ offset: 49000 }) }
  assert.deepEqual(distinctTimings([dvd, sameAsDvd, pal, recap], 4).map(f => f.name), ['dvd', 'pal', 'recap'])
  assert.deepEqual(distinctTimings([dvd, pal, recap], 2).map(f => f.name), ['dvd', 'pal'])
})

test('leaves out files covering only part of the video', () => {
  const full = { name: 'full', cues: makeCues() }
  const half = { name: 'half', cues: makeCues({ count: 150, offset: 3000 }) }
  assert.deepEqual(distinctTimings([half, full], 4).map(f => f.name), ['full'])
})

test('picks the closest length, as with Angel 2x11', () => {
  const options = [{ cues: makeCues({ count: 1, offset: 41.48 * 60000 }) }, { cues: makeCues({ count: 1, offset: 41.21 * 60000 }) }]
  assert.equal(bestOption(options, 41.3 * 60000), 1)
})

test('a file matched by hash wins, and the top file is used without a length', () => {
  const near = { cues: makeCues({ count: 1, offset: 60000 }) }
  const far = { cues: makeCues({ count: 1, offset: 600000 }), exact: true }
  assert.equal(bestOption([near, far], 60000), 1)
  assert.equal(bestOption([near, { cues: far.cues }], undefined), 0)
})

test('spots a recap only near the start', () => {
  assert.equal(hasRecap(makeCues({ count: 1, text: 'Previously on Angel:' })), true)
  assert.equal(hasRecap(makeCues({ count: 1, text: 'Anteriormente en Angel:' })), true)
  assert.equal(hasRecap(makeCues({ count: 1, offset: 600000, text: 'Previously on Angel:' })), false)
})

test('formats lengths the way the player shows minutes', () => {
  assert.equal(formatLength(lengthOf([{ end: 41.21 * 60000 }])), '41:13')
})
