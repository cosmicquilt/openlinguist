// The language picker page Stremio opens from the addon's "Configure" button.
import { LANGUAGES } from './languages.js'
import { PALETTES, STYLES } from './settings.js'

const choices = (entries, selected) =>
  entries.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('')

const options = selected =>
  Object.entries(LANGUAGES)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${name} (${code})</option>`)
    .join('')

export function configurePage(config, settings) {
  const primary = config?.primary ?? settings.pair[0]
  const secondary = config?.secondary ?? settings.pair[1]
  const { colors } = settings
  const learningSecond = settings.learning === settings.pair[1]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenLinguist</title>
<style>
  :root { color-scheme: dark; --bg: #0f0d1a; --panel: #1b1830; --text: #ece9f7; --muted: #a29cbf; --accent: #7b5bf5; --line: #2e2a4a; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: 100%; max-width: 440px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 24px; }
  h1 { margin: 0; font-size: 1.5rem; }
  p { margin: 4px 0 20px; color: var(--muted); }
  label { display: block; font-size: .85rem; color: var(--muted); margin: 14px 0 6px; }
  select, input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  .swap { margin-top: 10px; background: none; border: 0; color: var(--accent); font: inherit; cursor: pointer; padding: 0; }
  .preview { margin: 20px 0; padding: 14px; border-radius: 8px; background: #000; text-align: center; text-shadow: 0 1px 2px #000; }
  .actions { display: grid; gap: 10px; }
  a.button { display: block; text-align: center; padding: 11px; border-radius: 8px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
  a.button.secondary { background: transparent; border: 1px solid var(--accent); color: var(--text); }
  .copy { display: flex; gap: 8px; }
  .copy button { flex: none; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; cursor: pointer; }
  .error { color: #ff8a8a; min-height: 1.5em; margin: 8px 0 0; font-size: .9rem; }
  h2 { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--line); font-size: 1.1rem; }
  .check { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 1rem; }
  .check input { width: auto; }
  input[type="range"] { padding: 0; accent-color: var(--accent); }
  .sample { margin: 16px 0 0; padding: 14px; border-radius: 8px; background: #000; text-align: center; color: #fff; text-shadow: 0 1px 2px #000; }
  .sample span { border-radius: .15em; }
  .saved { min-height: 1.5em; margin: 8px 0 0; font-size: .85rem; }
  [aria-disabled="true"] { opacity: .4; pointer-events: none; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>OpenLinguist</h1>
  <p>Subtitles in two languages at once, from OpenSubtitles.</p>

  <label for="primary">Top line</label>
  <select id="primary">${options(primary)}</select>
  <label for="secondary">Bottom line (italics)</label>
  <select id="secondary">${options(secondary)}</select>
  <button class="swap" id="swap" type="button">⇅ Swap languages</button>

  <div class="preview"><div id="preview-top">Top line</div><i id="preview-bottom">Bottom line</i></div>

  <div class="actions">
    <a class="button" id="install-app" hidden>Install in the Stremio app</a>
    <label for="manifest">In the Stremio app, click <b>Add addon</b> and paste this:</label>
    <div class="copy"><input id="manifest" readonly><button id="copy" type="button">Copy</button></div>
    <a class="button secondary" id="install-web" target="_blank" rel="noopener">Or install on web.stremio.com</a>
  </div>
  <p class="error" id="error"></p>

  <h2>Hover and word colours</h2>
  <label for="learning">The language I'm learning</label>
  <select id="learning">
    <option value="second"${learningSecond ? ' selected' : ''}>Bottom line</option>
    <option value="first"${learningSecond ? '' : ' selected'}>Top line</option>
  </select>
  <label class="check" for="enabled"><input type="checkbox" id="enabled"${colors.enabled ? ' checked' : ''}> Colour words that match between the two lines</label>
  <label for="palette">Palette</label>
  <select id="palette">${choices(Object.entries(PALETTES).map(([key, p]) => [key, p.name]), colors.palette)}</select>
  <label for="style">Style</label>
  <select id="style">${choices(Object.entries(STYLES), colors.style)}</select>
  <label for="opacity">Strength</label>
  <input type="range" id="opacity" min="0.1" max="0.8" step="0.05" value="${colors.opacity}">
  <div class="sample" id="sample"></div>
  <p class="saved" id="saved"></p>
</main>
<script>
  const $ = id => document.getElementById(id)
  const PALETTES = ${JSON.stringify(PALETTES)}
  // [text, colour number] for each part of the sample cue. No number means no match.
  const SAMPLE = [
    [['I', 0], [' '], ['am'], [' '], ['speaking', 1], [' '], ['to', 2], [' '], ['my', 3], [' '], ['family', 4], ['.']],
    [['Le'], [' '], ['estoy', 0], [' '], ['hablando', 1], [' '], ['a', 2], [' '], ['mi', 3], [' '], ['familia', 4], ['.']],
  ]
  function drawSample() {
    const swatches = PALETTES[$('palette').value].swatches
    const strength = +$('opacity').value
    const lines = SAMPLE.map(parts => {
      const line = document.createElement('div')
      for (const [text, n] of parts) {
        const span = document.createElement('span')
        span.textContent = text
        if (n !== undefined && $('enabled').checked) {
          // The same rule as the userscript's colourRules
          if ($('style').value === 'underline') span.style.boxShadow = 'inset 0 -.14em rgba(' + swatches[n] + ',' + Math.min(1, strength * 2) + ')'
          else span.style.background = 'rgba(' + swatches[n] + ',' + strength + ')'
        }
        line.append(span)
      }
      return line
    })
    lines[1].style.fontStyle = 'italic'
    $('sample').replaceChildren(...lines)
  }
  let saving = 0
  async function save() {
    const pair = [$('primary').value, $('secondary').value]
    if (pair[0] === pair[1]) return
    const ticket = ++saving
    const body = {
      pair,
      learning: pair[$('learning').value === 'first' ? 0 : 1],
      colors: { enabled: $('enabled').checked, palette: $('palette').value, style: $('style').value, opacity: +$('opacity').value },
    }
    try {
      const res = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error()
      if (ticket === saving) $('saved').textContent = 'Saved. The player picks this up within a line or two.'
    } catch {
      if (ticket === saving) $('saved').textContent = "Couldn't save. Is the OpenLinguist server running?"
    }
  }
  for (const id of ['learning', 'enabled', 'palette', 'style', 'opacity']) $(id).onchange = () => { drawSample(); save() }
  $('opacity').oninput = drawSample
  drawSample()
  function update() {
    const [p, s] = [$('primary'), $('secondary')]
    const same = p.value === s.value
    const url = location.origin + '/' + p.value + '-' + s.value + '/manifest.json'
    $('manifest').value = url
    $('install-app').href = url.replace(/^https?:/, 'stremio:')
    $('install-web').href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(url)
    for (const id of ['install-app', 'install-web', 'copy']) $(id).setAttribute('aria-disabled', same)
    $('error').textContent = same ? 'Pick two different languages.' : ''
    $('preview-top').textContent = p.selectedOptions[0].text.replace(/ \\(.*/, '')
    $('preview-bottom').textContent = s.selectedOptions[0].text.replace(/ \\(.*/, '')
  }
  // Stremio opens stremio:// links as https:// and drops the port, so the
  // one-click link only works once the addon is hosted with HTTPS
  $('install-app').hidden = location.protocol !== 'https:'
  $('primary').onchange = $('secondary').onchange = () => { update(); save() }
  $('swap').onclick = () => { [$('primary').value, $('secondary').value] = [$('secondary').value, $('primary').value]; $('learning').value = $('learning').value === 'first' ? 'second' : 'first'; update(); save() }
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('manifest').value); $('copy').textContent = 'Copied' }
    catch { $('manifest').select() }
  }
  update()
</script>
</body>
</html>`
}
