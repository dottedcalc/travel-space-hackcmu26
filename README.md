# TravelSpace

**Shape the space. Guide the flow.**

TravelSpace helps organizers plan club fairs, exhibitions, and large events by exploring how people move through a venue before the doors open. Built for HackCMU 2026.

## What it does

- **Organizers:** Edit floor plans, simulate visitor movement, view crowd heatmaps, and compare layouts.
- **Exhibitors:** Get booth and staffing recommendations, then reserve a location.
- **Visitors:** Choose exhibits and plan a walking route.
- **Workspaces:** Save separate layouts and reservations for multiple events.

## Quick demo

Open **Workspaces**, select a venue, and choose **Organizer**. Run **Simulate flow**, set a baseline, move a booth, and simulate again to compare results. Switch roles to try exhibitor reservations or visitor routes.

## Built with

React, TypeScript, Tailwind CSS, Vinext/Vite, Cloudflare Workers and D1, and Drizzle ORM. Crowd simulation runs in a browser worker.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_amazing_stone_men.sql
npm run dev
```

Apply the database migration once per fresh local database, then open the URL printed by the development server.

## Prototype scope

Simulation results are planning estimates, not validated crowd forecasts. Role pages currently have no per-user authentication.
