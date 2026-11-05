// ==UserScript==
// @name         OpenLinguist hover translate
// @namespace    openlinguist
// @version      0.4.0
// @description  Colours matching words in Stremio's dual subtitles, and translates a word when you hover it
// @match        https://web.stremio.com/*
// @grant        none
// ==/UserScript==

// Runs inside the Stremio web UI: from Tampermonkey in a browser, or injected
// into the desktop app by desktop/launch.js. Translations come from the
// OpenLinguist server, which asks DeepL with the whole line as context. The
// server also says which words match between the two lines, and holds the
// settings from its configure page.
;(() => {
  if (window.__openLinguist) return
  window.__openLinguist = true

  const SERVER = 'http://127.0.0.1:7000'
  // Wait this long on a word before asking, so sweeping across a line doesn't spend DeepL quota
  const HOVER_MS = 100
  // Check for changed settings when a cue appears, at most this often
  const SETTINGS_MS = 5000

  // Used until the server answers, or if it's not running. pair is in the order
  // of the addon URL (eng-spa): the first language is the plain top line, the
  // second the italic line underneath. Words in the learning language get
  // translated into the other one.
  let settings = { pair: ['eng', 'spa'], learning: 'spa', colors: { enabled: false }, swatches: [] }
  let settingsAt = -Infinity

  function refreshSettings() {
    settingsAt = performance.now()
    return fetch(`${SERVER}/settings`)
      .then(res => res.json())
      .then(next => {
        settings = next
        paintStyles()
      })
      .catch(() => {})
  }
  // Cues wait for the first answer, so they aren't split up for the wrong language
  const ready = refreshSettings()

  // --- Video length, for the "best match" subtitle -------------------------

  // The player's URL ends with the video id, and its seek bar shows the length.
  // Each new playback first clears the old length, as a different stream of the
  // same episode can have a different one.
  let lengthHash = null
  let lengthSent = false
  let lengthCleared = Promise.resolve()

  function videoId() {
    // The last part can have a query after the id. An earlier part holds the
    // show's id, without the episode, so this has to find the last part first.
    for (const part of location.hash.split('/').reverse()) {
      const id = decodeURIComponent(part.split('?')[0])
      if (/^tt\d+(:\d+:\d+)?$/.test(id)) return id
    }
    return null
  }

  function videoSeconds() {
    const labels = document.querySelectorAll('[class*="seek-bar"] [class*="label"]')
    const parts = labels[labels.length - 1]?.textContent.split(':').map(Number)
    return parts?.every(Number.isFinite) ? parts.reduce((total, part) => total * 60 + part, 0) : 0
  }

  setInterval(() => {
    if (!location.hash.startsWith('#/player')) return void (lengthHash = null)
    const id = videoId()
    if (!id) return
    const report = seconds => fetch(`${SERVER}/video-length?${new URLSearchParams({ id, seconds })}`).catch(() => {})
    if (location.hash !== lengthHash) {
      lengthHash = location.hash
      lengthSent = false
      lengthCleared = report(0)
    }
    const seconds = videoSeconds()
    if (!lengthSent && seconds) {
      lengthSent = true
      // After the clear has landed, or it could arrive second and wipe this
      lengthCleared.then(() => report(seconds))
    }
  }, 1000)

  // --- Part 1: subtitle text ------------------------------------------------

  // stremio-video draws each cue as an inline-block, pre-wrap element inside an
  // absolutely positioned, centred box, all with inline styles. Those are
  // steadier than stremio-web's generated class names, which change between releases.
  const isCue = node =>
    node.nodeType === 1 &&
    node.style.display === 'inline-block' &&
    node.style.whiteSpace === 'pre-wrap' &&
    node.parentElement?.style.position === 'absolute' &&
    node.parentElement.style.textAlign === 'center'

  // A cue is rebuilt only when the next one starts, so its spans stay put while it's on screen
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (isCue(node)) ready.then(() => wrapWords(node))
    // The line changed under a mouse that hasn't moved
    if (active && !active.isConnected) hover(wordAt(pointer.x, pointer.y))
  }).observe(document, { childList: true, subtree: true })

  // A cue's text nodes by language: the second language of the pair is inside
  // <i>, the first outside
  function textByLanguage(cue) {
    const nodes = { first: [], second: [] }
    const walker = document.createTreeWalker(cue, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      let italic = false
      for (let el = walker.currentNode.parentElement; el !== cue; el = el.parentElement) italic ||= el.tagName === 'I'
      nodes[italic ? 'second' : 'first'].push(walker.currentNode)
    }
    return nodes
  }

  // --- Part 2: words, hover, translation ------------------------------------

  // A copy of src/words.js. test/words.test.js fails if the two differ.
  // <split-words>
  const segmenter = new Intl.Segmenter('und', { granularity: 'word' })
  const splitWords = text =>
    [...segmenter.segment(text)].filter(s => s.isWordLike && /\p{L}/u.test(s.segment)).map(s => ({ word: s.segment, start: s.index }))
  // </split-words>

  const wrapped = new WeakSet()
  const words = new WeakMap() // span -> { word, text, start, end }, offsets into text
  const spans = document.getElementsByClassName('ol-word') // live, so checking its length is cheap
  const cache = new Map() // request URL -> promise of { word, line }
  const pointer = { x: 0, y: 0 }
  let active = null
  let timer = 0
  let frame = 0
  let tip = null
  let style = null
  let warmedAt = -Infinity

  function wrapWords(cue) {
    if (wrapped.has(cue) || !cue.isConnected) return
    wrapped.add(cue)
    if (!style) paintStyles()
    if (performance.now() - settingsAt > SETTINGS_MS) refreshSettings()
    const nodes = textByLanguage(cue)
    const learningIsSecond = settings.pair[1] === settings.learning
    const first = wrapLine(nodes.first, !learningIsSecond)
    const second = wrapLine(nodes.second, learningIsSecond)
    if (settings.colors.enabled && first.spans.length && second.spans.length) colourWords(first, second)
  }

  // Puts each word of one language's text nodes in a span. Only the learning
  // language's can be hovered. Nodes are joined with \n, which always ends a
  // word, so the server finds the same words in the joined text.
  function wrapLine(nodes, hoverable) {
    const text = nodes.map(n => n.data).join('\n')
    const lineSpans = []
    let offset = 0
    for (const node of nodes) {
      const parts = []
      let last = 0
      for (const { word, start } of splitWords(node.data)) {
        if (start > last) parts.push(node.data.slice(last, start))
        const span = document.createElement('span')
        span.className = hoverable ? 'ol-word' : 'ol-token'
        span.textContent = word
        if (hoverable) words.set(span, { word, text, start: offset + start, end: offset + start + word.length })
        lineSpans.push(span)
        parts.push(span)
        last = start + word.length
      }
      if (last < node.data.length) parts.push(node.data.slice(last))
      offset += node.data.length + 1
      node.replaceWith(...parts)
    }
    return { text, spans: lineSpans }
  }

  // Gives matching words the same colour number. Groups come in reading order,
  // so neighbouring words get different colours. If this fails, the words just stay plain.
  async function colourWords(first, second) {
    const [from, to] = settings.pair
    try {
      const res = await fetch(`${SERVER}/align?${new URLSearchParams({ from, to, a: first.text, b: second.text })}`)
      const { groups } = await res.json()
      groups.forEach((group, n) => {
        const colour = `ol-c${n % settings.swatches.length}`
        for (const i of group.a) first.spans[i]?.classList.add(colour)
        for (const j of group.b) second.spans[j]?.classList.add(colour)
      })
    } catch {}
  }

  function colourRules({ colors, swatches }) {
    if (!colors.enabled) return ''
    return swatches
      .map((rgb, n) =>
        colors.style === 'underline'
          ? // A thin line needs more strength than a tint to show up as much
            `.ol-c${n} { box-shadow: inset 0 -.14em rgba(${rgb}, ${Math.min(1, colors.opacity * 2)}) }`
          : `.ol-c${n} { background: rgba(${rgb}, ${colors.opacity}) }`,
      )
      .join('\n')
  }

  function paintStyles() {
    if (!document.head) return // a settings answer can arrive this early. The first cue paints them.
    style ||= document.head.appendChild(document.createElement('style'))
    style.textContent = CSS + colourRules(settings)
  }

  const wordAt = (x, y) => (spans.length && document.elementsFromPoint(x, y).find(el => words.has(el))) || null

  // On the window and capturing, so it sees the pointer even where Stremio's
  // player layers cover the subtitles
  addEventListener(
    'pointermove',
    e => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      // Moving the mouse while words are on screen usually means a hover is coming.
      // Have the server open its DeepL connection now, which saves ~300 ms.
      if (spans.length && e.timeStamp - warmedAt > 3000) {
        warmedAt = e.timeStamp
        fetch(`${SERVER}/translate/warm`).catch(() => {})
      }
      frame ||= requestAnimationFrame(() => {
        frame = 0
        hover(wordAt(pointer.x, pointer.y))
      })
    },
    { capture: true, passive: true },
  )

  function hover(span) {
    if (span === active) return
    active?.classList.remove('ol-active')
    active = span
    clearTimeout(timer)
    tip?.remove()
    if (!span) return
    span.classList.add('ol-active')
    timer = setTimeout(() => showTranslation(span), cache.has(requestUrl(words.get(span))) ? 0 : HOVER_MS)
  }

  async function showTranslation(span) {
    showTip(span, '…')
    try {
      const { word, line } = await translate(words.get(span))
      if (span === active) showTip(span, word, line)
    } catch (err) {
      if (span === active) showTip(span, err.message)
    }
  }

  const requestUrl = ({ text, start, end }) => {
    const from = settings.learning
    const to = settings.pair.find(code => code !== from)
    return `${SERVER}/translate?${new URLSearchParams({ from, to, text, start, end })}`
  }

  function translate(info) {
    const url = requestUrl(info)
    if (!cache.has(url)) {
      const request = fetch(url).then(
        async res => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || `OpenLinguist server error ${res.status}`)
          return body
        },
        () => {
          throw new Error(`Can't reach the OpenLinguist server at ${SERVER}. Is it running?`)
        },
      )
      // Forget failures, so the next hover tries again
      request.catch(() => cache.delete(url))
      cache.set(url, request)
    }
    return cache.get(url)
  }

  function showTip(span, main, detail) {
    tip ||= Object.assign(document.createElement('div'), { className: 'ol-tip' })
    tip.replaceChildren(main)
    if (detail) tip.append(Object.assign(document.createElement('small'), { textContent: detail }))
    // In browser fullscreen only the fullscreen element's subtree is drawn
    ;(document.fullscreenElement || document.body).append(tip)
    const box = span.getBoundingClientRect()
    const half = tip.offsetWidth / 2
    tip.style.left = `${Math.min(Math.max(box.left + box.width / 2, half + 8), innerWidth - half - 8)}px`
    // Above the whole cue rather than the word, so the other language's line stays readable
    tip.style.top = `${span.closest('div').getBoundingClientRect().top}px`
  }

  // v3 hook: clicking a word will open a dictionary site. Until then clicks
  // carry on to the player as usual.
  function onWordClick({ word, text }) {}
  addEventListener(
    'click',
    e => {
      const span = wordAt(e.clientX, e.clientY)
      if (span) onWordClick(words.get(span))
    },
    true,
  )

  const CSS = `
    .ol-word, .ol-token { border-radius: .15em }
    .ol-word { pointer-events: auto !important; cursor: help }
    .ol-word.ol-active { background: rgba(255, 255, 255, .3) }
    .ol-tip {
      position: fixed; z-index: 2147483647; pointer-events: none;
      transform: translate(-50%, calc(-100% - .5em));
      max-width: min(30em, 90vw); padding: .4em .7em; border-radius: .5em; text-align: center;
      background: rgba(18, 18, 22, .94); color: #fff; box-shadow: 0 .2em 1em rgba(0, 0, 0, .5);
      font: 600 clamp(15px, 2.6vmin, 30px)/1.3 system-ui, sans-serif;
    }
    .ol-tip small { display: block; margin-top: .2em; font-size: .68em; font-weight: 400; opacity: .75 }
  `

  // The desktop launcher can inject this while a cue is already on screen
  for (const el of document.querySelectorAll('div')) if (isCue(el)) ready.then(() => wrapWords(el))
})()
