// Translates one subtitle word in the context of its line, through DeepL.
// The word is wrapped in a tag and the whole line is sent with
// tag_handling=xml. DeepL keeps the tag around the word's translation, which
// gives its meaning in this sentence, plus the line's translation for free.
import { languageName } from './languages.js'

// OpenSubtitles codes to DeepL's. Targets need a variant for English,
// Portuguese and Chinese script.
const SOURCE = {
  eng: 'EN', spa: 'ES', fre: 'FR', ger: 'DE', ita: 'IT', por: 'PT', pob: 'PT', nld: 'NL',
  rus: 'RU', ukr: 'UK', pol: 'PL', cze: 'CS', slo: 'SK', hun: 'HU', ron: 'RO', bul: 'BG',
  slv: 'SL', ell: 'EL', tur: 'TR', ara: 'AR', chi: 'ZH', zht: 'ZH', jpn: 'JA', kor: 'KO',
  ind: 'ID', swe: 'SV', nor: 'NB', dan: 'DA', fin: 'FI', est: 'ET', lav: 'LV', lit: 'LT',
}
const TARGET = { ...SOURCE, eng: 'EN-US', por: 'PT-PT', pob: 'PT-BR', chi: 'ZH-HANS', zht: 'ZH-HANT' }

// Errors worth showing in the tooltip as they are
export class TranslateError extends Error {}

const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescape = s =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

export const markWord = (text, start, end) =>
  `${escape(text.slice(0, start))}<w>${escape(text.slice(start, end))}</w>${escape(text.slice(end))}`

// The word's translation (null if DeepL dropped or emptied the tag) and the whole line
export function readMarked(xml) {
  const word = /<w>([\s\S]*?)<\/w>/.exec(xml)?.[1]
  return {
    word: (word && unescape(word).trim()) || null,
    line: unescape(xml.replace(/<\/?w\/?>/g, '')).replace(/\s+/g, ' ').trim(),
  }
}

// Read on each call rather than at import, after server.js has loaded .env
const apiKey = () => process.env.DEEPL_API_KEY
// Free-plan keys end in ":fx" and have their own host
const apiHost = key => (key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com')

// A new connection to DeepL adds about 300 ms, and fetch closes idle ones
// after about 4 seconds. The userscript calls this when the mouse moves over
// subtitles, so a connection is open by the time it reaches a word.
// /v2/usage costs no characters.
let warmedAt = 0
export function warmUp() {
  const key = apiKey()
  if (!key || Date.now() - warmedAt < 2000) return
  warmedAt = Date.now()
  fetch(`${apiHost(key)}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${key}` } })
    .then(res => res.arrayBuffer()) // read to the end, so the connection goes back to the pool
    .catch(() => {})
}

async function deepl(text, source, target, xml) {
  const key = apiKey()
  if (!key) throw new TranslateError('Add your DeepL API key to .env, then restart OpenLinguist (see README)')
  const res = await fetch(`${apiHost(key)}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [text], source_lang: source, target_lang: target, ...(xml && { tag_handling: 'xml' }) }),
  })
  if (res.status === 403) throw new TranslateError('DeepL rejected the API key in .env')
  if (res.status === 456) throw new TranslateError('Your DeepL character allowance is used up')
  if (!res.ok) throw new Error(`DeepL answered ${res.status}: ${await res.text()}`)
  return (await res.json()).translations[0].text
}

export async function translateWord({ text, start, end, from, to }) {
  const source = SOURCE[from]
  const target = TARGET[to]
  if (!source || !target) throw new TranslateError(`DeepL can't translate ${languageName(from)} to ${languageName(to)}`)
  // Cues break lines with \n. Swapping each for a space keeps the offsets valid.
  text = text.replace(/\s/g, ' ')
  const { word, line } = readMarked(await deepl(markWord(text, start, end), source, target, true))
  // DeepL sometimes drops the tag, e.g. when the word merges into a phrase.
  // Then the word alone, without context, is the best there is.
  return { word: word ?? (await deepl(text.slice(start, end), source, target, false)), line }
}
