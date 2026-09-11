import type { ContributionCalendar, ContributionDay } from './github'

type Theme = 'light' | 'dark'

const WIDTH = 1200
const HEIGHT = 600
const HALF_WIDTH = 14
const HALF_DEPTH = 7
const MAX_HEIGHT = 112
const ORIGIN_X = 104
const ORIGIN_Y = 124

export interface ContributionStatistics {
  activeDays: number
  activePercentage: number
  medianPerDay: number
  medianPerActiveDay: number
  averagePerActiveDay: number
  averageActiveDaysPerWeek: number
  longestStreak: number
  currentStreak: number
}

const PALETTES: Record<Theme, { background: string; text: string; muted: string; levels: string[] }> = {
  light: {
    background: '#ffffff',
    text: '#1f2328',
    muted: '#59636e',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
  },
  dark: {
    background: '#0d1117',
    text: '#f0f6fc',
    muted: '#9198a1',
    levels: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const channels = [value >> 16, (value >> 8) & 255, value & 255]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
  return `#${channels.join('')}`
}

function points(values: Array<[number, number]>): string {
  return values.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

function cube(day: ContributionDay, max: number, levels: string[]): string {
  const centerX = ORIGIN_X + (day.week - day.weekday) * HALF_WIDTH
  const baseY = ORIGIN_Y + (day.week + day.weekday) * HALF_DEPTH
  const height = day.count === 0 ? 3 : 5 + (day.count / Math.max(1, max)) * MAX_HEIGHT
  const topY = baseY - height
  const top = levels[day.level]

  const north: [number, number] = [centerX, topY - HALF_DEPTH]
  const east: [number, number] = [centerX + HALF_WIDTH, topY]
  const south: [number, number] = [centerX, topY + HALF_DEPTH]
  const west: [number, number] = [centerX - HALF_WIDTH, topY]
  const eastBottom: [number, number] = [east[0], east[1] + height]
  const southBottom: [number, number] = [south[0], south[1] + height]
  const westBottom: [number, number] = [west[0], west[1] + height]

  return [
    `<polygon points="${points([west, south, southBottom, westBottom])}" fill="${shade(top, 0.78)}"/>`,
    `<polygon points="${points([east, south, southBottom, eastBottom])}" fill="${shade(top, 0.58)}"/>`,
    `<polygon points="${points([north, east, south, west])}" fill="${top}"/>`
  ].join('')
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T00:00:00Z`))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export function calculateStatistics(calendar: ContributionCalendar): ContributionStatistics {
  const active = calendar.days.filter((day) => day.count > 0)
  const weekCount = new Set(calendar.days.map((day) => day.week)).size
  let longestStreak = 0
  let runningStreak = 0

  for (const day of calendar.days) {
    runningStreak = day.count > 0 ? runningStreak + 1 : 0
    longestStreak = Math.max(longestStreak, runningStreak)
  }

  let currentStreak = 0
  const reversed = [...calendar.days].reverse()
  for (let index = 0; index < reversed.length; index++) {
    if (index === 0 && reversed[index].count === 0) continue
    if (reversed[index].count === 0) break
    currentStreak++
  }

  return {
    activeDays: active.length,
    activePercentage: calendar.days.length === 0 ? 0 : (active.length / calendar.days.length) * 100,
    medianPerDay: median(calendar.days.map((day) => day.count)),
    medianPerActiveDay: median(active.map((day) => day.count)),
    averagePerActiveDay: active.length === 0 ? 0 : calendar.total / active.length,
    averageActiveDaysPerWeek: weekCount === 0 ? 0 : active.length / weekCount,
    longestStreak,
    currentStreak
  }
}

function formatStatistic(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function metric(
  x: number,
  y: number,
  value: string,
  labels: string[],
  palette: (typeof PALETTES)[Theme]
): string {
  const labelMarkup = labels
    .map((label, index) => `<tspan x="${x}" y="${y + 20 + index * 15}">${escapeXml(label)}</tspan>`)
    .join('')
  return `<text x="${x}" y="${y}" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" font-weight="600">${escapeXml(value)}</text><text fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="12">${labelMarkup}</text>`
}

export function renderContributionSvg(
  username: string,
  calendar: ContributionCalendar,
  theme: Theme
): string {
  const palette = PALETTES[theme]
  const stats = calculateStatistics(calendar)
  const orderedDays = [...calendar.days].sort(
    (a, b) => a.week + a.weekday - (b.week + b.weekday) || a.week - b.week
  )
  const title = `${calendar.total.toLocaleString('en-US')} contributions this year`

  const statsMarkup = [
    metric(882, 100, formatStatistic(calendar.total, 0), ['Contributions'], palette),
    metric(1050, 100, formatStatistic(stats.activeDays, 0), ['Active days', `${formatStatistic(stats.activePercentage, 0)}% of days`], palette),
    metric(882, 174, formatStatistic(stats.medianPerDay), ['Median contributions', 'per day'], palette),
    metric(1050, 174, formatStatistic(stats.medianPerActiveDay), ['Median contributions', 'per active day'], palette),
    metric(882, 248, formatStatistic(stats.averagePerActiveDay), ['Average contributions', 'per active day'], palette),
    metric(1050, 248, formatStatistic(stats.averageActiveDaysPerWeek), ['Average active days', 'per week'], palette),
    metric(882, 322, `${formatStatistic(stats.longestStreak, 0)} days`, ['Longest streak'], palette),
    metric(1050, 322, `${formatStatistic(stats.currentStreak, 0)} days`, ['Current streak'], palette)
  ].join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">Isometric GitHub contribution chart from ${calendar.from} through ${calendar.to}</desc>
  <rect width="100%" height="100%" rx="12" fill="${palette.background}"/>
  <text x="28" y="42" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="22" font-weight="600">${escapeXml(title)}</text>
  <g shape-rendering="geometricPrecision">${orderedDays.map((day) => cube(day, calendar.max, palette.levels)).join('')}</g>
  <rect x="858" y="68" width="314" height="310" rx="10" fill="none" stroke="${shade(palette.muted, theme === 'dark' ? 0.55 : 1.65)}"/>
  ${statsMarkup}
  <text x="28" y="574" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${escapeXml(formatDate(calendar.from))} – ${escapeXml(formatDate(calendar.to))}</text>
  <text x="1172" y="574" text-anchor="end" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">Highest day: ${formatStatistic(calendar.max, 0)} contributions</text>
</svg>`
}

export function renderErrorSvg(message: string, theme: Theme): string {
  const palette = PALETTES[theme]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="120" viewBox="0 0 ${WIDTH} 120" role="img" aria-labelledby="title">
  <title id="title">${escapeXml(message)}</title>
  <rect width="100%" height="100%" rx="12" fill="${palette.background}"/>
  <text x="28" y="68" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="20">${escapeXml(message)}</text>
</svg>`
}
