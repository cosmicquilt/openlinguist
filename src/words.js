// How OpenLinguist splits a line into words. The server's aligner and the
// userscript pass word positions to each other, so both must split the same
// way. The locale is fixed because the default one depends on the machine.
// The userscript holds a copy of this between the same markers, and
// test/words.test.js fails if the two differ.

// <split-words>
const segmenter = new Intl.Segmenter('und', { granularity: 'word' })
const splitWords = text =>
  [...segmenter.segment(text)].filter(s => s.isWordLike && /\p{L}/u.test(s.segment)).map(s => ({ word: s.segment, start: s.index }))
// </split-words>

export { splitWords }
