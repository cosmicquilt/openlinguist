// Stremio addon logic: the manifest, the subtitles list, and building the merged file.
import { cached } from './cache.js'
import { listSubtitles, downloadSubtitle } from './upstream.js'
import { rankCandidates } from './select.js'
import { parseSrt, formatSrt } from './srt.js'
import { findBestShift, shift, mergeDual } from './align.js'
import { languageName } from './languages.js'
import { bestOption, distinctTimings, formatLength, hasRecap, lengthOf } from './timing.js'

const VERSION = '0.1.0'
// Each option uses a primary file with different timing, in case the top pick
// doesn't match the user's video. The secondary file is always re-aligned to it.
const OPTIONS = 4
// Primary files downloaded to look for different timing
const PRIMARY_TRIES = 8
// How long the "best match" option waits for the player to report the video's length
const LENGTH_WAIT = 6000
const LENGTH_POLL = 250
// Secondary files downloaded and tested against the primary. The best-aligned one wins.
const SECONDARY_TRIES = 8
const MERGED_TTL = 6 * 60 * 60 * 1000

export class NotFound extends Error {}

// Config lives in the URL path, e.g. /eng-spa/manifest.json, so it needs no
// storage and each language pair installs as its own addon
export function parseConfig(segment) {
  const m = /^([a-z]{2,3})-([a-z]{2,3})$/.exec(segment || '')
  return m && m[1] !== m[2] ? { primary: m[1], secondary: m[2] } : null
}

const configKey = c => `${c.primary}-${c.secondary}`
const pairLabel = c => `${languageName(c.primary)} + ${languageName(c.secondary)}`

export function manifest(config) {
  const base = {
    id: 'community.openlinguist.dualsubs',
    version: VERSION,
    name: 'OpenLinguist Dual Subtitles',
    description: 'Subtitles in two languages at once, from OpenSubtitles.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: !config },
  }
  if (!config) return base
  return {
    ...base,
    id: `${base.id}.${configKey(config)}`,
    name: `OpenLinguist ${pairLabel(config)}`,
    description: `${pairLabel(config)} subtitles at once, from OpenSubtitles.`,
  }
}

// Stremio may send videoHash, videoSize and filename. Keep only those three,
// so nothing else from the request reaches the upstream URL.
export function pickExtra(params) {
  const extra = new URLSearchParams()
  for (const key of ['videoHash', 'videoSize', 'filename']) {
    if (params.get(key)) extra.set(key, params.get(key))
  }
  return extra
}

function hintsFor(id, extra) {
  const [, season, episode] = id.split(':')
  return { filename: extra.get('filename'), season: season && +season, episode: episode && +episode }
}

// The primary files worth offering: the best-ranked of each timing group
function primaryOptions({ config, type, id, extra }) {
  return cached(`options/${config.primary}/${type}/${id}?${extra}`, MERGED_TTL, async () => {
    const list = await listSubtitles(type, id, extra)
    const ranked = rankCandidates(list, config.primary, hintsFor(id, extra)).slice(0, PRIMARY_TRIES)
    const files = await Promise.all(
      ranked.map(async sub => {
        try {
          const cues = parseSrt(await downloadSubtitle(sub.url))
          return cues.length ? { sub, cues, exact: Boolean(sub.m && sub.m !== 'i') } : null
        } catch (err) {
          console.warn(`[skip] ${sub.subtitleFileName}: ${err.message}`)
          return null
        }
      }),
    )
    return distinctTimings(files.filter(Boolean), OPTIONS)
  })
}

// The video's length as the userscript read it from the player, by video id
const videoLengths = new Map()
export function reportVideoLength(id, seconds) {
  if (seconds) videoLengths.set(id, seconds * 1000)
  else videoLengths.delete(id)
}

async function waitForVideoLength(id) {
  for (let waited = 0; !videoLengths.has(id) && waited < LENGTH_WAIT; waited += LENGTH_POLL) {
    await new Promise(resolve => setTimeout(resolve, LENGTH_POLL))
  }
  return videoLengths.get(id)
}

const describeOption = option => [formatLength(lengthOf(option.cues)), ...(hasRecap(option.cues) ? ['with recap'] : [])].join(', ')

// Downloads the primary files to tell their timing apart, which also means
// they're ready when the user picks an option. Merging waits until then.
export async function subtitles({ config, type, id, extra, origin }) {
  const list = await listSubtitles(type, id, extra)
  if (!list.some(s => s.lang === config.secondary)) return []
  const options = await primaryOptions({ config, type, id, extra })
  const query = extra.toString()
  const entry = (variant, lang) => ({
    id: `openlinguist-${configKey(config)}-${variant}`,
    url: `${origin}/${configKey(config)}/dual/${type}/${encodeURIComponent(id)}/${variant}.srt${query ? `?${query}` : ''}`,
    lang,
  })
  if (options.length < 2) return options.map((_, i) => entry(i, pairLabel(config)))
  return [
    entry('auto', `${pairLabel(config)} (best match)`),
    ...options.map((option, i) => entry(i, `${pairLabel(config)} (${describeOption(option)})`)),
  ]
}

export async function dualSrt({ config, type, id, extra, variant }) {
  const options = await primaryOptions({ config, type, id, extra })
  const chosen = variant === 'auto' ? bestOption(options, await waitForVideoLength(id)) : variant
  const key = `${configKey(config)}/${type}/${id}/${chosen}?${extra}`
  return cached(key, MERGED_TTL, async () => {
    const list = await listSubtitles(type, id, extra)
    const hints = hintsFor(id, extra)
    if (!options[chosen]) throw new NotFound(`No ${config.primary} subtitle #${chosen} for ${id}`)
    const { sub: primarySub, cues: primary } = options[chosen]

    const tries = await Promise.all(
      rankCandidates(list, config.secondary, hints)
        .slice(0, SECONDARY_TRIES)
        .map(async sub => {
          try {
            const cues = parseSrt(await downloadSubtitle(sub.url))
            return cues.length ? { sub, cues, fit: findBestShift(primary, cues) } : null
          } catch (err) {
            console.warn(`[skip] ${sub.subtitleFileName}: ${err.message}`)
            return null
          }
        }),
    )
    const best = tries.filter(Boolean).sort((a, b) => b.fit.score - a.fit.score)[0]
    if (!best) throw new NotFound(`No readable ${config.secondary} subtitle for ${id}`)

    const { offset, scale, score } = best.fit
    console.log(
      `[merge] ${id} ${configKey(config)}#${variant}: ${primarySub.subtitleFileName} + ${best.sub.subtitleFileName}` +
        ` (offset ${offset}ms, speed x${scale.toFixed(4)}, overlap ${Math.round(score * 100)}%)`,
    )
    return formatSrt(mergeDual(primary, shift(best.cues, best.fit)))
  })
}
