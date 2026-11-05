// Lines a secondary subtitle up with the primary one, then merges the two into
// dual-language cues. Subtitles for different releases of the same video are
// often offset by seconds, or drift because they were timed at another frame rate.

// A 25fps (PAL) subtitle on a 23.976fps video drifts steadily. A constant
// offset can't fix that, so a speed factor is searched too.
const SCALES = [1, 25 / 23.976, 23.976 / 25]
const MAX_OFFSET = 20000
const COARSE_STEP = 250
const FINE_STEP = 25

export function shift(cues, { scale, offset }) {
  return cues.map(c => ({ ...c, start: c.start * scale + offset, end: c.end * scale + offset }))
}

const totalDuration = cues => cues.reduce((sum, c) => sum + (c.end - c.start), 0)

// On-screen time the two files share, divided by the larger total. Dividing by
// the larger one stops a file of long cues that cover everything from scoring well.
// Both lists must be sorted by start time.
export function overlapScore(a, b, scale = 1, offset = 0) {
  let shared = 0
  let j = 0
  for (const cue of a) {
    while (j < b.length && b[j].end * scale + offset <= cue.start) j++
    for (let k = j; k < b.length && b[k].start * scale + offset < cue.end; k++) {
      const overlap = Math.min(cue.end, b[k].end * scale + offset) - Math.max(cue.start, b[k].start * scale + offset)
      if (overlap > 0) shared += overlap
    }
  }
  const total = Math.max(totalDuration(a), totalDuration(b) * scale)
  return total ? shared / total : 0
}

// Brute-force grid search, coarse then fine. A few thousand overlap passes over
// ~1000 cues each takes well under a second, and unlike a smarter search it
// can't get stuck on a local peak.
export function findBestShift(primary, secondary) {
  let best = { scale: 1, offset: 0, score: -1 }
  const consider = (scale, offset) => {
    const score = overlapScore(primary, secondary, scale, offset)
    if (score > best.score) best = { scale, offset, score }
  }
  // Searching outward from zero means ties go to the smallest shift
  for (const scale of SCALES) {
    for (let step = 0; step * COARSE_STEP <= MAX_OFFSET; step++) {
      consider(scale, step * COARSE_STEP)
      if (step) consider(scale, -step * COARSE_STEP)
    }
  }
  const { scale, offset } = best
  for (let o = offset - COARSE_STEP; o <= offset + COARSE_STEP; o += FINE_STEP) consider(scale, o)
  return best
}

// Primary cues keep their timing. Each secondary cue is attached to the
// primary cue it overlaps most. A secondary cue that overlaps nothing still
// gets shown on its own, so no line of the second language is lost.
export function mergeDual(primary, secondary) {
  const merged = primary.map(c => ({ ...c, extra: [] }))
  const unmatched = []
  let p = 0
  for (const sub of secondary) {
    while (p < merged.length && merged[p].end <= sub.start) p++
    let best = null
    let bestOverlap = 0
    for (let k = p; k < merged.length && merged[k].start < sub.end; k++) {
      const overlap = Math.min(merged[k].end, sub.end) - Math.max(merged[k].start, sub.start)
      if (overlap > bestOverlap) [best, bestOverlap] = [merged[k], overlap]
    }
    if (best) best.extra.push(sub.text)
    else unmatched.push(sub)
  }
  return [
    ...merged.map(({ extra, ...c }) => (extra.length ? { ...c, text: `${c.text}\n${secondLine(extra.join('\n'))}` } : c)),
    ...unmatched.map(c => ({ ...c, text: secondLine(c.text) })),
  ].sort((a, b) => a.start - b.start)
}

// Italics tell the two languages apart. <i> is the one SRT tag both mpv and
// the web player render. <font color> is not safe everywhere.
const secondLine = text => `<i>${text}</i>`
