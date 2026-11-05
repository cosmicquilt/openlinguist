// Settings shared by the configure page and the userscript. The server stores
// them in settings.json, as the two run on different origins and can't share
// browser storage. Everything read or received passes through normalizeSettings.
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../settings.json', import.meta.url)

// Muted on purpose: they sit behind white text over video. Six per palette,
// as neighbouring groups only need to differ from each other.
export const PALETTES = {
  soft: { name: 'Soft', swatches: ['125,160,200', '150,185,140', '215,185,125', '200,140,150', '165,145,205', '120,185,180'] },
  warm: { name: 'Warm', swatches: ['215,170,120', '200,135,120', '215,195,130', '190,140,165', '180,155,125', '220,155,145'] },
  cool: { name: 'Cool', swatches: ['120,160,205', '125,190,185', '155,145,210', '130,185,150', '110,135,190', '165,190,215'] },
  grey: { name: 'Greyscale', swatches: ['235,235,235', '150,150,150', '200,200,200', '115,115,115', '175,175,175', '220,220,220'] },
}
export const STYLES = { tint: 'Background tint', underline: 'Underline' }

export const DEFAULTS = {
  pair: ['eng', 'spa'],
  learning: 'spa',
  colors: { enabled: true, palette: 'soft', opacity: 0.45, style: 'tint' },
}

const CODE = /^[a-z]{2,3}$/

// Keeps what's valid in the input and fills in the rest from the defaults
export function normalizeSettings(input) {
  const pair =
    Array.isArray(input?.pair) && input.pair.length === 2 && input.pair.every(c => CODE.test(c)) && input.pair[0] !== input.pair[1]
      ? [...input.pair]
      : [...DEFAULTS.pair]
  const colors = input?.colors ?? {}
  const opacity = Number(colors.opacity)
  return {
    pair,
    learning: pair.includes(input?.learning) ? input.learning : pair[1],
    colors: {
      enabled: typeof colors.enabled === 'boolean' ? colors.enabled : DEFAULTS.colors.enabled,
      palette: Object.hasOwn(PALETTES, colors.palette ?? '') ? colors.palette : DEFAULTS.colors.palette,
      opacity: colors.opacity != null && Number.isFinite(opacity) ? Math.min(0.8, Math.max(0.1, opacity)) : DEFAULTS.colors.opacity,
      style: Object.hasOwn(STYLES, colors.style ?? '') ? colors.style : DEFAULTS.colors.style,
    },
  }
}

let current = null

export function getSettings() {
  if (!current) {
    let stored = null
    try {
      stored = JSON.parse(readFileSync(FILE, 'utf8'))
    } catch (err) {
      // No file yet just means defaults. A damaged one is worth a warning.
      if (err.code !== 'ENOENT') console.warn(`[settings] Ignoring settings.json: ${err.message}`)
    }
    current = normalizeSettings(stored)
  }
  return current
}

export function saveSettings(input) {
  current = normalizeSettings(input)
  writeFileSync(FILE, `${JSON.stringify(current, null, 2)}\n`)
  return current
}

// What the userscript reads: the settings plus the chosen palette's colours
export const settingsForScript = () => {
  const settings = getSettings()
  return { ...settings, swatches: PALETTES[settings.colors.palette].swatches }
}
