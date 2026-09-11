# github-iso

A Hono-powered Cloudflare Worker that loads a public GitHub profile, follows GitHub's contribution-calendar fragment, and renders the last year of contributions as an isometric SVG. The SVG can be embedded directly in a GitHub README.

The original browser extension is preserved under [`reference/isometric-contributions`](reference/isometric-contributions). It renders into a browser canvas with Obelisk.js. This worker uses the same core idea—one cube per day, with height proportional to the exact contribution count—but emits SVG so it can run at the edge without a browser or native graphics dependency.

## Develop

```sh
npm install
npm run dev
```

Open `http://localhost:8787/profile/octocat` or use dark mode with `http://localhost:8787/profile/octocat?theme=dark`.

Development defaults to `ENVIRONMENT=development`. Every image request refetches the profile and contribution fragment from GitHub, and responses use `Cache-Control: no-store`.

## Deploy

```sh
npm run deploy
```

Production images carry `Cache-Control: public, max-age=86400, s-maxage=86400` and are stored in Cloudflare's Cache API for 24 hours. Any query string creates a separate cache key and bypasses the upstream GitHub HTML cache, so `?v=TIMESTAMP` forces a fresh render.

Embed a deployed image in a GitHub README:

```md
![GitHub contribution summary](https://github-summary.cookskill.dev/profile/octocat)
```

## Create a shareable URL

The homepage at `https://github-summary.cookskill.dev` accepts a GitHub username and returns a capability URL shaped like:

```text
/user/:sha256-username-hash/:random-secret
```

The one-way hash cannot recover the username, so Workers KV stores the mapping. Anyone with the generated URL can view and embed the public contribution summary; the random secret is part of that shareable URL and is not a GitHub credential.

## Routes

- `GET /demo` and `GET /demo.svg` render the frozen `iplanwebsites` fixture without contacting GitHub.
- `GET /profile/:handle` renders a profile directly without creating a URL.
- `GET /profile/handle/:handle` is an equivalent explicit alias.
- `GET /user/:hash/:secret` renders a created summary URL.
- Add `?theme=dark` for dark mode or `?v=anything` to bust the current cache.
- `POST /api/users` with `{"username":"octocat"}` creates a summary URL.
- `GET /health` returns a health response.

Only public contribution data visible on the GitHub profile is available; private contributions are not exposed to this unauthenticated worker.

Each chart includes total contributions, active days, activity percentage, median contributions per calendar and active day, average contributions per active day, average active days per week, longest streak, current streak, and the highest daily count. These are GitHub contributions, not necessarily Git commits; GitHub's graph can also include issues, pull requests, and reviews.

The current static example for `iplanwebsites` is [`iplanwebsites.svg`](iplanwebsites.svg).

## Test fixture

The exact public GitHub responses used for the `iplanwebsites` example are frozen in [`test/fixtures/iplanwebsites-profile.html`](test/fixtures/iplanwebsites-profile.html) and [`test/fixtures/iplanwebsites-contributions.html`](test/fixtures/iplanwebsites-contributions.html). Parser and statistic regression tests use these files locally and never need the network.

## Upstream survey

GitHub's profile HTML currently contains an `include-fragment` whose `src` points back to the contributions tab. The worker deliberately loads the profile first, discovers that URL, then requests it with `X-Requested-With: XMLHttpRequest`. The returned table supplies `data-date`, week index, intensity level, and accessible tooltips containing exact contribution counts.

The reference extension is MIT licensed; see its bundled [`LICENSE`](reference/isometric-contributions/LICENSE).
