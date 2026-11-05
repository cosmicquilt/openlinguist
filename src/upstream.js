// Talks to Stremio's hosted OpenSubtitles v3 addon. Its subtitle URLs are
// already converted to UTF-8 and need no API key or download quota.
import { cached } from './cache.js'

const UPSTREAM_URL = (process.env.UPSTREAM_URL || 'https://opensubtitles-v3.strem.io').replace(/\/$/, '')
const LIST_TTL = 60 * 60 * 1000
const FILE_TTL = 6 * 60 * 60 * 1000
const TIMEOUT = 15000

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`${res.status} from ${url}`)
  return res
}

// `extra` is a URLSearchParams of videoHash / videoSize / filename
export function listSubtitles(type, id, extra) {
  const query = extra.toString()
  const url = `${UPSTREAM_URL}/subtitles/${type}/${id}${query ? `/${query}` : ''}.json`
  return cached(url, LIST_TTL, async () => (await (await get(url)).json()).subtitles ?? [])
}

export function downloadSubtitle(url) {
  return cached(url, FILE_TTL, async () => (await get(url)).text())
}
