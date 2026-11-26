# 00 — Decisions

The **Source** column says where each decision came from:

- **Owner:** the project owner decided it explicitly.
- **Default:** a proposal the owner did not object to.
- **Interpretation:** our reading of a short answer. Please confirm these.

Once the plan is merged, decisions that matter for architecture are recorded as ADRs in `docs/adr/`.

## Product

| # | Topic | Decision | Source |
| --- | --- | --- | --- |
| P1 | Audience | Starts with the owner and friends. Registration is **open to everyone from day one**, so abuse protection and GDPR features are needed early. | Owner |
| P2 | Business model | Free at first. A subscription for premium features comes later, so we model **entitlements** from the start. | Owner |
| P3 | Social | Data is private first. Single activities or workouts can be shared via a public link. A social feed (follow, kudos, comments) comes in a later phase. | Default |
| P4 | Sports | Running, cycling, hiking, swimming, strength training. | Owner |
| P5 | Pillar order | Endurance → Strength → Nutrition → AI coach & plans. | Default |
| P6 | Branding | Name: **Enduva**. Brand concept **B "Daybreak"** (sun rising above an open bowl, in `assets/brand/concept-b/`, PR #2) is chosen. **GPT-6.2 Astra** (design delegate) produces the final icon set and tokens in task 0.6. | Owner |
| P7 | Endurance sources | Apple Health/Workouts plus FIT/GPX/TCX file import. Garmin, Wahoo and similar integrations come later. | Owner |
| P8 | Strava | **No Strava integration.** | Owner |
| P9 | Analysis depth | **No advanced metrics** (CTL/ATL/TSB, VO2max, power zones, gear tracking). Activity analysis covers summary metrics, splits, charts, the map and AI-written analysis. | Interpretation (answer was "Nein"; see open question O5) |
| P10 | Maps | MapKit on iOS. MapLibre GL on the web. The tile source is a configurable style URL, so the provider can change without code changes. The provider is open (O6). | Default |
| P11 | Exercise library | Seeded from an open dataset (licence to verify, e.g. `free-exercise-db`). Users can add custom exercises. No animations in v1. | Default |
| P12 | Strength features | Routines, folders, supersets, RPE/RIR, rest timer, warm-up/drop/failure sets, 1RM estimate, PRs. No plate calculator in v1. | Default |
| P13 | Watch strength logging | **Full logging on the Watch**: check off sets, adjust weight/reps, rest timer, heart rate. | Owner |
| P14 | Food data | Open Food Facts (barcodes, EU products, ODbL, kept as an independent dataset) + **BLS 4.0** (Bundeslebensmittelschlüssel, free since 12/2025, CC BY 4.0, Max Rubner-Institut) + private custom foods. | Default |
| P15 | AI nutrition | Photo recognition and free-text entry. The AI **estimates portion weights** and **asks clarifying questions** when it matters (e.g. "casserole: how much cheese?"). | Owner |
| P16 | Nutrition scope | Macros, water, weight, **dynamic calorie goal** (adjusted by training energy). Micronutrients and fasting come later. | Owner |
| P17 | Community foods | Not for now. Custom foods and recipes stay private. | Owner |
| P18 | AI training | Plan generation, adaptive plans, post-workout analysis, chat coach with access to the user's data. | Default |
| P19 | AI consent | Explicit opt-in before any data is sent to an AI provider. Users can revoke consent. | Default |
| P20 | AI budget | Per-user quotas, configurable. No fixed global budget. | Default |
| P21 | Units | **Always metric.** | Owner |

## Platform & technology

| # | Topic | Decision | Source |
| --- | --- | --- | --- |
| T1 | Language | **TypeScript 7** (native `tsgo` compiler) for every TS package. **No TypeScript 6 fallback.** | Owner |
| T2 | Backend | NestJS (REST + OpenAPI). Because TS 7 ships no JS compiler API and `tsgo` is not used for emit, NestJS is **compiled with SWC** (legacy decorators + decorator metadata) and **type-checked with `tsgo`**. To be validated in spike 0.3. | Owner + Default |
| T3 | Web app | **React 19 with React Router 7 (framework mode, Vite, SSR)** at `app.enduva.soeenplop.dev`. Replaces SvelteKit because `svelte-check` needs TS 6 next to TS 7, and the owner allows **no workarounds** (former O10). `.tsx` and React Router's generated route types are plain TypeScript, so `tsgo` checks everything. To be confirmed in spike 0.3. | Owner |
| T4 | Landing page | **Separate** React Router 7 app, **fully prerendered** (static output), at `enduva.soeenplop.dev`. | Owner |
| T5 | API host | `api.enduva.soeenplop.dev`. | Owner |
| T6 | Native apps | Swift 6 / SwiftUI, iPhone + Apple Watch. Targets **iOS 27 / watchOS 27** (latest; old devices are not supported). | Owner |
| T7 | Watch scope | The Watch app records **strength and similar sessions** on its own. Running, cycling, hiking and swimming are recorded with Apple's **Workout app** and imported via HealthKit. | Owner |
| T8 | Offline | iOS/watchOS are offline-first (local store + sync queue). | Default |
| T9 | Apple Health | Two-way: read workouts, routes, HR and weight; write nutrition, weight and Enduva strength workouts. Dedupe by source + HealthKit UUID. | Default |
| T10 | Apple extras | Live Activities + widgets in v1. Complications, App Intents and Shortcuts later. | Default |
| T11 | Distribution | TestFlight first, App Store later. | Default |
| T12 | Android | Not planned. The API stays client-agnostic. | Default |
| T13 | Database & auth | **Supabase**: local via Supabase CLI for development, **Supabase Cloud** (EU region) for staging and production. NestJS checks Supabase JWTs. Drizzle ORM. RLS as defence in depth. Neon was considered and rejected: it would replace only the database, and Auth (no official Swift SDK for Better Auth) and Storage would have to be rebuilt. | Owner + Default |
| T13a | Supabase plans | **Free** for staging and for production until gate G1 (no real data before G1). Production moves to **Pro** (~$25/month) when G1 passes. PITR only if the data volume justifies it. | Owner (former O4) |
| T14 | Login methods | **Email** (password + magic link), **Google** and **Sign in with Apple** (iOS + web, task 0.14; required by App Review Guideline 4.8 alongside Google). | Owner (incl. former O2) |
| T15 | Monorepo | pnpm workspaces + Turborepo. | Default |
| T16 | Background jobs | pg-boss (Postgres-backed queue, no Redis). | Default |
| T17 | AI provider | **OpenAI by default**, behind a provider-agnostic abstraction (Vercel AI SDK). Model IDs are configured via env. | Owner |
| T18 | i18n | German + English. Paraglide JS (framework-agnostic, compiled message functions) for web + landing, String Catalogs (Swift). Food and exercise names are translatable in the data model. | Owner + Default |
| T19 | Observability | Structured logs (pino) + error tracking with **self-hosted GlitchTip** on Dokploy (`errors.enduva.soeenplop.dev`). GlitchTip speaks the Sentry protocol, so the Sentry SDKs for Node, React and Swift are used. | Owner (former O7) |
| T20 | Secrets | 1Password Environments for local `.env`. GitHub Actions secrets and Dokploy env for deployed environments. | Default |
| T21 | Apple Developer Program | Paid membership is available (Team ID provided during task 0.11a). | Owner (former O3) |
| T22 | Staging domains | `staging.enduva.soeenplop.dev` (landing), `app.staging.enduva.soeenplop.dev` (web), `api.staging.enduva.soeenplop.dev` (API). Verified to resolve via the existing wildcard DNS. | Owner (former O8) |
| T23 | Licence | **Elastic License 2.0 (ELv2)**, source-available: everyone may use, modify and self-host the code, but **may not offer it as a hosted/managed service** to third parties or circumvent licence-key functionality. This keeps the subscription business open. ELv2 is not an OSI open-source licence. Added as `LICENSE` in PR #1. | Owner (former O1) |
| T24 | Contributions | External contributions require a **CLA** (e.g. via CLA Assistant), because under ELv2 alone the owner couldn't run contributed code as the hosted Enduva service or relicense it. Set up in task 0.2. | Default |

## Process

| # | Topic | Decision | Source |
| --- | --- | --- | --- |
| W1 | Repository | Public GitHub repo `soeenplop/enduva`. | Owner |
| W2 | Implementation | Done by subagents that the lead agent (Claude) starts, each in its own branch + worktree. Tasks run in parallel only where they are independent. | Owner |
| W3 | Review | Every PR is reviewed by a **GPT-6.2 Sol** Codex delegate, which comments on the PR. The implementer replies in the PR. The **owner arbitrates** disagreements. | Owner |
| W4 | Commits | Conventional Commits, enforced by commitlint. | Owner |
| W5 | Merging | **No squash merges.** Merge commits (`--no-ff`) only. | Owner + Default |
| W6 | Deploy | Docker Compose, deployed with the **Dokploy CLI**. | Owner |
| W7 | Releases | release-please (SemVer + changelog from Conventional Commits). | Default |
| W8 | Plan location | This directory (`docs/plan/`). Changes go through PRs. | Default |
| W9 | Commit signing | A dedicated **SSH signing key without 1Password** (`~/.ssh/enduva_signing_ed25519`, ed25519, signing only, no passphrase so unattended agents can sign), configured repo-locally (`gpg.format=ssh`, `gpg.ssh.program=ssh-keygen`) and registered on GitHub as a signing key. Never used for authentication. | Owner (former O9) |
| W10 | Review rounds | **No fixed limit** on review rounds. Disagreements still go to the owner per the arbiter rule. | Owner |
| W11 | Release automation | A GitHub App **"Enduva Release"** (contents + pull-requests write, this repo only) authenticates release-please. The owner creates and installs it during task 0.12d. | Owner (former O11) |

## Open questions

| # | Question | Why it matters | Proposal |
| --- | --- | --- | --- |
| O5 | Confirm P9: is the answer "Nein" to advanced metrics right? What about **HR zone distribution** and simple **personal records** (fastest 5 km, …)? | Changes the analysis scope in Phase 1 | Include HR zones + simple PRs, skip CTL/ATL/TSB/VO2max |
| O6 | **Map tile provider** for the web | Free tiers of MapTiler and Stadia are **non-commercial only**, which conflicts with the later subscription. Options: MapTiler (outdoor/topo styles with contours and hillshading, satellite; commercial from ~$25/month), Stadia (Alidade/Stamen styles, commercial from $20/month), OpenFreeMap (free public OSM vector tiles, no key, no SLA), self-hosted Protomaps PMTiles (one file on our own storage, no third-party requests, we pay the bandwidth, no terrain out of the box) | Start with **OpenFreeMap** (free, no key, no third-party account). Because the style URL is configurable, we can move to self-hosted PMTiles (privacy) or MapTiler (outdoor styles) later without code changes |

Resolved questions (former O1–O4 and O7–O11) are recorded in the tables above with their former number in the Source column.
