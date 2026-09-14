#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { refreshCamoForUsers } from '../src/camo.ts'

const execFileAsync = promisify(execFile)

function printUsage() {
  console.log(`Usage: npm run camo:purge -- [options] [username ...]

Options:
  --user <username>       Add one username (repeatable)
  --users <a,b,...>       Add a comma- or whitespace-separated username list
  --dry-run               Discover Camo URLs without purging them
  --help                  Show this help

If no usernames are supplied, GITHUB_USERS or CAMO_USERS is used.`)
}

function parseArgs(args) {
  const usernames = []
  let dryRun = false

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') {
      printUsage()
      process.exit(0)
    }
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--user' || argument === '--users') {
      const value = args[++index]
      if (!value) throw new Error(`${argument} requires a username`)
      usernames.push(...value.split(/[\s,]+/).filter(Boolean))
      continue
    }
    if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    usernames.push(argument)
  }

  if (usernames.length === 0) {
    usernames.push(...(process.env.GITHUB_USERS ?? process.env.CAMO_USERS ?? '').split(/[\s,]+/).filter(Boolean))
  }
  return { usernames: [...new Set(usernames)], dryRun }
}

async function curlPurge(url) {
  const { stdout } = await execFileAsync(
    'curl',
    ['--silent', '--show-error', '--fail-with-body', '--request', 'PURGE', '--url', url, '--write-out', '\n%{http_code}'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  )
  const match = stdout.match(/\n(\d{3})\s*$/)
  const status = match ? Number.parseInt(match[1], 10) : 200
  return { status, body: match ? stdout.slice(0, match.index).trim() : stdout.trim() }
}

async function main() {
  const { usernames, dryRun } = parseArgs(process.argv.slice(2))
  if (usernames.length === 0) {
    printUsage()
    process.exitCode = 1
    return
  }

  const results = await refreshCamoForUsers(usernames, {
    purger: dryRun
      ? async () => ({ status: 0, body: 'dry run' })
      : curlPurge
  })

  let failed = false
  for (const result of results) {
    if (result.error) {
      failed = true
      console.error(`[${result.username}] ${result.error}`)
      continue
    }

    console.log(`[${result.username}] discovered ${result.camoUrls.length} Camo URL(s)`)
    if (result.camoUrls.length === 0) {
      console.warn(`[${result.username}] no Camo images were found on the profile`)
      continue
    }
    if (dryRun) {
      for (const url of result.camoUrls) console.log(`  ${url}`)
    } else {
      console.log(`[${result.username}] purged ${result.purged.length} Camo URL(s)`)
    }
  }

  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
