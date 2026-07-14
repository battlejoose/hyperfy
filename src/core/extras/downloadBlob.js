/**
 * Streaming blob download with automatic resume.
 *
 * Heroku dynos frequently kill large transfers mid-stream — Chrome reports
 * net::ERR_FAILED with HTTP 200 because the headers arrived but the body died.
 * A plain fetch/XHR retry restarts the whole download from byte 0 and tends to
 * die again. Instead we stream the body, keep every chunk we've received, and
 * on failure resume from the last byte with an HTTP Range request, so a 13MB
 * download only ever has to re-fetch the missing tail.
 */

const BACKOFFS_MS = [0, 1000, 2000, 4000]
const READ_STALL_TIMEOUT_MS = 30000

function readWithTimeout(reader, ms) {
  let timer
  return Promise.race([
    reader.read(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('download stalled')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function downloadBlob(url, { onProgress, noCache = false } = {}) {
  const chunks = []
  let received = 0
  let total = 0
  let type = ''
  let lastErr
  for (let attempt = 0; attempt < BACKOFFS_MS.length; attempt++) {
    if (BACKOFFS_MS[attempt]) await new Promise(r => setTimeout(r, BACKOFFS_MS[attempt]))
    let reader
    try {
      const resuming = received > 0
      const resp = await fetch(url, {
        headers: resuming ? { Range: `bytes=${received}-` } : undefined,
        // after any failure skip the HTTP cache — a truncated cached body would
        // just fail again. Range requests must also bypass it.
        cache: attempt === 0 && !noCache ? 'default' : 'no-store',
      })
      if (resuming && resp.status !== 206) {
        // server ignored the range request, start over with the full body
        chunks.length = 0
        received = 0
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      if (!type) type = resp.headers.get('Content-Type') || ''
      const contentRange = resp.headers.get('Content-Range')
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)\s*$/)
        if (match) total = parseInt(match[1], 10)
      } else {
        const len = parseInt(resp.headers.get('Content-Length') || '0', 10)
        if (len) total = received + len
      }
      if (!resp.body) {
        // no streaming support (very old browser) — one-shot download
        const blob = await resp.blob()
        onProgress?.(blob.size, blob.size)
        return blob
      }
      reader = resp.body.getReader()
      while (true) {
        const { done, value } = await readWithTimeout(reader, READ_STALL_TIMEOUT_MS)
        if (done) break
        chunks.push(value)
        received += value.byteLength
        onProgress?.(received, total)
      }
      if (total && received < total) {
        throw new Error(`incomplete download (${received}/${total} bytes)`)
      }
      if (!received) throw new Error('empty response')
      return new Blob(chunks, { type })
    } catch (err) {
      lastErr = err
      reader?.cancel().catch(() => {})
      console.warn(
        `[download] attempt ${attempt + 1}/${BACKOFFS_MS.length} for ${url} failed at ${received} bytes:`,
        err.message || err
      )
    }
  }
  throw lastErr
}
