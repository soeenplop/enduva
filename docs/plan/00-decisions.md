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
| P6 | Branding | Name: **Enduva**. The old icon was removed. A new icon and brand identity are created by **GPT-6.2 Astra** (design delegate). | Owner |
| P7 | Endurance sources | Apple Health/Workouts plus FIT/GPX/TCX file import. Garmin, Wahoo and similar integrations come later. | Owner |
| P8 | Strava | **No Strava integration.** | Owner |
| P9 | Analysis depth | **No advanced metrics** (CTL/ATL/TSB, VO2max, power zones, gear tracking). Activity analysis covers summary metrics, splits, charts, the map and AI-written analysis. | Interpretation (answer was "Nein"; see open question O5) |
| P10 | Maps | MapKit on iOS. MapLibre GL on the web with a hosted vector-tile provider on a free tier (MapTiler or Stadia). | Default |
| P11 | Exercise library | Seeded from an open dataset (licence to verify, e.g. `free-exercise-db`). Users can add custom exercises. No animations in v1. | Default |
| P12 | Strength features | Routines, folders, supersets, RPE/RIR, rest timer, warm-up/drop/failure sets, 1RM estimate, PRs. No plate calculator in v1. | Default |
| P13 | Watch strength logging | **Full logging on the Watch**: check off sets, adjust weight/reps, rest timer, heart rate. | Owner |
| P14 | Food data | Open Food Facts (barcodes, EU products, ODbL) + **BLS 4.0** (Bundeslebensmittelschlüssel, free since 12/2025; exact terms to verify) + private custom foods. | Default (BLS licence verified as free of charge) |
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
| T3 | Web app | SvelteKit (Svelte 5) at `app.enduva.soeenplop.dev`. | Owner |
| T4 | Landing page | **Separate** SvelteKit app (prerendered/static) at `enduva.soeenplop.dev`. | Owner |
| T5 | API host | `api.enduva.soeenplop.dev`. | Owner |
| T6 | Native apps | Swift 6 / SwiftUI, iPhone + Apple Watch. Targets **iOS 27 / watchOS 27** (latest; old devices are not supported). | Owner |
| T7 | Watch scope | The Watch app records **strength and similar sessions** on its own. Running, cycling, hiking and swimming are recorded with Apple's **Workout app** and imported via HealthKit. | Owner |
| T8 | Offline | iOS/watchOS are offline-first (local store + sync queue). | Default |
| T9 | Apple Health | Two-way: read workouts, routes, HR and weight; write nutrition, weight and Enduva strength workouts. Dedupe by source + HealthKit UUID. | Default |
| T10 | Apple extras | Live Activities + widgets in v1. Complications, App Intents and Shortcuts later. | Default |
| T11 | Distribution | TestFlight first, App Store later. | Default |
| T12 | Android | Not planned. The API stays client-agnostic. | Default |
| T13 | Database & auth | **Supabase**: local via Supabase CLI for development, **Supabase Cloud** (EU region) for staging and production. NestJS checks Supabase JWTs. Drizzle ORM. RLS as defence in depth. | Owner + Default |
| T14 | Login methods | **Email** (password + magic link) and **Google**. See open question O2 about Sign in with Apple. | Owner |
| T15 | Monorepo | pnpm workspaces + Turborepo. | Default |
| T16 | Background jobs | pg-boss (Postgres-backed queue, no Redis). | Default |
| T17 | AI provider | **OpenAI by default**, behind a provider-agnostic abstraction (Vercel AI SDK). Model IDs are configured via env. | Owner |
| T18 | i18n | German + English. Paraglide (web), String Catalogs (Swift). Food and exercise names are translatable in the data model. | Owner + Default |
| T19 | Observability | Structured logs (pino) + error tracking (Sentry free tier or self-hosted GlitchTip; see O7). | Default |
| T20 | Secrets | 1Password Environments for local `.env`. GitHub Actions secrets and Dokploy env for deployed environments. | Default |

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

## Open questions

| # | Question | Why it matters | Proposal |
| --- | --- | --- | --- |
| O1 | **Licence** for the public repo? | Without a licence, the code is "all rights reserved". A later subscription argues against permissive licences, or for AGPL (Endurain uses AGPL-3.0). | AGPL-3.0, or "source-available, all rights reserved" if you want to keep commercial options |
| O2 | Add **Sign in with Apple**? | App Store Review Guideline 4.8: an app that offers third-party login (Google) must also offer an equivalent privacy-focused login option. In practice this means Sign in with Apple. TestFlight external testing goes through Beta App Review. | Add Apple login (Supabase supports it), at least in the iOS app |
| O3 | Paid **Apple Developer Program** membership + Team ID? | Required for TestFlight, App Groups, push and HealthKit on real devices outside local debug builds | Needed before Phase 1 |
| O4 | **Supabase plan** for production? | Free tier: 500 MB DB, projects pause after a week of inactivity, no automatic backups. An Open Food Facts subset for DACH can exceed 500 MB. | Free for staging, Pro (~$25/month) for prod once real data exists |
| O5 | Confirm P9: is the answer "Nein" to advanced metrics right? What about **HR zone distribution** and simple **personal records** (fastest 5 km, …)? | Changes the analysis scope in Phase 1 | Include HR zones + simple PRs, skip CTL/ATL/TSB/VO2max |
| O6 | Map tile provider: MapTiler or Stadia? | Needs an API key + attribution | MapTiler (generous free tier, EU company) |
| O7 | Error tracking: Sentry SaaS or self-hosted GlitchTip on Dokploy? | Cost vs. operational effort | Sentry free tier |
| O8 | Staging domains | Must fit the wildcard DNS record | `staging.enduva…`, `app-staging.enduva…`, `api-staging.enduva…` |
| O9 | Commit signing for agent commits | Commits are signed via the 1Password SSH agent, which can block unattended agents | Keep signing, and keep 1Password unlocked while agents work |
