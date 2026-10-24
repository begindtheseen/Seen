// The brand fonts for server-rendered share images (satori / next/og). Satori cannot load web
// fonts, so the OG unfurl reads the same Syne + Instrument Sans the canvas cards use from the
// static TTFs vendored in assets/fonts (OFL 1.1). Loaded once per process and cached; a missing
// file throws so a deploy without the fonts fails loudly instead of unfurling in Noto Sans.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type CardFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 800; style: 'normal' }

const FILES: { file: string; name: string; weight: CardFont['weight'] }[] = [
  { file: 'Syne-800.ttf', name: 'Syne', weight: 800 },
  { file: 'InstrumentSans-400.ttf', name: 'Instrument Sans', weight: 400 },
  { file: 'InstrumentSans-500.ttf', name: 'Instrument Sans', weight: 500 },
  { file: 'InstrumentSans-600.ttf', name: 'Instrument Sans', weight: 600 },
]

let cached: Promise<CardFont[]> | null = null

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Syne 800 + Instrument Sans 400/500/600 as satori font entries. Cached for the process. */
export function loadCardFonts(): Promise<CardFont[]> {
  if (!cached) {
    cached = Promise.all(FILES.map(async f => ({
      name: f.name,
      weight: f.weight,
      style: 'normal' as const,
      data: toArrayBuffer(await readFile(join(process.cwd(), 'assets', 'fonts', f.file))),
    }))).catch(e => { cached = null; throw e })
  }
  return cached
}
