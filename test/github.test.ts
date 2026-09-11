import { describe, expect, it } from 'vitest'
import { findContributionFragment, isValidUsername, parseContributionHtml } from '../src/github'
import { calculateStatistics, renderContributionSvg } from '../src/render'
import contributionFixture from './fixtures/iplanwebsites-contributions.html?raw'
import profileFixture from './fixtures/iplanwebsites-profile.html?raw'

function calendarHtml(days = 301): string {
  const start = Date.UTC(2025, 0, 1)
  const cells: string[] = []
  const tooltips: string[] = []

  for (let index = 0; index < days; index++) {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10)
    const count = index % 6
    const id = `day-${index}`
    cells.push(`<td class="ContributionCalendar-day" data-date="${date}" data-ix="${Math.floor(index / 7)}" data-level="${Math.min(count, 4)}" id="${id}">`)
    tooltips.push(`<tool-tip for="${id}">${count === 0 ? 'No' : count} contribution${count === 1 ? '' : 's'} on January 1st.</tool-tip>`)
  }
  return `${cells.join('')} ${tooltips.join('')}`
}

describe('GitHub profile parsing', () => {
  it('finds and decodes the contribution fragment', () => {
    const html = '<include-fragment src="/octocat?action=show&amp;controller=profiles&amp;tab=contributions&amp;user_id=octocat">'
    expect(findContributionFragment(html)).toContain('tab=contributions&user_id=octocat')
  })

  it('validates GitHub usernames', () => {
    expect(isValidUsername('octo-cat')).toBe(true)
    expect(isValidUsername('-octocat')).toBe(false)
    expect(isValidUsername('not/a/user')).toBe(false)
  })

  it('extracts counts, levels, weeks, and dates', () => {
    const calendar = parseContributionHtml(calendarHtml())
    expect(calendar.days).toHaveLength(301)
    expect(calendar.days[1]).toMatchObject({ count: 1, level: 1, week: 0 })
    expect(calendar.total).toBeGreaterThan(0)
    expect(calendar.max).toBe(5)
  })

  it('rejects an incomplete GitHub response', () => {
    expect(() => parseContributionHtml(calendarHtml(10))).toThrow('incomplete')
  })

  it('parses the frozen iplanwebsites GitHub response', () => {
    expect(findContributionFragment(profileFixture)).toContain('user_id=iplanwebsites')

    const calendar = parseContributionHtml(contributionFixture)
    expect(calendar.days).toHaveLength(370)
    expect(calendar.total).toBe(12_726)
    expect(calendar.max).toBe(292)
    expect(calendar.from).toBe('2025-09-07')
    expect(calendar.to).toBe('2026-09-11')
  })
})

describe('SVG rendering', () => {
  it('renders one cube per contribution day', () => {
    const calendar = parseContributionHtml(calendarHtml())
    const svg = renderContributionSvg('octocat', calendar, 'dark')
    expect(svg).toContain('<svg')
    expect(svg).toContain('contributions this year')
    expect(svg).not.toContain('by @octocat')
    expect(svg).toContain('Median contributions')
    expect(svg).toContain('per active day')
    expect(svg).not.toContain('>2.0</text>')
    expect(svg.match(/<polygon/g)).toHaveLength(301 * 3)
  })

  it('calculates contribution cadence statistics', () => {
    const calendar = parseContributionHtml(calendarHtml())
    const stats = calculateStatistics(calendar)
    expect(stats.activeDays).toBe(250)
    expect(stats.medianPerDay).toBe(2)
    expect(stats.medianPerActiveDay).toBe(3)
    expect(stats.averageActiveDaysPerWeek).toBeCloseTo(250 / 43)
    expect(stats.longestStreak).toBe(5)
  })
})
