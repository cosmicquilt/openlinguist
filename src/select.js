// Ranks upstream subtitle files for one language. The upstream list is noisy:
// files split across CDs, episodes filed under the wrong number, and dozens of
// releases with slightly different timing.

const tokens = s => new Set((s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1))

const MULTI_PART = /(^|[^a-z0-9])cd\s*\d([^0-9]|$)/i
const EPISODE_TAG = /s(\d{1,2})\s*e(\d{1,3})|(?:^|[^0-9])(\d{1,2})x(\d{2})(?:[^0-9]|$)/i

function scoreCandidate(sub, hints, wanted) {
  let score = 0
  // 'i' means it matched only by IMDb id. Any other match type, such as a
  // video file hash, means it was timed for this exact file.
  if (sub.m && sub.m !== 'i') score += 100

  const name = `${sub.subtitleFileName || ''} ${sub.movieReleaseName || ''}`
  // CD1/CD2 files cover only part of the video
  if (MULTI_PART.test(name)) score -= 50

  const tag = EPISODE_TAG.exec(sub.subtitleFileName || '')
  if (tag && hints.season != null) {
    const [season, episode] = tag[1] ? [tag[1], tag[2]] : [tag[3], tag[4]]
    if (+season !== hints.season || +episode !== hints.episode) score -= 100
  }

  if (wanted.size) {
    const group = (sub.releaseGroup || '').toLowerCase()
    if (group && wanted.has(group)) score += 20
    for (const t of tokens(name)) if (wanted.has(t)) score += 5
  }
  return score
}

// hints: { filename?, season?, episode? } taken from the Stremio request
export function rankCandidates(subs, lang, hints = {}) {
  const wanted = tokens(hints.filename)
  return subs
    .map((sub, i) => ({ sub, i }))
    .filter(({ sub }) => sub.lang === lang && sub.url)
    .map(r => ({ ...r, score: scoreCandidate(r.sub, hints, wanted) }))
    // Upstream order breaks ties, since upstream already sorts by popularity
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(r => r.sub)
}
