import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markWord, readMarked } from '../src/translate.js'

test('marks the hovered word and escapes the rest for XML', () => {
  assert.equal(markWord('Tom & Jerry <3 hablan', 15, 21), 'Tom &amp; Jerry &lt;3 <w>hablan</w>')
})

test("reads the word's translation and the plain line back", () => {
  assert.deepEqual(readMarked('I am <w>talking</w> to my family &amp; friends.'), {
    word: 'talking',
    line: 'I am talking to my family & friends.',
  })
})

test('reports a dropped or emptied tag as no word', () => {
  assert.equal(readMarked("I'm talking to them.").word, null)
  assert.equal(readMarked('I <w> </w>talk.').word, null)
  assert.equal(readMarked('I <w/>talk.').line, 'I talk.')
})
