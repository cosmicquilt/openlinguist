// Word alignment: which words in one line of a cue match which in the other.
// Not to be confused with align.js, which lines up cues by time.
//
// Scores come from a table learned from subtitles (tools/train-table.js), plus
// exact matches for names and spelling similarity for cognates. The best pairs
// are taken first, so each word goes to its strongest match, and a word with no
// good match stays out. The two lines are separate human translations that often
// paraphrase, so leaving a word out is better than guessing.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { splitWords } from './words.js'

export const TUNING = {
  minScore: 0.12, // below this, a pair is more likely noise than a match
  minGrow: 0.2, // for adding a neighbouring word to a pair: "going to" ↔ "voy"
  positionWeight: 0.2, // how much a word's place in its line counts
  strongerSide: 0.9, // 0.5 needs each word to predict the other; towards 1, one direction is enough
  minWeak: 0.02, // enough for a word whose other side is narrowed down by its neighbours
  weakMinLength: 3, // shorter words are mostly grammar, and weak evidence misleads on them
  eliminate: true, // pair the last word left on each side of a stretch
  eliminateMinLength: 3,
}
const IDENTICAL_SCORE = 0.6
const COGNATE_SCORE = 0.3
const COGNATE_MIN_LENGTH = 4
const COGNATE_MIN_SIMILARITY = 0.7

// "a\tb\tP(b|a)\tP(a|b)" rows into a → b → [P(b|a), P(a|b)]
export function parseTable(tsv) {
  const table = new Map()
  for (const row of tsv.split('\n')) {
    if (!row || row[0] === '#') continue
    const [a, b, pB, pA] = row.split('\t')
    let entries = table.get(a)
    if (!entries) table.set(a, (entries = new Map()))
    entries.set(b, [+pB, +pA])
  }
  return table
}

const tables = new Map() // "eng-spa" -> table, or null if there's no file for that pair
export function loadTable(pair) {
  if (!tables.has(pair)) {
    let table = null
    try {
      table = parseTable(gunzipSync(readFileSync(new URL(`../data/${pair}.tsv.gz`, import.meta.url))).toString())
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    tables.set(pair, table)
  }
  return tables.get(pair)
}

const plain = word => word.normalize('NFD').replace(/\p{M}/gu, '')

// 1 for the same spelling (ignoring accents), towards 0 for nothing in common
function similarity(x, y) {
  x = plain(x)
  y = plain(y)
  let row = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const next = [i]
    for (let j = 1; j <= y.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
    row = next
  }
  return 1 - row[y.length] / Math.max(x.length, y.length)
}

// A weighted geometric mean of the two directions. Common words appear next to
// everything, so they score low unless the stronger direction is trusted too much.
function learnedScore(table, x, y, strongerSide) {
  const entry = table.get(x)?.get(y)
  if (!entry) return 0
  return Math.max(...entry) ** strongerSide * Math.min(...entry) ** (1 - strongerSide)
}

function wordScore(table, x, y, tuning) {
  const learned = learnedScore(table, x, y, tuning.strongerSide)
  if (x === y) return Math.max(learned, IDENTICAL_SCORE)
  if (learned || Math.min(x.length, y.length) < COGNATE_MIN_LENGTH) return learned
  const sim = similarity(x, y)
  return sim >= COGNATE_MIN_SIMILARITY ? COGNATE_SCORE * sim : 0
}

// Aligns the two lines of a cue, given in the pair's order, using the pair's
// table in whichever direction it was trained. Null when no table exists yet.
export function alignCue(first, second, textFirst, textSecond) {
  const code = /^[a-z]{2,3}$/ // these become part of a file path
  if (!code.test(first) || !code.test(second)) return null
  const forward = loadTable(`${first}-${second}`)
  if (forward) return alignWords(forward, textFirst, textSecond)
  const backward = loadTable(`${second}-${first}`)
  if (!backward) return null
  return alignWords(backward, textSecond, textFirst)
    .map(({ a, b }) => ({ a: b, b: a }))
    .sort((x, y) => x.a[0] - y.a[0])
}

// Returns groups of word positions, in reading order of line a:
// [{ a: [0, 1], b: [0] }, …]. Positions count the words splitWords finds.
export function alignWords(table, textA, textB, tuning = TUNING) {
  const a = splitWords(textA).map(w => w.word.toLowerCase())
  const b = splitWords(textB).map(w => w.word.toLowerCase())
  const pairs = []
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const score = wordScore(table, a[i], b[j], tuning)
      if (score <= 0) continue
      const drift = Math.abs((i + 0.5) / a.length - (j + 0.5) / b.length)
      pairs.push({ i, j, score, ranked: score * (1 - tuning.positionWeight * drift) })
    }
  }
  pairs.sort((x, y) => y.ranked - x.ranked)

  const groupOfA = new Array(a.length).fill(null)
  const groupOfB = new Array(b.length).fill(null)
  const groups = []
  for (const { i, j, ranked } of pairs) {
    if (ranked < tuning.minScore || groupOfA[i] || groupOfB[j]) continue
    const group = { a: [i], b: [j] }
    groupOfA[i] = groupOfB[j] = group
    groups.push(group)
  }

  // A leftover word joins a neighbour's group if it also matches that group's
  // other side. Strongest first, so "going to" grows outwards from "going".
  for (const { i, j, score } of pairs) {
    if (score < tuning.minGrow) continue
    if (!groupOfA[i] && groupOfB[j] && (groupOfA[i - 1] === groupOfB[j] || groupOfA[i + 1] === groupOfB[j])) {
      groupOfA[i] = groupOfB[j]
      groupOfB[j].a.push(i)
    } else if (!groupOfB[j] && groupOfA[i] && (groupOfB[j - 1] === groupOfA[i] || groupOfB[j + 1] === groupOfA[i])) {
      groupOfB[j] = groupOfA[i]
      groupOfA[i].b.push(j)
    }
  }

  // The pairs so far split the sentence into stretches. A leftover word's match
  // is probably in the same stretch of the other line, so weaker evidence is
  // enough there. Groups are compared by first word, so a swapped pair still works.
  const stretch = (position, side) => groups.filter(group => group[side][0] < position).length
  const join = (i, j) => {
    const group = { a: [i], b: [j] }
    groupOfA[i] = groupOfB[j] = group
    groups.push(group)
  }
  for (const { i, j, score } of pairs) {
    if (score < tuning.minWeak || groupOfA[i] || groupOfB[j] || Math.min(a[i].length, b[j].length) < tuning.weakMinLength) continue
    if (stretch(i, 'a') === stretch(j, 'b')) join(i, j)
  }

  // Process of elimination: a stretch with one word left on each side pairs them,
  // even if the table has never seen them together. Very short words are skipped,
  // as they're usually grammar with no counterpart: "de", "a", "it".
  if (tuning.eliminate) {
    const left = (words, owner, side) => {
      const byStretch = new Map()
      words.forEach((word, position) => {
        if (owner[position]) return
        const key = stretch(position, side)
        byStretch.set(key, [...(byStretch.get(key) ?? []), position])
      })
      return byStretch
    }
    const leftB = left(b, groupOfB, 'b')
    for (const [key, positions] of left(a, groupOfA, 'a')) {
      const others = leftB.get(key)
      if (positions.length !== 1 || others?.length !== 1) continue
      if (Math.min(a[positions[0]].length, b[others[0]].length) >= tuning.eliminateMinLength) join(positions[0], others[0])
    }
  }

  for (const group of groups) {
    group.a.sort((x, y) => x - y)
    group.b.sort((x, y) => x - y)
  }
  return groups.sort((x, y) => x.a[0] - y.a[0])
}
