// Starts the official Stremio desktop app with a DevTools port open, then
// injects the hover-translate userscript into its web UI over the Chrome
// DevTools Protocol. Also starts the addon server, unless `npm start` already runs.
//
// While Stremio runs this way, any program on this PC can control its window
// through that port. Quit Stremio to close it.
import { spawn, execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const PORT = Number(process.env.STREMIO_DEBUG_PORT) || 9317
const EXE = process.env.STREMIO_EXE || `${process.env.LOCALAPPDATA}\\Programs\\Stremio\\stremio-shell-ng.exe`
const ADDON = `http://127.0.0.1:${Number(process.env.PORT) || 7000}`
const SCRIPT = await readFile(new URL('../userscript/openlinguist.user.js', import.meta.url), 'utf8')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const getJson = url => fetch(url).then(res => res.json(), () => null)
const stremioRunning = () =>
  execFileSync('tasklist', ['/FI', 'IMAGENAME eq stremio-shell-ng.exe', '/NH'], { encoding: 'utf8' }).includes('stremio-shell-ng')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!(await getJson(`${ADDON}/manifest.json`))) await import('../src/server.js')

// A Stremio that is already open ignores new browser arguments
if (!(await getJson(`http://127.0.0.1:${PORT}/json/version`))) {
  if (stremioRunning()) fail('Stremio is already open. Quit it (right-click its tray icon, Quit) and run this again.')
  // WebView2 reads extra browser arguments from this variable
  const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }
  spawn(EXE, [], { env, detached: true, stdio: 'ignore' }).unref()
}

let page
for (let i = 0; i < 60 && !page; i++) {
  const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`)
  page = targets?.find(t => t.type === 'page' && t.url.startsWith('https://web.stremio.com'))
  if (!page) await sleep(500)
}
if (!page) fail(`Stremio's page didn't show up on port ${PORT}. A Stremio update may have changed how it starts.`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
const pending = new Map()
let lastId = 0
ws.onmessage = ({ data }) => {
  const { id, result, error } = JSON.parse(data)
  pending.get(id)?.(error ? Promise.reject(new Error(error.message)) : result)
  pending.delete(id)
}
const call = (method, params) =>
  new Promise(resolve => {
    pending.set(++lastId, resolve)
    ws.send(JSON.stringify({ id: lastId, method, params }))
  })

await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = () => reject(new Error(`Couldn't connect to Stremio on port ${PORT}`))
})
// The first covers reloads of the page, the second the page as it is now.
// Scripts added this way only last while this connection is open, and only
// run once the Page domain is enabled.
await call('Page.enable')
await call('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT })
const { exceptionDetails } = await call('Runtime.evaluate', { expression: SCRIPT })
if (exceptionDetails) fail(`The userscript failed in Stremio: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)

console.log('Hover translation is on in Stremio. Keep this window open while you watch. It closes when Stremio quits.')
ws.onclose = () => process.exit(0)
