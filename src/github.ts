export interface ContributionDay {
  date: string
  week: number
  weekday: number
  count: number
  level: number
}

export interface ContributionCalendar {
  days: ContributionDay[]
  total: number
  max: number
  from: string
  to: string
}

export class GitHubFetchError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

const USERNAME_PATTERN = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username)
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match ? decodeHtml(match[1] ?? match[2]) : undefined
}

export function findContributionFragment(profileHtml: string): string | undefined {
  const fragments = profileHtml.match(/<include-fragment\b[^>]*>/gi) ?? []
  for (const fragment of fragments) {
    const src = attribute(fragment, 'src')
    if (src && src.includes('tab=contributions')) return src
  }
  return undefined
}

function tooltipCounts(html: string): Map<string, number> {
  const counts = new Map<string, number>()
  const tooltips = html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/gi)

  for (const match of tooltips) {
    const target = attribute(match[1], 'for')
    if (!target) continue

    const text = decodeHtml(match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    const countMatch = text.match(/([\d,]+|No) contributions?\s+on/i)
    if (!countMatch) continue
    counts.set(
      target,
      countMatch[1].toLowerCase() === 'no'
        ? 0
        : Number.parseInt(countMatch[1].replaceAll(',', ''), 10)
    )
  }

  return counts
}

export function parseContributionHtml(html: string): ContributionCalendar {
  const counts = tooltipCounts(html)
  const cells = html.match(/<td\b[^>]*>/gi) ?? []
  const days: ContributionDay[] = []

  for (const cell of cells) {
    const className = attribute(cell, 'class') ?? ''
    if (!className.split(/\s+/).includes('ContributionCalendar-day')) continue

    const date = attribute(cell, 'data-date')
    const week = Number.parseInt(attribute(cell, 'data-ix') ?? '', 10)
    const level = Number.parseInt(attribute(cell, 'data-level') ?? '0', 10)
    const id = attribute(cell, 'id')
    if (!date || !Number.isFinite(week)) continue

    const timestamp = Date.parse(`${date}T00:00:00Z`)
    if (!Number.isFinite(timestamp)) continue

    days.push({
      date,
      week,
      weekday: new Date(timestamp).getUTCDay(),
      count: id ? (counts.get(id) ?? 0) : 0,
      level: Number.isFinite(level) ? Math.max(0, Math.min(4, level)) : 0
    })
  }

  days.sort((a, b) => a.date.localeCompare(b.date))
  if (days.length < 300) {
    throw new GitHubFetchError(
      `GitHub returned an incomplete contribution calendar (${days.length} days)`,
      502
    )
  }

  return {
    days,
    total: days.reduce((sum, day) => sum + day.count, 0),
    max: days.reduce((max, day) => Math.max(max, day.count), 0),
    from: days[0].date,
    to: days.at(-1)!.date
  }
}

interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheEverything?: boolean
    cacheTtl?: number
  }
}

async function getGitHub(url: URL, development: boolean, fragment = false): Promise<Response> {
  const headers = new Headers({
    Accept: 'text/html',
    'User-Agent': 'github-iso-worker/0.1'
  })
  if (fragment) headers.set('X-Requested-With', 'XMLHttpRequest')

  const init: CloudflareRequestInit = {
    headers,
    redirect: 'follow',
    cf: development
      ? { cacheEverything: false, cacheTtl: 0 }
      : { cacheEverything: true, cacheTtl: 86400 }
  }
  return fetch(url, init)
}

export async function fetchContributionCalendar(
  username: string,
  development: boolean
): Promise<ContributionCalendar> {
  if (!isValidUsername(username)) {
    throw new GitHubFetchError('Invalid GitHub username', 400)
  }

  const profileUrl = new URL(`https://github.com/${username}`)
  const profile = await getGitHub(profileUrl, development)
  if (profile.status === 404) throw new GitHubFetchError('GitHub user not found', 404)
  if (!profile.ok) {
    throw new GitHubFetchError(`GitHub profile request failed (${profile.status})`, 502)
  }

  const profileHtml = await profile.text()
  const fragmentPath = findContributionFragment(profileHtml)
  if (!fragmentPath) {
    throw new GitHubFetchError('GitHub profile did not expose a contribution calendar', 502)
  }

  const fragmentUrl = new URL(fragmentPath, profileUrl)
  const fragment = await getGitHub(fragmentUrl, development, true)
  if (!fragment.ok) {
    throw new GitHubFetchError(`GitHub contribution request failed (${fragment.status})`, 502)
  }

  return parseContributionHtml(await fragment.text())
}

