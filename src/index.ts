import { Hono } from 'hono'
import {
  fetchContributionCalendar,
  GitHubFetchError,
  isValidUsername,
  parseContributionHtml
} from './github'
import { renderContributionSvg, renderErrorSvg } from './render'
import staticContributionHtml from '../test/fixtures/iplanwebsites-contributions.html'

type Bindings = {
  ENVIRONMENT?: string
  USERS: KVNamespace
}

type UserRecord = {
  username: string
  createdAt: string
}

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void
}

const app = new Hono<{ Bindings: Bindings }>()
const CACHE_SECONDS = 86400
const RENDERER_CACHE_VERSION = '4'
let demoCalendar: ReturnType<typeof parseContributionHtml> | undefined

function imageHeaders(development: boolean): Headers {
  const headers = new Headers({
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  })

  if (development) {
    headers.set('Cache-Control', 'no-store, max-age=0')
    headers.set('CDN-Cache-Control', 'no-store')
  } else {
    headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`)
    headers.set('Expires', new Date(Date.now() + CACHE_SECONDS * 1000).toUTCString())
  }
  return headers
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export async function hashUsername(username: string): Promise<string> {
  const bytes = new TextEncoder().encode(username.toLowerCase())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(18)))
}

function homepage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GitHub Summary</title>
  <style>
    :root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}body{max-width:820px;margin:70px auto;padding:0 22px;background:#0d1117;color:#f0f6fc}h1{font-size:42px;letter-spacing:-1.5px;margin-bottom:8px}.sub{color:#9198a1;font-size:18px}form{display:flex;gap:10px;margin:34px 0}input,button{font:inherit;border-radius:8px;padding:12px 14px;border:1px solid #30363d}input{flex:1;background:#161b22;color:#f0f6fc}button{background:#238636;color:white;border-color:#2ea043;font-weight:600;cursor:pointer}button:disabled{opacity:.6}#result{display:none;margin-top:30px}img{display:block;width:100%;margin:20px 0;border-radius:10px}pre{white-space:pre-wrap;word-break:break-all;background:#161b22;padding:14px;border:1px solid #30363d;border-radius:8px}.error{color:#ff7b72}
  </style>
</head>
<body>
  <h1>GitHub Summary</h1>
  <p class="sub">Create a private, shareable URL for an isometric contribution summary.</p>
  <img src="/demo" alt="Example contribution summary">
  <form id="create"><input id="username" name="username" autocomplete="off" placeholder="GitHub username" required pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?"><button>Create</button></form>
  <p id="status"></p>
  <section id="result"><img id="preview" alt="GitHub contribution summary"><strong>Image URL</strong><pre id="url"></pre><strong>GitHub Markdown</strong><pre id="markdown"></pre></section>
  <script>
    const form=document.querySelector('#create'),status=document.querySelector('#status'),result=document.querySelector('#result');
    form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.className='';status.textContent='Creating…';result.style.display='none';try{const response=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:form.username.value.trim()})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not create URL');document.querySelector('#preview').src=data.url;document.querySelector('#url').textContent=data.url;document.querySelector('#markdown').textContent='![GitHub contribution summary]('+data.url+')';result.style.display='block';status.textContent='Ready. Add ?v=anything to the image URL to refresh it before the 24-hour cache expires.'}catch(error){status.className='error';status.textContent=error.message}finally{button.disabled=false}});
  </script>
</body>
</html>`
}

async function imageResponse(
  request: Request,
  username: string,
  environment: string | undefined,
  executionCtx: WaitUntilContext
): Promise<Response> {
  const url = new URL(request.url)
  const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const development = environment !== 'production'
  const busting = url.search.length > 0
  const headers = imageHeaders(development)

  if (!isValidUsername(username)) {
    return new Response(renderErrorSvg('Invalid GitHub username', theme), { status: 400, headers })
  }

  const cache = caches.default
  const cacheUrl = new URL(url)
  cacheUrl.searchParams.set('__renderer', RENDERER_CACHE_VERSION)
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' })
  if (!development) {
    const cached = await cache.match(cacheKey)
    if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached
  }

  try {
    // A query string creates a new rendered-image key and also bypasses the
    // upstream GitHub HTML cache, making ?v=<timestamp> a true refresh.
    const calendar = await fetchContributionCalendar(username, development || busting)
    const response = new Response(renderContributionSvg(username, calendar, theme), { headers })
    if (!development) executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return request.method === 'HEAD' ? new Response(null, response) : response
  } catch (error) {
    const status = error instanceof GitHubFetchError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Unexpected rendering error'
    return new Response(renderErrorSvg(message, theme), { status, headers })
  }
}

async function demoImageResponse(
  request: Request,
  environment: string | undefined,
  executionCtx: WaitUntilContext
): Promise<Response> {
  const url = new URL(request.url)
  const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
  const development = environment !== 'production'
  const headers = imageHeaders(development)
  const cache = caches.default
  const cacheUrl = new URL(url)
  cacheUrl.searchParams.set('__renderer', RENDERER_CACHE_VERSION)
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' })

  if (!development) {
    const cached = await cache.match(cacheKey)
    if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached
  }

  demoCalendar ??= parseContributionHtml(staticContributionHtml)
  const response = new Response(
    renderContributionSvg('iplanwebsites', demoCalendar, theme),
    { headers }
  )
  if (!development) executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
  return request.method === 'HEAD' ? new Response(null, response) : response
}

app.get('/', (c) => c.html(homepage(), 200, { 'Cache-Control': 'no-store' }))
app.get('/health', (c) => c.json({ ok: true }))
app.on(['GET', 'HEAD'], ['/demo', '/demo.svg'], (c) =>
  demoImageResponse(c.req.raw, c.env.ENVIRONMENT, c.executionCtx)
)

app.post('/api/users', async (c) => {
  let username = ''
  try {
    const contentType = c.req.header('content-type') ?? ''
    if (contentType.includes('application/json')) {
      username = String((await c.req.json<{ username?: string }>()).username ?? '').trim()
    } else {
      username = String((await c.req.parseBody()).username ?? '').trim()
    }
  } catch {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  if (!isValidUsername(username)) return c.json({ error: 'Invalid GitHub username' }, 400)

  try {
    await fetchContributionCalendar(username, true)
  } catch (error) {
    const status = error instanceof GitHubFetchError ? error.status : 502
    const message = error instanceof Error ? error.message : 'Could not load GitHub profile'
    return c.json({ error: message }, status as 400 | 404 | 502)
  }

  const hash = await hashUsername(username)
  const secret = createSecret()
  const record: UserRecord = { username, createdAt: new Date().toISOString() }
  await c.env.USERS.put(`${hash}:${secret}`, JSON.stringify(record))

  const url = new URL(`/user/${hash}/${secret}`, c.req.url).toString()
  return c.json({ url, hash, username }, 201, { 'Cache-Control': 'no-store' })
})

app.on(['GET', 'HEAD'], '/profile/:handle', (c) =>
  imageResponse(c.req.raw, c.req.param('handle'), c.env.ENVIRONMENT, c.executionCtx)
)
app.on(['GET', 'HEAD'], '/profile/handle/:handle', (c) =>
  imageResponse(c.req.raw, c.req.param('handle'), c.env.ENVIRONMENT, c.executionCtx)
)

app.on(['GET', 'HEAD'], '/user/:hash/:secret', async (c) => {
  const hash = c.req.param('hash')
  const secret = c.req.param('secret').replace(/\.svg$/i, '')
  const development = c.env.ENVIRONMENT !== 'production'
  if (!/^[a-f\d]{64}$/.test(hash) || !/^[A-Za-z\d_-]{20,32}$/.test(secret)) {
    return new Response(renderErrorSvg('Invalid summary URL', 'light'), {
      status: 400,
      headers: imageHeaders(development)
    })
  }

  const record = await c.env.USERS.get<UserRecord>(`${hash}:${secret}`, 'json')
  if (!record) {
    return new Response(renderErrorSvg('Summary URL not found', 'light'), {
      status: 404,
      headers: imageHeaders(development)
    })
  }
  return imageResponse(c.req.raw, record.username, c.env.ENVIRONMENT, c.executionCtx)
})

app.notFound((c) => c.text('Not found', 404))

export default app
