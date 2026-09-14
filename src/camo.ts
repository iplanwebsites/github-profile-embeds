const CAMO_HOST = 'camo.githubusercontent.com'
const USER_AGENT = 'github-iso-camo-purger/0.1'
const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i

function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

export interface CamoDiscovery {
  username: string
  profileUrl: string
  camoUrls: string[]
}

export interface CamoPurgeResponse {
  status: number
  body: string
}

export interface CamoRefreshResult extends CamoDiscovery {
  purged: Array<{ url: string; status: number; body: string }>
  refetched: Array<{ url: string; status: number }>
  error?: string
}

export interface CamoRefreshOptions {
  fetcher?: typeof fetch
  purger?: (url: string) => Promise<CamoPurgeResponse>
  beforePurge?: (discovery: CamoDiscovery) => Promise<void>
  refetchAfterPurge?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&#38;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function normalizeCamoUrl(value: string): string | undefined {
  const candidate = decodeHtml(value)
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),.;]+$/, '')
    .replace(/^\\\//, 'https://')

  let url: URL
  try {
    url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate)
  } catch {
    return undefined
  }

  if (url.protocol !== 'https:' || url.hostname !== CAMO_HOST) return undefined
  if (url.pathname.split('/').filter(Boolean).length < 2) return undefined
  return url.toString()
}

/** Extracts exact Camo proxy URLs from a GitHub profile HTML response. */
export function extractCamoUrls(html: string): string[] {
  const candidates = decodeHtml(html).match(
    /(?:https?:)?\/\/camo\.githubusercontent\.com\/[^"'\s<>\\]+/gi
  ) ?? []
  const urls = new Set<string>()

  for (const candidate of candidates) {
    const url = normalizeCamoUrl(candidate)
    if (url) urls.add(url)
  }

  return [...urls]
}

export function configuredUsernames(value: string | undefined): string[] {
  if (!value) return []
  const usernames = value
    .split(/[\s,]+/)
    .map((username) => username.trim())
    .filter(Boolean)
    .filter(isValidUsername)

  return [...new Set(usernames)]
}

export async function discoverCamoUrls(
  username: string,
  fetcher: typeof fetch = fetch
): Promise<CamoDiscovery> {
  if (!isValidUsername(username)) throw new Error(`Invalid GitHub username: ${username}`)

  const profileUrl = new URL(`https://github.com/${encodeURIComponent(username)}`)
  const response = await fetcher(profileUrl, {
    headers: {
      Accept: 'text/html',
      'User-Agent': USER_AGENT
    },
    redirect: 'follow',
    cache: 'no-store'
  })

  if (response.status === 404) throw new Error(`GitHub user not found: ${username}`)
  if (!response.ok) throw new Error(`GitHub profile request failed (${response.status})`)

  return {
    username,
    profileUrl: profileUrl.toString(),
    camoUrls: extractCamoUrls(await response.text())
  }
}

export async function purgeCamoUrl(
  url: string,
  fetcher: typeof fetch = fetch
): Promise<CamoPurgeResponse> {
  const normalized = normalizeCamoUrl(url)
  if (!normalized) throw new Error(`Refusing to purge a non-Camo URL: ${url}`)

  const response = await fetcher(normalized, {
    method: 'PURGE',
    headers: { 'User-Agent': USER_AGENT }
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Camo purge failed (${response.status}): ${body || 'empty response'}`)

  return { status: response.status, body }
}

async function refetchCamoUrl(url: string, fetcher: typeof fetch): Promise<number> {
  const normalized = normalizeCamoUrl(url)
  if (!normalized) throw new Error(`Refusing to fetch a non-Camo URL: ${url}`)

  const response = await fetcher(normalized, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT },
    cache: 'no-store'
  })
  if (!response.ok) throw new Error(`Camo refresh failed (${response.status})`)

  // Consume the complete response so the proxy can finish repopulating its cache.
  await response.arrayBuffer()
  return response.status
}

/**
 * Discovers and purges every Camo image URL visible on each requested profile.
 * A failed user is returned as a result so a scheduled run can continue with
 * the remaining users.
 */
export async function refreshCamoForUsers(
  usernames: string[],
  options: CamoRefreshOptions = {}
): Promise<CamoRefreshResult[]> {
  const fetcher = options.fetcher ?? fetch
  const purger = options.purger ?? ((url: string) => purgeCamoUrl(url, fetcher))
  const results: CamoRefreshResult[] = []
  const seenCamoUrls = new Set<string>()

  for (const username of [...new Set(usernames.map((value) => value.trim()).filter(Boolean))]) {
    try {
      const discovery = await discoverCamoUrls(username, fetcher)
      await options.beforePurge?.(discovery)
      const purged: CamoRefreshResult['purged'] = []
      const refetched: CamoRefreshResult['refetched'] = []

      for (const url of discovery.camoUrls) {
        if (seenCamoUrls.has(url)) continue
        seenCamoUrls.add(url)
        const response = await purger(url)
        purged.push({ url, ...response })
        if (options.refetchAfterPurge !== false) {
          refetched.push({ url, status: await refetchCamoUrl(url, fetcher) })
        }
      }

      results.push({ ...discovery, purged, refetched })
    } catch (error) {
      results.push({
        username,
        profileUrl: `https://github.com/${encodeURIComponent(username)}`,
        camoUrls: [],
        purged: [],
        refetched: [],
        error: errorMessage(error)
      })
    }
  }

  return results
}

/** Decode Camo's hex-encoded origin URL when it is present in the proxy path. */
export function decodeCamoSourceUrl(camoUrl: string): URL | undefined {
  const normalized = normalizeCamoUrl(camoUrl)
  if (!normalized) return undefined

  const pathParts = new URL(normalized).pathname.split('/').filter(Boolean)
  const encoded = pathParts[1]
  if (!encoded || !/^(?:[a-f\d]{2})+$/i.test(encoded)) return undefined

  const bytes = new Uint8Array(encoded.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16)
  }

  try {
    return new URL(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}
