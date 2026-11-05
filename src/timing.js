// Tells apart subtitle files with different timing. Files for one episode often
// fall into a few groups: DVD or PAL speed, with or without a recap. Files in a
// group are interchangeable, so the menu only needs one from each.
import { overlapScore } from './align.js'

// Files on the same clock overlap heavily. Different speeds or a recap drop well below this.
const SAME_TIMING = 0.6
const MIN_SHARE_OF_LONGEST = 0.8
const RECAP_WINDOW = 2 * 60 * 1000
const RECAP = /previously on|last time on|anteriormente en|la última vez en|précédemment|zuvor bei|bisher bei|in precedenza/i

export const hasRecap = cues => cues.some(c => c.start < RECAP_WINDOW && RECAP.test(c.text))
export const lengthOf = cues => cues.reduce((end, c) => Math.max(end, c.end), 0)

export function formatLength(ms) {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Keeps the first file (the best ranked) of each timing group, in order. Files
// much shorter than the longest are left out: they cover only part of the video,
// like one half of a film split across CDs.
// files: [{ cues, … }]
export function distinctTimings(files, max) {
  const longest = Math.max(0, ...files.map(f => lengthOf(f.cues)))
  const kept = []
  for (const file of files) {
    if (lengthOf(file.cues) < longest * MIN_SHARE_OF_LONGEST) continue
    if (kept.length === max) break
    if (!kept.some(other => overlapScore(other.cues, file.cues) >= SAME_TIMING)) kept.push(file)
  }
  return kept
}

// Which option to use for a video of this length. A file matched by hash was
// timed for this exact video, and the top-ranked one is the answer if the
// length is unknown. A subtitle file usually ends close to the video it fits.
export function bestOption(options, videoMs) {
  const exact = options.findIndex(o => o.exact)
  if (exact >= 0) return exact
  if (!videoMs) return 0
  let best = 0
  options.forEach((option, i) => {
    if (Math.abs(lengthOf(option.cues) - videoMs) < Math.abs(lengthOf(options[best].cues) - videoMs)) best = i
  })
  return best
}
