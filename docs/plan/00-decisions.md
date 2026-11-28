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
| P9 | Analysis depth | **Full training analysis:** summary metrics, splits, charts, map, HR zone distribution, simple personal records, **training load (CTL/ATL/TSB)** and **VO2max**, plus AI-written analysis. Load per session on **one TSS-equivalent scale** (1 h at threshold = 100) from power-free methods: hrTSS (HR), rTSS (running pace), sTSS (critical swim speed), and for strength a session-RPE → intensity mapping. Each value is labelled with its method, with per-sport breakdowns. VO2max primarily from Apple's HealthKit `vo2Max` samples, own estimate only for sessions without Apple data, clearly marked as an estimate. Power zones and gear tracking are not in scope for now. | Owner (former O5) |
| P10 | Maps | MapKit on iOS. MapLibre GL on the web with **OpenFreeMap** (free public OSM vector tiles, no key or account, attribution "© OpenMapTiles © OpenStreetMap contributors"). The tile source is a configurable style URL, so we can move to self-hosted Protomaps PMTiles (privacy, no third party) or MapTiler (outdoor/topo styles) later without code changes. OpenFreeMap has no SLA, so the style URL is a runtime config with a documented fallback. | Owner (former O6) |
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
| T1 | Language | **TypeScript 7** (native Go-based compiler; CLI `tsc` from `typescript@7`) for every TS package. **No TypeScript 6 fallback.** TypeScript < 7 is forbidden as a compiler, type checker, language service, or for emit/transpilation in our toolchain. TypeScript code that third-party tools bundle purely for parsing or formatting (e.g. Prettier's TypeScript parser used by TanStack's route generator) is tolerated only if it is explicitly allowlisted (package, exact version, bundled TS version, where it is used, why it is needed) and monitored by the bundled-TypeScript audit; every change to an allowlisted entry needs a conscious decision **by the lead** (W13). Our own formatter is oxfmt, not Prettier (see ADR-0001). | Owner (ruling on PR #97) |
| T2 | Backend | NestJS (REST + OpenAPI). Because TS 7 ships no JS compiler API and its `tsc` is not used for emit, NestJS is **compiled with SWC directly** (legacy decorators + decorator metadata; no Nest CLI, which depends on an older `typescript`) and **type-checked with TS 7 `tsc --noEmit`**. To be validated in spike 0.3. | Owner + Default |
| T3 | Web app | **React 19 with TanStack Start** (TanStack Router with file-based routes and a generated, fully typed route tree, Vite, SSR, server functions) at `app.enduva.de`. Data fetching with **TanStack Query**, forms with **TanStack Form**, tables (e.g. workout history, food lists) with **TanStack Table** where useful. React replaces SvelteKit because `svelte-check` needs TS 6 next to TS 7 and the owner allows **no workarounds** (former O10). TanStack replaces the earlier React Router 7 choice on the owner's request. `.tsx` is plain TypeScript, and the types from the generated route tree (which itself carries `@ts-nocheck`) flow into application code that TS 7 `tsc` checks. To be confirmed in spike 0.3. | Owner |
| T4 | Landing page | **Separate** TanStack Start app with **static prerendering** of all routes (static output), at `enduva.de` (`www.enduva.de` redirects there). Domain change 2026-11-28 (owner): all product hosts moved from `*.enduva.soeenplop.dev` to `enduva.de`; the Dokploy dashboard stays under `soeenplop.dev`. | Owner |
| T5 | API host | `api.enduva.de`. | Owner |
| T6 | Native apps | Swift 6 / SwiftUI, iPhone + Apple Watch. Targets **iOS 27 / watchOS 27** (latest; old devices are not supported). | Owner |
| T7 | Watch scope | The Watch app records **strength and similar sessions** on its own. Running, cycling, hiking and swimming are recorded with Apple's **Workout app** and imported via HealthKit. | Owner |
| T8 | Offline | iOS/watchOS are offline-first (local store + sync queue). | Default |
| T9 | Apple Health | Two-way: read workouts, routes, HR and weight; write nutrition, weight and Enduva strength workouts. Dedupe by source + HealthKit UUID. | Default |
| T10 | Apple extras | Live Activities + widgets in v1. Complications, App Intents and Shortcuts later. | Default |
| T11 | Distribution | TestFlight first, App Store later. | Default |
| T12 | Android | Not planned. The API stays client-agnostic. | Default |
| T13 | Database & auth | **Supabase**: local via Supabase CLI for development, **Supabase Cloud** (EU region) for production, and for staging once it exists (T25). NestJS checks Supabase JWTs. Drizzle ORM. RLS as defence in depth. Neon was considered and rejected: it would replace only the database, and Auth (no official Swift SDK for Better Auth) and Storage would have to be rebuilt. | Owner + Default |
| T13a | Supabase plans | **Free** for production until gate G1 (no real data before G1), and Free for staging once it exists. Production moves to **Pro** (~$25/month) when G1 passes. PITR only if the data volume justifies it. | Owner (former O4) |
| T14 | Login methods | **Email** (password + magic link), **Google** and **Sign in with Apple** (iOS + web, task 0.14; required by App Review Guideline 4.8 alongside Google). | Owner (incl. former O2) |
| T15 | Monorepo | pnpm workspaces + Turborepo. | Default |
| T16 | Background jobs | pg-boss (Postgres-backed queue, no Redis): built-in retries with backoff, dead-letter queues, cron schedules, singleton/throttling and expiration. Workers depend only on a small `JobQueue` interface, so the queue can be swapped later. **Supabase Queues (pgmq) was considered and rejected:** it lacks retry limits/backoff, dead-letter handling and **built-in recurring (cron) schedules**. It does support delayed delivery. The missing features would need custom code (retry limits/backoff, dead-letter handling), plus `pg_cron`/Supabase Cron or similar for recurring schedules, and its advantages (dashboard, client/Edge-Function enqueueing, transaction-pooler compatibility) don't matter here because only the API enqueues jobs. | Owner (confirmed after comparison) |
| T17 | AI provider | **OpenAI by default**, behind a provider-agnostic abstraction (Vercel AI SDK). Model IDs are configured via env. | Owner |
| T18 | i18n | German + English. Paraglide JS (framework-agnostic, compiled message functions) for web + landing, String Catalogs (Swift). Food and exercise names are translatable in the data model. | Owner + Default |
| T19 | Observability | Structured logs (pino) + error tracking with **self-hosted GlitchTip** on Dokploy (`errors.enduva.de`). GlitchTip speaks the Sentry protocol, so the Sentry SDKs for Node, React and Swift are used. | Owner (former O7) |
| T20 | Secrets | 1Password Environments for local `.env`. GitHub Actions secrets and Dokploy env for deployed environments. | Default |
| T21 | Apple Developer Program | Paid membership is available (Team ID provided during task 0.11a). | Owner (former O3) |
| T22 | Staging domains | `staging.enduva.de` (landing), `app.staging.enduva.de` (web), `api.staging.enduva.de` (API). **Reserved** until the staging environment exists (T25). | Owner (former O8) |
| T25 | Environments | **Start with a single environment: production** (one Supabase Cloud project, one Dokploy stack). Until G1, production holds **synthetic data only** and plays the role of staging: every push to `main` is verified in the **isolated candidate environment** in CI and then deployed to production continuously. A separate **staging environment** (second Supabase project + Dokploy stack on the reserved domains) and the release-gated production flow are introduced in task **G1.6**, as a G1 prerequisite, before any real data exists. Local development always uses `supabase start`, never the cloud project. | Owner |
| T23 | Licence | **Elastic License 2.0 (ELv2)**, source-available: everyone may use, modify and self-host the code, but **may not provide it to third parties as a hosted or managed service that gives users access to any substantial set of its features or functionality**, and may not circumvent licence-key functionality. This keeps the subscription business open. ELv2 is not an OSI open-source licence. Added as `LICENSE` in PR #1. | Owner (former O1) |
| T24 | Contributions | External contributions require a **CLA**, because under ELv2 alone the owner couldn't run contributed code as the hosted Enduva service or relicense it. The CLA explicitly grants the owner the right to use contributions in a hosted/managed service and to relicense them (incl. commercially). A required status check blocks unsigned external contributions before merge. The CLA text is drafted in task 0.2. The owner approves the final text, and enforcement is a small first-party workflow (requirements in the roadmap): until the text is final, task 0.5 ships an **interim gate** that admits only the owner and listed bots (owner ruling 2026-11-27); the full signature check (task CLA.1) is activated with the final text. | Default |

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
| W12 | Owner approval | Not required when Sol (LGTM @ head) and the lead agree. Still required only for owner-only decisions (legal texts, final CLA, licence, accounts, costs, third-party contracts), gate passes (owner sign-off in the gate issue), arbiter rulings (the owner's `Ruling:` comment is the record) and PRs the owner asked to review. Approvals count only if written by the owner personally or relayed by the lead with quote, source and SHA. | Owner (2026-11-27) |
| W13 | TypeScript exceptions | The **lead decides** TS < 7 exceptions under T1 without asking the owner: adding or changing bundled-TS allowlist entries, and tools that embed their own TypeScript (e.g. CodeQL's extractor). Each decision is recorded with reasoning in the PR (lasting ones also in ADR-0001), and the reviewer checks it. Implementers never change the allowlist themselves. The hard rule stays: TS < 7 never type-checks, emits or serves as a language service in **our** build toolchain. | Owner (2026-11-27) |
| W11 | Release automation | A GitHub App **"Enduva Release"** (contents + pull-requests write, this repo only) authenticates release-please. The owner creates and installs it during task 0.12d. | Owner (former O11) |

## Open questions

None at the moment. All former open questions (O1–O11) are recorded in the tables above with their former number in the Source column.
