import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alignCue, alignWords, loadTable, parseTable } from '../src/wordalign.js'

const table = parseTable(
  ['# a\tb\tP(b|a)\tP(a|b)', 'family\tfamilia\t0.8\t0.9', 'my\tmi\t0.7\t0.8', 'going\tvoy\t0.4\t0.5', 'to\tvoy\t0.3\t0.25', 'the\tla\t0.5\t0.5'].join('\n'),
)

test('aligns matching words and leaves the rest out', () => {
  assert.deepEqual(alignWords(table, 'my lovely family', 'mi familia'), [
    { a: [0], b: [0] },
    { a: [2], b: [1] },
  ])
})

test('matches names exactly and cognates by spelling', () => {
  assert.deepEqual(alignWords(table, 'Walter', 'Walter'), [{ a: [0], b: [0] }])
  assert.deepEqual(alignWords(table, 'the laboratory', 'el laboratorio'), [{ a: [1], b: [1] }])
})

test('adds a matching neighbour to a group', () => {
  assert.deepEqual(alignWords(table, 'going to', 'voy'), [{ a: [0, 1], b: [0] }])
})

test('uses each word once and prefers the nearer of two identical words', () => {
  assert.deepEqual(alignWords(table, 'the x the', 'la'), [{ a: [0], b: [0] }])
  assert.deepEqual(alignWords(table, 'nothing here', 'nada aquí'), [])
})

test('aligns real lines with the eng-spa table, in either pair order', () => {
  assert.deepEqual(alignCue('eng', 'spa', 'Thank you.', 'Gracias.')?.[0].b, [0])
  const forward = alignCue('eng', 'spa', 'A month in the hole.', 'Un mes en el hoyo.')
  assert.equal(forward.length, 5)
  const reversed = alignCue('spa', 'eng', 'Un mes en el hoyo.', 'A month in the hole.')
  assert.deepEqual(reversed, forward.map(({ a, b }) => ({ a: b, b: a })))
})

test('has no alignment for a pair without a table, and never reads outside data/', () => {
  assert.equal(alignCue('eng', 'xyz', 'a', 'b'), null)
  assert.equal(alignCue('../x', 'eng', 'a', 'b'), null)
  assert.equal(loadTable('xyz-eng'), null)
})
