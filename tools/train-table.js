// Builds a word translation table from a parallel subtitle corpus (OPUS
// OpenSubtitles, Moses format: two text files with matching lines). Run once
// per language pair. The aligner only needs the result, not the corpus.
//
//   node --max-old-space-size=3072 tools/train-table.js <a.txt> <b.txt> <out.tsv.gz> [every=30] [maxPairs=1500000]
//
// It trains IBM Model 1 in both directions with expectation-maximisation: start
// with every word pair equally likely, then repeatedly share each word's count
// among the words it could translate to, in proportion to the current guess.
import { createReadStream, createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { splitWords } from '../src/words.js'

const [aPath, bPath, outPath, every = 30, maxPairs = 1_500_000] = process.argv.slice(2)
if (!outPath) throw new Error('Usage: train-table.js <a.txt> <b.txt> <out.tsv.gz> [every] [maxPairs]')

const VOCAB = 60_000 // most frequent words kept on each side
const ITERATIONS = 5
const MAX_WORDS = 30
const MIN_COUNT = 2 // a pair must have this much expected count to be kept
const MIN_PROB = 0.01 // and this probability in at least one direction

const log = message => console.log(`[${Math.round(process.uptime())}s] ${message}`)

// Reads every Nth line pair, spread through the corpus so no single film dominates
async function readPairs() {
  const a = createInterface({ input: createReadStream(aPath), crlfDelay: Infinity })[Symbol.asyncIterator]()
  const b = createInterface({ input: createReadStream(bPath), crlfDelay: Infinity })[Symbol.asyncIterator]()
  const pairs = []
  for (let n = 0; pairs.length < +maxPairs; n++) {
    const [x, y] = await Promise.all([a.next(), b.next()])
    if (x.done || y.done) break
    if (n % +every) continue
    const left = splitWords(x.value).map(w => w.word.toLowerCase())
    const right = splitWords(y.value).map(w => w.word.toLowerCase())
    if (!left.length || !right.length || left.length > MAX_WORDS || right.length > MAX_WORDS) continue
    // Lengths this different are usually lines the corpus paired up wrongly
    if (Math.max(left.length, right.length) > 3 * Math.min(left.length, right.length) + 2) continue
    pairs.push([left, right])
    if (pairs.length % 250_000 === 0) log(`${pairs.length} line pairs read`)
  }
  log(`${pairs.length} line pairs read`)
  return pairs
}

function buildVocab(lines) {
  const counts = new Map()
  for (const line of lines) for (const word of line) counts.set(word, (counts.get(word) ?? 0) + 1)
  const words = [...counts].sort((x, y) => y[1] - x[1]).slice(0, VOCAB).map(([word]) => word)
  return { words, ids: new Map(words.map((word, i) => [word, i])) }
}

const encode = (line, ids) => Int32Array.from(line.map(w => ids.get(w) ?? -1).filter(id => id >= 0))

// Open-addressed hash from (a id, b id) to a slot in typed arrays. A JS Map
// would use several times the memory for the tens of millions of pairs here.
class PairIndex {
  constructor(bits) {
    this.mask = 2 ** bits - 1
    this.keys = new Uint32Array(2 ** bits) // 0 = empty, so stored keys are +1
    this.size = 0
  }
  slot(a, b) {
    const key = (a * 65536 + b + 1) >>> 0 // ids fit 16 bits, as VOCAB is below 65536
    let i = Math.imul(key, 2654435761) >>> 0 & this.mask
    while (this.keys[i] !== 0 && this.keys[i] !== key) i = (i + 1) & this.mask
    if (this.keys[i] === 0) {
      if (++this.size > this.mask * 0.8) throw new Error('Pair index is full. Lower maxPairs.')
      this.keys[i] = key
    }
    return i
  }
}

// One direction: returns t(target | source) per slot. "source" words explain "target" words.
function trainModel1(pairs, index, slots, sourceIsA, nSource) {
  const t = new Float32Array(index.keys.length).fill(1)
  const count = new Float32Array(index.keys.length)
  const total = new Float64Array(nSource)
  for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
    count.fill(0)
    total.fill(0)
    for (let p = 0; p < pairs.length; p++) {
      const [a, b] = pairs[p]
      const s = slots[p]
      const width = b.length
      if (sourceIsA) {
        for (let j = 0; j < b.length; j++) {
          let sum = 0
          for (let i = 0; i < a.length; i++) sum += t[s[i * width + j]]
          for (let i = 0; i < a.length; i++) {
            const share = t[s[i * width + j]] / sum
            count[s[i * width + j]] += share
            total[a[i]] += share
          }
        }
      } else {
        for (let i = 0; i < a.length; i++) {
          let sum = 0
          for (let j = 0; j < b.length; j++) sum += t[s[i * width + j]]
          for (let j = 0; j < b.length; j++) {
            const share = t[s[i * width + j]] / sum
            count[s[i * width + j]] += share
            total[b[j]] += share
          }
        }
      }
    }
    for (let i = 0; i < t.length; i++) {
      if (!index.keys[i]) continue
      const key = index.keys[i] - 1
      const source = sourceIsA ? Math.floor(key / 65536) : key % 65536
      t[i] = count[i] / total[source]
    }
    log(`${sourceIsA ? 'a→b' : 'b→a'} iteration ${iteration}/${ITERATIONS}`)
  }
  return { t, count }
}

const raw = await readPairs()
const aVocab = buildVocab(raw.map(p => p[0]))
const bVocab = buildVocab(raw.map(p => p[1]))
const pairs = raw.map(([x, y]) => [encode(x, aVocab.ids), encode(y, bVocab.ids)]).filter(([x, y]) => x.length && y.length)
raw.length = 0

const index = new PairIndex(26) // 67M slots, about 1.3 GB across the keys and each direction's two arrays
const slots = pairs.map(([a, b]) => {
  const s = new Uint32Array(a.length * b.length)
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) s[i * b.length + j] = index.slot(a[i], b[j])
  return s
})
log(`${index.size} distinct word pairs from ${pairs.length} line pairs`)

const forward = trainModel1(pairs, index, slots, true, aVocab.words.length)
const backward = trainModel1(pairs, index, slots, false, bVocab.words.length)

function* rows() {
  yield '# a\tb\tP(b|a)\tP(a|b)\n'
  for (let i = 0; i < index.keys.length; i++) {
    if (!index.keys[i]) continue
    const pB = forward.t[i]
    const pA = backward.t[i]
    if (Math.max(pB, pA) < MIN_PROB || Math.max(forward.count[i], backward.count[i]) < MIN_COUNT) continue
    const key = index.keys[i] - 1
    yield `${aVocab.words[Math.floor(key / 65536)]}\t${bVocab.words[key % 65536]}\t${pB.toPrecision(3)}\t${pA.toPrecision(3)}\n`
  }
}
await pipeline(Readable.from(rows()), createGzip({ level: 9 }), createWriteStream(outPath))
log(`Wrote ${outPath}`)
