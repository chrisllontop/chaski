<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-white.svg">
    <img alt="chaski" src="brand/logo-black.svg" height="40">
  </picture>
</h1>

Embeddable notification infrastructure for Cloudflare Workers, dashboard included.

[![License: MIT](https://img.shields.io/badge/license-MIT-404040?style=flat-square)](LICENSE)
![Runs on Cloudflare Workers](https://img.shields.io/badge/runs_on-Cloudflare_Workers-404040?style=flat-square)
![Status: pre-release](https://img.shields.io/badge/status-pre--release-404040?style=flat-square)

**Status: pre-release.** The engine and the browser clients are in place. The dashboard screens and
a setup guide come next, so chaski isn’t ready to install yet.

## What it will be

chaski lives inside your Worker. You mount it on a route, the way you’d mount Swagger UI or Bull
Board, and it runs on your own Cloudflare resources. It deploys with your Worker, and your data stays
in your account.

- **Email, push, and in-app.** Send email, web push, and notifications to an in-app feed.
- **Templates** for the content of every notification.
- **Scheduling** for notifications that go out later.
- **Retries** for deliveries that fail along the way.
- **A dashboard**, served from the same route.

## The name

The chaskis were the relay messengers of the Inca Empire. They ran the Qhapaq Ñan, the Inca road
network, each one covering a short stretch before handing the message to the next runner. That’s how
news crossed the Andes in days.

The logo is that handoff: a single stroke runs along one lane, steps across and carries on in the
next. [`brand/`](brand) holds the mark and the full logo, in black and in white.

## License

[MIT](LICENSE)
