// HTTP server for the addon. No framework: the Stremio addon protocol is a
// handful of GET routes that return JSON.
//
//   /configure, /:config/configure                language picker
//   /manifest.json, /:config/manifest.json
//   /:config/subtitles/:type/:id[/:extra].json    Stremio's subtitles request
//   /:config/dual/:type/:id/:variant.srt          the merged file
//   /translate?from&to&text&start&end              one word in its line, for the userscript
//   /translate/warm                                opens a DeepL connection ahead of a hover
//   /align?from&to&a&b                             which words match in a cue's two lines
//   /settings                                      GET for the userscript, POST from the configure page
//   /video-length?id&seconds                       the playing video's length, for the "best match" subtitle
//   /openlinguist.user.js                          the userscript, for Tampermonkey to install
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { manifest, parseConfig, pickExtra, subtitles, dualSrt, reportVideoLength, NotFound } from './addon.js'
import { configurePage } from './configure.js'
import { translateWord, warmUp, TranslateError } from './translate.js'
import { alignCue } from './wordalign.js'
import { getSettings, saveSettings, settingsForScript } from './settings.js'

// .env holds the DeepL key. loadEnvFile needs Node 20.12+, and older ones just skip it
try {
  process.loadEnvFile?.(new URL('../.env', import.meta.url))
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const PORT = Number(process.env.PORT) || 7000
const HOST = process.env.HOST || '127.0.0.1'
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/$/, '')

const TYPES = new Set(['movie', 'series'])
const ID = /^tt\d+(:\d+:\d+)?$/
// The Allow-Private-Network header answers Chromium's preflight check when
// the Stremio app (an https page) calls this server on 127.0.0.1
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Private-Network': 'true',
}

function send(res, status, type, body = '', headers = {}) {
  res.writeHead(status, { ...CORS, ...(type && { 'Content-Type': type }), ...headers })
  res.end(body)
}

const json = (res, data, maxAge = 0) =>
  send(res, 200, 'application/json; charset=utf-8', JSON.stringify(data), maxAge ? { 'Cache-Control': `max-age=${maxAge}` } : {})

const notFound = res => send(res, 404, 'text/plain; charset=utf-8', 'Not found')

// The merged file's URL has to point back at this server, as Stremio can reach it
function originOf(req) {
  if (PUBLIC_URL) return PUBLIC_URL
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || 'http'
  return `${proto}://${req.headers.host}`
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204)
  const url = new URL(req.url, 'http://localhost')
  if (req.method === 'POST' && url.pathname === '/settings') return postSettings(req, res)
  if (req.method !== 'GET') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed')

  const parts = url.pathname.split('/').filter(Boolean)
  const config = parseConfig(parts[0])
  const configSegment = config ? parts.shift() : null
  const [resource, type, rawId, last] = parts

  if (!resource) return send(res, 302, null, '', { Location: `${configSegment ? `/${configSegment}` : ''}/configure` })
  if (resource === 'configure') return send(res, 200, 'text/html; charset=utf-8', configurePage(config, getSettings()))
  if (resource === 'settings' && !config) return json(res, settingsForScript())
  if (resource === 'align' && !config) return align(res, url.searchParams)
  if (resource === 'video-length' && !config) {
    const id = url.searchParams.get('id') ?? ''
    const seconds = Number(url.searchParams.get('seconds'))
    if (!ID.test(id) || !(seconds >= 0 && seconds < 86400)) return notFound(res)
    reportVideoLength(id, seconds)
    return send(res, 204)
  }
  if (resource === 'manifest.json') {
    console.log(`[manifest] ${configSegment ?? 'unconfigured'} requested by ${req.headers.origin ?? 'no origin'}`)
    return json(res, manifest(config))
  }
  if (resource === 'translate' && type === 'warm' && !config) {
    warmUp()
    return send(res, 204)
  }
  if (resource === 'translate' && !config) return translate(res, url.searchParams)
  if (resource === 'openlinguist.user.js' && !config) {
    const script = await readFile(new URL('../userscript/openlinguist.user.js', import.meta.url))
    return send(res, 200, 'text/javascript; charset=utf-8', script)
  }
  if (!config || !TYPES.has(type) || !rawId) return notFound(res)

  if (resource === 'subtitles') {
    // Without extras the id carries the .json suffix. With them, the last
    // segment is a query string such as "videoHash=…&filename=…"
    const id = decodeURIComponent(last === undefined ? rawId.replace(/\.json$/, '') : rawId)
    if (!ID.test(id)) return notFound(res)
    const extra = pickExtra(new URLSearchParams(last?.replace(/\.json$/, '') ?? ''))
    const list = await subtitles({ config, type, id, extra, origin: originOf(req) })
    console.log(`[subtitles] ${type} ${id} ${configSegment}: ${list.length} option(s)`)
    // An empty answer may just be upstream having a bad moment, so don't let Stremio cache it for long
    return json(res, { subtitles: list, cacheMaxAge: list.length ? 3600 : 60 })
  }

  if (resource === 'dual') {
    const id = decodeURIComponent(rawId)
    const name = /^(\d|auto)\.srt$/.exec(last ?? '')?.[1]
    if (!ID.test(id) || !name) return notFound(res)
    const variant = name === 'auto' ? name : Number(name)
    const srt = await dualSrt({ config, type, id, extra: pickExtra(url.searchParams), variant })
    // "Best match" depends on the video being played, so another stream may get another file
    return send(res, 200, 'application/x-subrip; charset=utf-8', srt, { 'Cache-Control': variant === 'auto' ? 'no-store' : 'max-age=21600' })
  }

  return notFound(res)
}

