import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankCandidates } from '../src/select.js'
import { parseConfig, pickExtra } from '../src/addon.js'

const sub = (id, fields) => ({ id, lang: 'eng', url: `https://subs.example/${id}`, m: 'i', ...fields })

test('keeps upstream order when nothing distinguishes candidates', () => {
  const list = [sub('a', {}), sub('b', {}), sub('c', { lang: 'spa' })]
  assert.deepEqual(rankCandidates(list, 'eng').map(s => s.id), ['a', 'b'])
})

test('demotes multi-CD files and mislabelled episodes', () => {
  const list = [
    sub('cd', { subtitleFileName: 'Movie_(1994).CD1.aFLDp.srt' }),
    sub('wrong-ep', { subtitleFileName: 'Show.S01E02.720p.srt' }),
    sub('good', { subtitleFileName: 'Show.S01E01.720p.srt' }),
  ]
  assert.deepEqual(rankCandidates(list, 'eng', { season: 1, episode: 1 }).map(s => s.id), ['good', 'cd', 'wrong-ep'])
})

test('prefers hash matches, then the release matching the video filename', () => {
  const list = [
    sub('plain', { subtitleFileName: 'Show.S01E01.HDTV.srt' }),
    sub('release', { subtitleFileName: 'Show.S01E01.1080p.BluRay.x264-REWARD.srt', releaseGroup: 'REWARD' }),
    sub('hash', { m: 'h', subtitleFileName: 'whatever.srt' }),
  ]
  const hints = { filename: 'Show.S01E01.1080p.BluRay.x264-REWARD.mkv', season: 1, episode: 1 }
  assert.deepEqual(rankCandidates(list, 'eng', hints).map(s => s.id), ['hash', 'release', 'plain'])
})

test('parses language pair config', () => {
  assert.deepEqual(parseConfig('eng-spa'), { primary: 'eng', secondary: 'spa' })
  assert.equal(parseConfig('eng-eng'), null)
  assert.equal(parseConfig('manifest.json'), null)
})

test('forwards only the extras Stremio defines', () => {
  const extra = pickExtra(new URLSearchParams('videoHash=abc&filename=My%20Show.mkv&evil=1'))
  assert.equal(extra.toString(), 'videoHash=abc&filename=My+Show.mkv')
})
