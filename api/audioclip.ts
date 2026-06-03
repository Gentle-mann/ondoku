// Vercel Edge Function — extracts an audio clip from a GitHub release MP3.
//
// GitHub release downloads redirect (302) to a signed CDN URL.
// Range headers are dropped on redirects, so we must:
//   1. Follow the redirect (no Range) to discover the real CDN URL
//   2. Probe the CDN URL directly with Range: bytes=0-0 to get total file size
//   3. Fetch the actual clip range directly from the CDN URL
//
// GET /api/audioclip?ep=0&start=207.56&end=211.06&duration=654.32
// Returns: { filename: "ondoku_ep01_...", data: "<base64 mp3>" }

export const config = { runtime: 'edge' }

const BASE = 'https://github.com/Gentle-mann/ondoku/releases/download/v1.0'
const EP_FILES = Array.from(
  { length: 8 },
  (_, i) => `yanerura_N1_2_ep${String(i + 1).padStart(2, '0')}.mp3`
)
const PAD_START = 1.5
const PAD_END = 0.3

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors() })
  }

  const p = new URL(req.url).searchParams
  const ep = parseInt(p.get('ep') ?? '')
  const start = parseFloat(p.get('start') ?? '')
  const end = parseFloat(p.get('end') ?? '')
  const duration = parseFloat(p.get('duration') ?? '')

  if ([ep, start, end, duration].some(isNaN) || ep < 0 || ep >= 8 || duration <= 0) {
    return err(400, 'invalid params')
  }

  const githubUrl = `${BASE}/${EP_FILES[ep]}`
  const ep1 = String(ep + 1).padStart(2, '0')

  // ── Step 1: Resolve GitHub's 302 redirect → actual CDN URL ──────────────
  // We fetch without a Range header and immediately cancel the body.
  // After following the redirect, response.url is the signed CDN URL.
  let cdnUrl: string
  try {
    const r = await fetch(githubUrl, { redirect: 'follow' })
    await r.body?.cancel()
    cdnUrl = r.url || githubUrl
  } catch (e) {
    return err(502, `redirect resolve failed: ${e}`)
  }

  // ── Step 2: Probe CDN directly (no redirect) to get total file size ──────
  let totalBytes = 0
  try {
    const probe = await fetch(cdnUrl, { headers: { Range: 'bytes=0-0' } })
    await probe.body?.cancel()
    const cr = probe.headers.get('content-range') // "bytes 0-0/16777216"
    const m = cr?.match(/\/(\d+)$/)
    if (m) totalBytes = parseInt(m[1])
  } catch {}

  if (!totalBytes) totalBytes = Math.ceil(duration * 16000) // 128 kbps fallback

  // ── Step 3: Fetch the clip range from CDN ────────────────────────────────
  const bps = totalBytes / duration
  const ps = Math.max(0, start - PAD_START)
  const pe = end + PAD_END
  const s = Math.max(0, Math.floor(ps * bps))
  const e2 = Math.min(totalBytes - 1, Math.ceil(pe * bps))
  const filename = `ondoku_ep${ep1}_${Math.round(ps * 1000)}_${Math.round(pe * 1000)}.mp3`

  const clip = await fetch(cdnUrl, { headers: { Range: `bytes=${s}-${e2}` } })
  if (!clip.ok && clip.status !== 206) return err(502, `cdn ${clip.status}`)

  const buf = await clip.arrayBuffer()
  if (buf.byteLength === 0) return err(502, 'empty response')

  // Base64 encode in chunks
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)

  return new Response(JSON.stringify({ filename, data: base64 }), {
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function err(status: number, msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  })
}
