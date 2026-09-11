import type { ContributionCalendar, ContributionDay } from './github'

type Theme = 'light' | 'dark'

const WIDTH = 1200
const HEIGHT = 720
const HALF_WIDTH = 20
const HALF_DEPTH = 8.5
const MAX_HEIGHT = 110
const ORIGIN_X = 150
const ORIGIN_Y = 150

export interface ContributionStatistics {
  activeDays: number
  activePercentage: number
  medianPerDay: number
  medianPerActiveDay: number
  averagePerActiveDay: number
  averageActiveDaysPerWeek: number
  weekTotal: number
  weekStart: string
  weekEnd: string
  bestDay: string
  longestStreak: number
  longestStreakStart: string | null
  longestStreakEnd: string | null
  currentStreak: number
  currentStreakStart: string | null
  currentStreakEnd: string | null
}

const PALETTES: Record<Theme, { background: string; text: string; muted: string; border: string; accent: string; levels: string[] }> = {
  light: {
    background: '#ffffff',
    text: '#1f2328',
    muted: '#59636e',
    border: '#d0d7de',
    accent: '#1a7f37',
    levels: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
  },
  dark: {
    background: '#0d1117',
    text: '#f0f6fc',
    muted: '#9198a1',
    border: '#30363d',
    accent: '#39d353',
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

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
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
  const latestWeek = Math.max(...calendar.days.map((day) => day.week))
  const weekDays = calendar.days.filter((day) => day.week === latestWeek)
  const bestDay = calendar.days.reduce(
    (best, day) => (day.count > best.count ? day : best),
    calendar.days[0]
  )
  let longestStreak = 0
  let runningStreak = 0
  let runningStreakStart: string | null = null
  let longestStreakStart: string | null = null
  let longestStreakEnd: string | null = null

  for (const day of calendar.days) {
    if (day.count > 0) {
      if (runningStreak === 0) runningStreakStart = day.date
      runningStreak++
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak
        longestStreakStart = runningStreakStart
        longestStreakEnd = day.date
      }
    } else {
      runningStreak = 0
      runningStreakStart = null
    }
  }

  let currentStreak = 0
  let currentStreakStart: string | null = null
  let currentStreakEnd: string | null = null
  const reversed = [...calendar.days].reverse()
  for (let index = 0; index < reversed.length; index++) {
    if (index === 0 && reversed[index].count === 0) {
      currentStreakEnd = reversed[1]?.date ?? null
      continue
    }
    if (reversed[index].count === 0) break
    currentStreakEnd ??= reversed[index].date
    currentStreakStart = reversed[index].date
    currentStreak++
  }

  return {
    activeDays: active.length,
    activePercentage: calendar.days.length === 0 ? 0 : (active.length / calendar.days.length) * 100,
    medianPerDay: median(calendar.days.map((day) => day.count)),
    medianPerActiveDay: median(active.map((day) => day.count)),
    averagePerActiveDay: active.length === 0 ? 0 : calendar.total / active.length,
    averageActiveDaysPerWeek: weekCount === 0 ? 0 : active.length / weekCount,
    weekTotal: weekDays.reduce((sum, day) => sum + day.count, 0),
    weekStart: weekDays[0]?.date ?? calendar.to,
    weekEnd: weekDays.at(-1)?.date ?? calendar.to,
    bestDay: bestDay.date,
    longestStreak,
    longestStreakStart,
    longestStreakEnd,
    currentStreak,
    currentStreakStart,
    currentStreakEnd
  }
}

function formatStatistic(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value)
}

function summaryMetric(
  x: number,
  value: string,
  label: string,
  detail: string,
  palette: (typeof PALETTES)[Theme]
): string {
  return `<text x="${x}" y="112" fill="${palette.accent}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="31" font-weight="600">${escapeXml(value)}</text><text x="${x}" y="139" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="600">${escapeXml(label)}</text><text x="${x}" y="164" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${escapeXml(detail)}</text>`
}

function dateRange(start: string | null, end: string | null): string {
  if (!start || !end) return 'No active streak'
  return `${formatShortDate(start)} → ${formatShortDate(end)}`
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

  const summaryMarkup = [
    summaryMetric(690, formatStatistic(calendar.total, 0), 'Total', `${formatShortDate(calendar.from)} → ${formatShortDate(calendar.to)}`, palette),
    summaryMetric(858, formatStatistic(stats.weekTotal, 0), 'This week', `${formatShortDate(stats.weekStart)} → ${formatShortDate(stats.weekEnd)}`, palette),
    summaryMetric(1030, formatStatistic(calendar.max, 0), 'Best day', formatShortDate(stats.bestDay), palette)
  ].join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">Isometric GitHub contribution chart from ${calendar.from} through ${calendar.to}</desc>
  <rect width="100%" height="100%" rx="12" fill="${palette.background}"/>
  <g shape-rendering="geometricPrecision">${orderedDays.map((day) => cube(day, calendar.max, palette.levels)).join('')}</g>
  <text x="660" y="52" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="25" font-weight="600">Contributions this year</text>
  <rect x="660" y="70" width="510" height="116" rx="10" fill="${palette.background}" stroke="${palette.border}"/>
  ${summaryMarkup}
  <text x="660" y="218" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14">Median contributions: <tspan fill="${palette.accent}" font-weight="600">${formatStatistic(stats.medianPerDay)} / day</tspan></text>
  <text x="930" y="218" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14">Active-day average: <tspan fill="${palette.accent}" font-weight="600">${formatStatistic(stats.averagePerActiveDay)}</tspan></text>
  <text x="660" y="244" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14">Weekly activity: <tspan fill="${palette.accent}" font-weight="600">${formatStatistic(stats.averageActiveDaysPerWeek)} active days / week</tspan></text>
  <text x="930" y="244" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="14">${formatStatistic(stats.activeDays, 0)} active days · ${formatStatistic(stats.activePercentage, 0)}%</text>
  <text x="40" y="552" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="25" font-weight="600">Streaks</text>
  <rect x="40" y="570" width="430" height="120" rx="10" fill="${palette.background}" stroke="${palette.border}"/>
  <text x="70" y="615" fill="${palette.accent}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="29" font-weight="600">${formatStatistic(stats.longestStreak, 0)} days</text>
  <text x="70" y="642" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="600">Longest</text>
  <text x="70" y="668" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${escapeXml(dateRange(stats.longestStreakStart, stats.longestStreakEnd))}</text>
  <text x="260" y="615" fill="${palette.accent}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="29" font-weight="600">${formatStatistic(stats.currentStreak, 0)} days</text>
  <text x="260" y="642" fill="${palette.text}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="15" font-weight="600">Current</text>
  <text x="260" y="668" fill="${palette.muted}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="13">${escapeXml(dateRange(stats.currentStreakStart, stats.currentStreakEnd))}</text>
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
