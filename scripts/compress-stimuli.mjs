/**
 * Batch-resize and recompress public/stimuli images (local tooling; not run at build).
 * JPEG: mozjpeg, PNG: max zlib effort (alpha preserved).
 */
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STIMULI_ROOT = path.join(__dirname, '..', 'public', 'stimuli')

/** Longest edge cap (pixels). */
const MAX_EDGE = 1200
/** JPEG quality 1–100 (lower = smaller). */
const JPEG_QUALITY = 68

async function* walkImages(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      yield* walkImages(full)
    } else if (/\.(jpe?g|png)$/i.test(ent.name)) {
      yield full
    }
  }
}

async function processFile(file) {
  const tmp = `${file}.tmp`
  const ext = path.extname(file).toLowerCase()
  const input = await fs.readFile(file)
  const meta = await sharp(input).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0

  let pipeline = sharp(input)
  if (w > MAX_EDGE || h > MAX_EDGE) {
    pipeline = pipeline.resize(MAX_EDGE, MAX_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    await pipeline
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toFile(tmp)
  } else {
    await pipeline
      .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true })
      .toFile(tmp)
  }

  await fs.rename(tmp, file)
}

let failed = 0
let ok = 0
for await (const file of walkImages(STIMULI_ROOT)) {
  try {
    await processFile(file)
    console.log(file.replace(STIMULI_ROOT + path.sep, ''))
    ok += 1
  } catch (e) {
    console.error('FAIL', file, e)
    failed += 1
    try {
      await fs.unlink(`${file}.tmp`)
    } catch {
      /* ignore */
    }
  }
}

console.error(`\nDone: ${ok} ok, ${failed} failed. MAX_EDGE=${MAX_EDGE}, JPEG_Q=${JPEG_QUALITY}`)
process.exit(failed ? 1 : 0)
