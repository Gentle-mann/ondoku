// Vercel Serverless Function — CORS proxy for GitHub release audio assets.
// Adds Access-Control-Allow-Origin: * so the browser can do Range requests.
// GET /api/audio?file=yanerura_N1_2_ep01.mp3  (with optional Range header)

const BASE = 'https://github.com/Gentle-mann/ondoku/releases/download/v1.0'
const ALLOWED = /^yanerura_N1_2_ep\d{2}\.mp3$/

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const file = new URL(req.url).searchParams.get('file') ?? ''
  if (!ALLOWED.test(file)) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    })
  }

  const upstream = `${BASE}/${file}`
  const range = req.headers.get('range')
  const upstreamRes = await fetch(upstream, {
    headers: range ? { Range: range } : {},
  })

  const out: Record<string, string> = {
    ...corsHeaders(),
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=604800',
  }
  for (const h of ['content-range', 'content-length']) {
    const v = upstreamRes.headers.get(h)
    if (v) out[h] = v
  }

  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: out })
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
  }
}

export const config = { runtime: 'edge' }