function align(res, params) {
  const a = params.get('a') ?? ''
  const b = params.get('b') ?? ''
  if (a.length > 1000 || b.length > 1000) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'Line too long' }))
  // No table for this pair yet is a normal answer: the words just stay plain
  return json(res, { groups: alignCue(params.get('from'), params.get('to'), a, b) ?? [] })
}

// Reads are open to any page, as the userscript needs. Saving isn't: another
// website open in the browser mustn't be able to change these.
async function postSettings(req, res) {
  const fail = (status, error) => send(res, status, 'application/json; charset=utf-8', JSON.stringify({ error }))
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) return fail(403, 'Settings can only be changed from the configure page')
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4096) return fail(413, 'Too large')
  }
  try {
    return json(res, saveSettings(JSON.parse(body)))
  } catch (err) {
    if (err instanceof SyntaxError) return fail(400, 'Not valid JSON')
    throw err
  }
}

async function translate(res, params) {
  const text = params.get('text') ?? ''
  const start = Number(params.get('start'))
  const end = Number(params.get('end'))
  const fail = (status, error) => send(res, status, 'application/json; charset=utf-8', JSON.stringify({ error }))
  if (!(start >= 0 && end > start && end <= text.length && text.length <= 1000)) return fail(400, 'Bad word position')
  try {
    const result = await translateWord({ text, start, end, from: params.get('from'), to: params.get('to') })
    console.log(`[translate] ${text.slice(start, end)} → ${result.word}`)
    return json(res, result, 86400)
  } catch (err) {
    if (err instanceof TranslateError) return fail(503, err.message)
    console.error(`[translate] ${err.stack || err}`)
    return fail(502, 'DeepL request failed. The server console has details.')
  }
}

http
  .createServer((req, res) =>
    route(req, res).catch(err => {
      if (err instanceof NotFound) return send(res, 404, 'text/plain; charset=utf-8', err.message)
      console.error(`[error] ${req.url}: ${err.stack || err}`)
      send(res, 502, 'text/plain; charset=utf-8', 'Could not fetch subtitles from OpenSubtitles')
    }),
  )
  .listen(PORT, HOST, () => console.log(`OpenLinguist running. Configure at http://${HOST}:${PORT}/configure`))
