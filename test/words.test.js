import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { splitWords } from '../src/words.js'

const between = source => {
  const code = /\/\/ <split-words>([\s\S]*?)\/\/ <\/split-words>/.exec(source)?.[1]
  assert.ok(code, 'markers not found')
  return code.replace(/\s+/g, ' ').trim()
}

test('the userscript splits words with the same code as the server', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.equal(between(read('../userscript/openlinguist.user.js')), between(read('../src/words.js')))
})

test('finds words with their positions and skips punctuation and numbers', () => {
  assert.deepEqual(splitWords("¿Qué?  It's 40, señor."), [
    { word: 'Qué', start: 1 },
    { word: "It's", start: 7 },
    { word: 'señor', start: 16 },
  ])
})

test('splitting lines one at a time finds the same words as splitting them joined', () => {
  const lines = ['- No se le nota nada,', '¿verdad?', "Don't-go now."]
  const separately = lines.flatMap(line => splitWords(line).map(w => w.word))
  assert.deepEqual(splitWords(lines.join('\n')).map(w => w.word), separately)
})
