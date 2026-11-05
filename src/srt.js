// Minimal SubRip (.srt) reading and writing. Cue times are milliseconds.

const TIMING = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms.padEnd(3, '0')

// Real-world files are sloppy: BOMs, mixed line endings, missing index lines,
// "." instead of "," in timestamps. Only the timing line is trusted.
export function parseSrt(text) {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const cues = []
  let cue = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const t = TIMING.exec(line)
    if (t) {
      cue = { start: toMs(t[1], t[2], t[3], t[4]), end: toMs(t[5], t[6], t[7], t[8]), lines: [] }
      cues.push(cue)
    } else if (!line) {
      cue = null
    } else if (cue && !(/^\d+$/.test(line) && TIMING.test(lines[i + 1] ?? ''))) {
      // The guard skips a cue index when the blank line before it is missing
      cue.lines.push(line)
    }
  }
  return cues
    .map(c => ({ start: c.start, end: c.end, text: cleanText(c.lines) }))
    .filter(c => c.text && c.end > c.start)
    .sort((a, b) => a.start - b.start)
}

// ASS override tags like {\an8} position a cue at the top of the screen. In a
// merged cue that would drag the other language along, so drop them.
function cleanText(lines) {
  return lines
    .map(l => l.replace(/\{\\[^}]*\}/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

const pad = (n, width = 2) => String(n).padStart(width, '0')

function stamp(ms) {
  ms = Math.max(0, Math.round(ms))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor(ms / 60000) % 60
  const s = Math.floor(ms / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

export function formatSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n')
}
