# 04 — Roadmap

Each row in the task tables is **one PR** (branch → worktree → review → merge) with an **observable acceptance check**. A shared number with letter suffixes (`0.8a`, `0.8b`) groups the PRs of one parent topic. IDs are stable and used as issue titles (`[1.3] …`). Tasks marked ∥ can run in parallel with their siblings once their dependencies are merged.

Once the owner approves the plan, phases become **GitHub milestones** and tasks become **issues**.

**Gates** are checkpoints with explicit criteria. Work beyond a gate's scope may continue, but the gated action (e.g. accepting real user data) doesn't happen until the gate passes:

| Gate | Blocks | Criteria |
| --- | --- | --- |
| **G1 — Real data** | Opening sign-up on **production** and storing real health data anywhere. Until then, staging uses **synthetic data only**, and production sign-up is **disabled in Supabase Auth** (not just hidden in the UI) | Legal basis documented (Art. 6(1)(b) for the service, Art. 9(2)(a) **explicit consent** for health data, separate purpose-specific consent for AI). DPIA screening done and, if required, a DPIA. Tasks **G1.1–G1.4** merged and verified: real privacy policy + imprint live, data-sources page live, deletion-aware restore drill passed, sign-up lock verified. Account deletion and data export work end to end, **including Storage objects and queued jobs**. AI provider terms + retention documented (see architecture). GlitchTip privacy configuration from 0.12e verified. **Consent enforcement verified** (0.13a ingestion + jobs, processing of stored/derived data, 1.8 AI egress, export/deletion still available after withdrawal). **Tile proxy** live and verified (no direct third-party tile requests), and **proxy + ingress logging verified on the deployed path**: no retained tile paths linked to client IPs or referrers. |
| **G2 — External distribution** | External TestFlight and App Store | Guideline 4.8 met (Sign in with Apple, task 0.14). In-app account deletion works for Apple accounts created on iOS **and** on the web, including Apple token revocation (Guideline 5.1.1(v)). Privacy nutrition labels. HealthKit usage strings. G1 passed. |

---

## Phase 0 — Foundations

**Goal:** a deployed, empty-but-real system. Sign-up works on **staging** (web + internal TestFlight) with synthetic accounts. Tooling, CI and the review workflow are in place.

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| 0.1 | docs | Project plan (this PR) | Owner + reviewer approval | — |
| 0.2 | chore | Repo hygiene: `AGENTS.md`/`CLAUDE.md`, `CONTRIBUTING.md`, PR + issue templates, CLA bot for external contributions (ELv2 `LICENSE` already added in 0.1), `.editorconfig`, commitlint + lefthook, labels (`needs-arbiter`, …) | A bad commit message is rejected by the hook. **CLA:** owner-approved CLA text grants hosting and relicensing rights. A test PR from a non-allowlisted account is blocked by the required CLA check until signed. Owner and agent commits are allowlisted | 0.1 |
| 0.3 | spike | **TypeScript 7 toolchain** (criteria in architecture). ADR-0001 | All six spike criteria pass in CI (incl. lockfile audit and production builds), or the blocker is documented for the owner | 0.2 |
| 0.4 | chore | Monorepo scaffold: pnpm, Turborepo, `packages/config`, empty `contracts`, `domain`, `db`, `i18n`, `ui` | `pnpm turbo build typecheck lint test` green on an empty workspace | 0.3 |
| 0.5 | ci | GitHub Actions (lint, typecheck, test, build, commitlint, gitleaks, CodeQL), Renovate. **Ruleset on `main`**: PRs required, required status checks, no force pushes | A PR with a type error is blocked from merging | 0.4 |
| 0.6 | design ∥ | Brand identity: final production assets for the chosen **concept B "Daybreak"** (Icon Composer layers, iOS dark/tinted, watchOS 1088 px, favicon, OG image) + `packages/ui/tokens` | Tokens importable from `@enduva/ui/tokens`. Icon renders at 16–1024 px | 0.4 |
| 0.7 | feat(db) ∥ | Supabase local, Drizzle, migration flow, roles (`enduva_api`, `enduva_worker`, owner), `profiles`, `user_settings`, `entitlements`, `consents`, `devices` + RLS. ADR-0002 | **Cross-tenant test suite** passes through the pooler. `supabase db reset` reproducible | 0.4 |
| 0.8a | feat(api) | NestJS skeleton: Zod env config, pino, health, problem+json, throttling, transaction-per-request DB access with transaction-local identity | `/v1/health` e2e test. Boots under SWC. TS 7 `tsc --noEmit` clean | 0.7 |
| 0.8b | feat(api) | Auth: JWKS verification per the architecture rules, account/session status check, `/v1/me` GET/PATCH | Tests: wrong `iss`/`aud`/alg rejected. Deleted account with an unexpired token gets 401 on writes | 0.8a |
| 0.8c | feat(contracts) | Zod → OpenAPI generation, CI drift check, generated TS web client + Swift client package | Changing a schema without regenerating fails CI. Swift client compiles | 0.8b |
| 0.9a | feat(web) | React Router app shell: Paraglide (de/en), Tailwind + tokens, layout, navigation, error boundaries | Language switch works. Playwright smoke test | 0.6, 0.8c |
| 0.9b | feat(web) | Web auth: email/password, magic link, Google, Turnstile, profile/settings page | Playwright: sign up → confirm (Inbucket locally) → edit profile | 0.9a |
| 0.10 | feat(landing) ∥ | Landing page skeleton, **prerendered under `/de/…` and `/en/…`**: hero, pillars, AI section, CTA, **legal page placeholders**, OG tags, `hreflang`, sitemap | Lighthouse ≥ 90 (perf/a11y/SEO). Direct loads of `/de/…` and `/en/…` from the static image return the right language and `<html lang>` | 0.6 |
| 0.11a | feat(apple) ∥ | Xcode project: iOS + watchOS + `EnduvaKit`, SwiftLint/swift-format, String Catalogs, build/test scripts | `xcodebuild test` green for both platforms in CI or locally | 0.6, 0.8c |
| 0.11b | feat(apple) | iOS sign-in (email, Google), profile screen, generated client wired. **TestFlight internal upload path** pinned (Xcode/Transporter/`altool`) | Build appears in TestFlight internal and signs in against staging | 0.11a, 0.12c |
| 0.12a | build(deploy) ∥ | Dockerfiles (api/worker, web, landing), image build + push to GHCR **by digest** | Images build in CI. Containers start locally with `compose.yaml` | 0.8a, 0.9a, 0.10 |
| 0.12b | build(deploy) ∥ | Supabase Cloud bootstrap: staging + prod projects (EU), asymmetric JWT keys, auth config, roles, `supabase db push` job | Migrations apply to staging from CI. Cross-tenant suite passes against staging | 0.7 |
| 0.12c | build(deploy) | Dokploy staging deploy: compose stack, domains/TLS, env, deploy script (CLI), per-environment concurrency lock, smoke tests | Merge to `main` → staging updated with the **same image digests** CI built. Smoke tests green | 0.12a, 0.12b |
| 0.12d | build(deploy) | Release wiring: "Enduva Release" GitHub App (created by the owner), release-please + protected production deploy job that **promotes the staging-tested digests** | Dry-run release deploys the tested digests to prod (empty DB). Includes the deployment-doc cases: slow staging, failing smoke test, an **overlapping push + release-PR merge where the newer push adds a migration** (the candidate is verified in the isolated environment, and no untested SHA or migration set is ever released), and a **cancelled queued release run** (the pending release is completed by the next run) | 0.12c |
| 0.12e | build(deploy) ∥ | **GlitchTip** on Dokploy (own compose stack with its Postgres + Valkey) at `errors.enduva.soeenplop.dev`, projects for api/worker/web/landing/iOS, DSNs in env | A test exception from the API appears in GlitchTip. **Privacy config** (required before G1): SDK-side scrubbing in every client and server (`sendDefaultPii` off, a `beforeSend` that drops request/response bodies, health payloads, tokens, cookies, query strings and signed URLs; only a pseudonymous user ID, no IP), open user registration disabled, operator-only accounts with 2FA, event retention 30 days, backups of the GlitchTip DB 30 days. Representative API, web and iOS errors carrying health data are sent, and the stored events are inspected: none contain health data or secrets | 0.12c |
| 0.12f | build(deploy) ∥ | **Tile proxy** (`tiles.enduva.soeenplop.dev`): caching reverse proxy for OpenFreeMap that strips cookies, `Referer`, user agents and identifiers | Network check from the web app: tiles come only from the proxy. The upstream request carries no client data. **Logging:** proxy access log off (only aggregate counters), and the Traefik/Dokploy ingress access log disabled for the `tiles.` host (or configured without path, client IP and `Referer`). Verified after test requests by inspecting the logs on the server | 0.12c |
| 0.13a | feat | Onboarding (body data, goals) + consent screens, web + iOS. **Three separate decisions:** the iOS HealthKit permission (OS level), the GDPR **health-data processing consent** (Art. 9(2)(a)), and the **AI consent**. The API **enforces** an active, purpose-specific health-data consent on every ingestion path (activity/workout/diary/body sync pushes, file uploads) and in every worker job before processing | Consent versions stored. Without or after withdrawing health-data consent, a direct ingestion request is rejected and an **already-queued import job** does not process the file. AI consent is checked separately (1.8) | 0.9b, 0.11b |
| 0.13b | feat | **Account deletion** (DB rows, Storage objects, queued jobs cancelled, Auth user, device sessions) + deletion log for restores | Integration test: nothing of the user remains, and queued jobs don't run | 0.12c |
| 0.13c | feat | **Data export** (JSON + original files as ZIP, expiring link) | Export contains every user-owned table + Storage objects | 0.13b |
| 0.14 | feat | Sign in with Apple on iOS + web. Apple tokens are stored **per client ID** (iOS bundle ID vs. web Services ID), because revocation needs the matching client ID. **iOS:** the app sends the `authorizationCode` to the API, which exchanges it and stores the refresh token encrypted. **Web:** after the Supabase OAuth callback, the API captures the Apple refresh token server-side (provider refresh token from the callback session, never exposed to the browser). If none was captured, deletion uses a **web re-auth flow** (Apple authorization-code flow with the web Services ID, handled by the API) to obtain one. **Account deletion revokes the Apple authorization** (Apple's token revocation endpoint, per TN3194). If no token is available, the app re-authenticates with Apple during deletion to get one, and as a last resort shows the user how to remove Enduva under Apple ID → Sign in with Apple. Web: Apple Services ID + callback URL per environment, and an **automated client-secret rotation** (see deployment) | Works on device and web. Account linking with an existing email account. **End-to-end deletion** of an Apple account **created on iOS and one created on the web** each revokes the Apple authorization with the matching client ID | 0.11b, 0.9b, 0.13b |

**Exit criteria:** staging is live. Synthetic accounts can sign up via web and internal TestFlight. Deletion and export work. CI is green, `main` is protected, and the review workflow has run on every PR above.

### G1 readiness tasks

These can run in parallel with Phase 1. G1 passes only when all are merged and verified.

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| G1.0 | chore(deploy) | **Sign-up lock** on production: `enable_signup = false` in Supabase Auth (prod) plus a UI notice, until G1 is declared passed | Sign-up through the Auth API directly (bypassing the UI) is rejected on prod. Checked in CI against prod config | 0.12b |
| G1.1 | docs(landing) | **Live legal pages** (de/en): privacy policy (health data, AI processors, retention, rights), imprint, AI/medical disclaimer, terms. Texts supplied or approved by the owner | Pages live and linked from landing, web app and iOS settings. Owner approval in the PR | 0.10 |
| G1.2 | feat | **Data-sources page** (BLS CC BY, OFF ODbL + offer link) + in-app "About" | Linked from landing and apps | 0.10 |
| G1.3 | feat(api) | **Privacy event log outside the rollback boundary**: append-only, idempotent log stored outside the main database (versioned object storage or a separate DB) of **account deletions, consent changes (grants and withdrawals per purpose) and completed health-data purges**. Each event is written durably **before** the irreversible action or state change it records. The deletion job is idempotent and resumable (marker → disable auth → delete rows → delete objects → mark complete). A **replay command** re-applies all events newer than a backup to a restored system: it deletes accounts, sets consents to their latest state and re-runs purges | Replay on a restored DB + Storage removes deleted accounts, restores the latest consent state and removes purged health data. A crash at any step resumes to completion | 0.13b |
| G1.4 | chore | **Privacy-aware restore drill**: restore prod-like backup (DB + objects) into a scratch project in maintenance mode, **replay the privacy event log before any API or worker starts**, verify, and only then serve traffic. Runbook in `docs/runbooks/restore.md` | Drill passes with synthetic data, including: a user deleted after the backup was taken, a deletion **interrupted between the marker and the cleanup** followed by a restore of an older backup (the user must stay deleted), and a **retained account** that withdrew consent and had its health data purged after the backup (consent stays withdrawn, purged data stays gone) | G1.3, 0.12b |
| G1.5 | docs | DPIA screening (+ DPIA if required), records of processing, legal basis/consent mapping, AI provider terms + transfer basis | Document in `docs/privacy/`, owner approval | 1.8 |

---

## Phase 1 — Endurance

**Goal:** all Apple Workouts (run, ride, hike, swim) show up in Enduva automatically with map, charts and an AI analysis. Files from other devices can be imported.

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| 1.0a | feat(api) | **Sync protocol** (ADR-0004): `sync_state`, push/pull, base-version conflicts, tombstones, cursor expiry | Test suite from the architecture (parallel transactions, duplicates, stale-after-delete, expiry) green against real Postgres | 0.8c |
| 1.0b | feat(apple) | `EnduvaKit` sync engine: SwiftData store, outbox, push/pull, conflict notices, full resync | Offline create/edit/delete → reconnect → server state matches. Tests with a mocked API | 1.0a, 0.11b |
| 1.1 | feat(db,api) | Activities model (+ laps, streams storage per ADR-0003), ingest via sync, list/detail/update/delete | API tests incl. cross-tenant access | 1.0a |
| 1.2 | feat(domain) ∥ | Splits, moving time, elevation smoothing, pace/speed, HR zones, LTTB downsampling, polyline encoding | Unit tests with fixture streams | 0.4 |
| 1.3a | feat(apple) | HealthKit permissions + anchored-query import (workouts, routes, HR, splits, swim laps), **foreground catch-up**, handling of late-arriving routes/samples (re-import updates the activity) | Synthetic HealthKit data on a simulator imports correctly. A route added later updates the activity | 1.0b, 1.1 |
| 1.3b | feat(apple) | **Background delivery**: entitlement, observer queries, completion handling, retry | **Real-device check:** a new workout is imported in the background at the system's discretion. Opening the app always catches up fully | 1.3a |
| 1.4a | feat(api) ∥ | File import backend: signed upload, pg-boss job, FIT/GPX/TCX parsing | Fixture files from Garmin, Wahoo and Coros parse into correct activities | 1.1 |
| 1.4b | feat(web) | File upload UI with progress + parse status | Playwright: upload a FIT file → activity appears | 1.4a, 1.5 |
| 1.5 | feat(web) ∥ | Activity list (filters), calendar, weekly/monthly totals | Playwright with seeded data | 1.1 |
| 1.6 | feat(web) | Activity detail: MapLibre map via the first-party tile proxy, charts, splits, edit metadata | Playwright + visual check on a fixture activity. Network check: no third-party tile requests, no `Referer` | 1.2, 1.5, 0.12f |
| 1.7 | feat(apple) ∥ | Activity list + detail (MapKit, Swift Charts), edit metadata | UI test on fixture data | 1.3a |
| 1.8 | feat(api) | AI foundation: AI module, model registry, re-check of **AI consent, health-data consent** and account status before provider egress, usage + quotas, prompt versioning, recorded fixtures | A job queued before withdrawal of either consent is not sent. Quota exceeded → 429 | 0.13a |
| 1.9 | feat(ai) | Post-activity AI analysis (worker job, shown on web + iOS, regenerate) | Fixture-based tests. Output in the user's language | 1.8, 1.6, 1.7 |
| 1.10 | feat ∥ | **Public share links**: explicit opt-in per activity, response **field allowlist** (no private notes, no HR unless opted in, no device info). **Route hidden by default.** If the user enables it, they see a **preview of the redacted route** before publishing, and redaction uses user-defined **privacy zones** (e.g. home, work) rather than only a fixed trim, which still leaks loop and out-and-back routes. Revocation. `Cache-Control: no-store` on the share page, its API response and **all private media** (map images, streams). No CDN caching. Map viewport and tile requests derive **only from the redacted route**, also in the preview | Tests: revoked link → 404 immediately on page, API and media URLs (verified through the deployed proxy/CDN path). Private fields never in the response. Route points inside privacy zones never in the response. Browser network check: no tiles requested for areas inside privacy zones | 1.6 |
| 1.11 | feat | Simple personal records + HR zone distribution | Unit + UI tests | 1.2 |
| 1.12a | feat(domain) ∥ | **Training-load math on one comparable scale** (ADR-0006): every method yields a **TSS-equivalent** load anchored at "1 h at threshold = 100": hrTSS (HR vs. LTHR), rTSS (pace vs. threshold pace), sTSS (CSS), and for strength an **sRPE-to-intensity mapping** (RPE → intensity factor, load = h × IF² × 100) instead of raw sRPE × minutes. No raw TRIMP in the aggregate. CTL (42-day EWMA), ATL (7-day EWMA), TSB, plus **per-method/per-sport breakdowns**. Threshold auto-estimation (HRmax, resting HR from HealthKit, LTHR/threshold pace from best efforts) | Unit tests against published reference examples. A **mixed endurance/strength fixture week** gives plausible, method-independent totals (e.g. 1 h at threshold via HR or pace ≈ 100). Method recorded per session | 0.4 |
| 1.12b | feat(api) | Thresholds API (auto + user override with validity dates), per-activity load on ingest, daily load series job (recomputes after edits, late imports, threshold changes) | Changing a threshold recomputes affected days. Late-imported activity updates CTL/ATL/TSB | 1.12a, 1.1 |
| 1.12c | feat ∥ | Training-load chart (CTL/ATL/TSB) + weekly load on web and iOS, with method/estimate labels | UI tests on fixture data | 1.12b, 1.6, 1.7 |
| 1.13 | feat | **VO2max**: HealthKit `vo2Max` import (sync, dedupe), own estimate for non-Apple sessions (marked as estimate), trend on web + iOS | Apple values imported once. Estimates never overwrite Apple values | 1.3a, 1.12a |

**Exit criteria:** with a **synthetic** 12-month HealthKit dataset (and, once G1 has passed, the owner's real data), imports match the source (spot-checked against the Fitness app). Background delivery works on a real device. Foreground catch-up is complete.

---

## Phase 2 — Strength

**Goal:** Enduva replaces Hevy for the owner, including full logging on the Apple Watch.

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| 2.1 | feat(db) | Exercise library: schema, translations, import from the open dataset (licence check in PR), custom exercises API | Seeded library searchable in de/en. Custom exercises are private (cross-tenant test) | 0.12c |
| 2.2 | feat(api) | Routines + folders CRUD, workouts + sets model and API, sync support | API + sync tests | 2.1, 1.0a |
| 2.3 | feat(domain) ∥ | 1RM (Epley/Brzycki), PR detection, volume, "previous values" | Unit tests | 0.4 |
| 2.4 | feat(web) ∥ | Exercise browser, routine editor (drag & drop, supersets), workout history | Playwright | 2.2 |
| 2.5 | feat(web) | **Web workout logging** (start from routine/empty, log sets, rest timer, finish) | Playwright: log a full workout in the browser → it appears on iOS after sync | 2.4 |
| 2.6 | feat(apple) | iPhone workout logging: set types, RPE/RIR, rest timer, previous values, summary, offline via outbox | Offline workout → reconnect → synced. UI test | 2.2, 1.0b |
| 2.7 | feat(apple) | Live Activity + Dynamic Island | Shown on device during a workout | 2.6 |
| 2.8a | feat(apple) | **Watch device session** (ADR-0005): link code, own session, refresh, revocation | Real paired device: works with the phone off. Sign-out on the phone wipes the Watch | 0.11b, 0.8b |
| 2.8b | feat(watch) | **watchOS standalone logging**: `HKWorkoutSession`, routine picker, Digital Crown input, rest timer + haptics, HR, sync via WatchConnectivity / direct | Real device: complete a workout with the phone off → synced later without duplicates | 2.6, 2.8a |
| 2.9 | feat(apple) | Mirrored sessions per the recording-mode table, single HealthKit save authority, start from iPhone wakes the Watch, disconnect handling | Real devices: mirrored, Watch-only and phone-only modes each produce **exactly one** HKWorkout and one intact Enduva workout, including: finish on the iPhone while the Watch is disconnected, Watch power loss mid-session (takeover only after an explicit `lost` report), a retried save after a successful one, and **a successful Watch save whose acknowledgment is lost while the user triggers the iPhone fallback** (reconciliation leaves exactly one) | 2.8b |
| 2.10 | feat ∥ | Progress: PRs, est. 1RM, volume charts (web + iOS) | UI tests on fixture data | 2.3, 2.4, 2.6 |
| 2.12 | feat | Strength sessions feed training load (sRPE → intensity mapping, TSS-equivalent) | CTL/ATL/TSB include strength sessions, with the method labelled | 1.12b, 2.6 |
| 2.11 | feat(ai) | AI routine generation + progression suggestions | Generated routines pass validation (volume limits). Fixture tests | 1.8, 2.2 |

**Exit criteria:** four consecutive weeks of strength training logged only in Enduva (Watch + iPhone + one web session) without data loss or duplicates. Real data only after G1.

---

## Phase 3 — Nutrition

**Goal:** a daily nutrition diary with European products, barcode scanning, AI photo/text logging and a dynamic calorie goal. Works fully offline on iOS.

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| 3.1 | feat(db) | Food catalog schema (**separate datasets per source**, see architecture), translations, servings, composable search, **BLS 4.0 importer** (CC BY 4.0 attribution) | Search "Vollkornbrot" / "whole grain bread" returns BLS items. Attribution is visible | 0.12c |
| 3.2 | feat(api) ∥ | **Open Food Facts dataset**: barcode lookup + cache in the OFF dataset, optional DACH importer job (sized to the Supabase plan), ODbL attribution + share-alike offer page | Barcode lookup works. OFF data lives only in OFF tables. The attribution page is linked from the apps | 3.1 |
| 3.3 | feat(api) | Diary API: entries, meals, quick-add, water, favourites/recents, custom foods, nutrient snapshots, sync support | API + sync tests. Custom foods private (cross-tenant test) | 3.1, 1.0a |
| 3.3b | feat(api) ∥ | **Body metrics API**: weight, body fat, measurements, trend (smoothed), HealthKit-sourced samples via sync | API + sync tests. Trend endpoint returns a smoothed series | 3.3, 1.0a |
| 3.4 | feat(domain) ∥ | BMR/TDEE, goal pace → kcal, macro split, dynamic target from training energy | Unit tests | 0.4 |
| 3.5 | feat(api) | Goals API + daily targets (pulls energy from activities **and** workouts) | Targets change after a logged activity/workout | 3.3, 3.4, 1.1, 2.2 |
| 3.6 | feat(web) ∥ | Diary UI, food search, custom foods, goals, weight chart | Playwright | 3.3, 3.3b, 3.5 |
| 3.7a | feat(apple) | **iOS diary with offline CRUD**: food search (cached recents/favourites offline), entries, water, weight (via 3.3b), outbox sync | **Offline:** add, edit and delete entries → reconnect → server matches, including editing/deleting an entry created offline | 3.3, 3.3b, 3.5, 1.0b |
| 3.7b | feat(apple) | Barcode scanner (VisionKit) + HealthKit write (nutrition, water, weight) + weight read, deduped | Scan → entry. Health shows the samples once. Deleting removes them from Health | 3.7a, 3.2 |
| 3.8a | feat(ai) | Recognition storage + API: photo upload, `ai_recognitions`, model call, items + grams + clarifying questions, answer round-trip | Fixture tests: "Auflauf" → asks about cheese. Answers refine the grams | 1.8, 3.3 |
| 3.8b | feat(ai) | Matching of recognised items to the catalog (BLS/OFF/custom), "AI estimate" fallback | ≥ 80 % top-3 match rate on a fixture set of 30 meals | 3.8a, 3.2 |
| 3.8c | feat(web) ∥ | Recognition UI on the web (upload/text, questions, confirm) | Playwright with a mocked AI | 3.8b, 3.6 |
| 3.8d | feat(apple) ∥ | Recognition UI on iOS (camera/text, questions, confirm, offline queueing of the request) | UI test with a mocked AI | 3.8b, 3.7a |
| 3.9 | feat ∥ | Recipes (private) | API + UI tests | 3.3 |
| 3.10 | feat(apple) | Widgets: today's calories/macros, water | Visible on device. Updates after logging | 3.7a |

**Exit criteria:** two weeks of food logged only in Enduva (once G1 has passed), including at least one offline day. AI recognition meets the 3.8b fixture threshold.

---

## Phase 4 — AI coach & training plans

| ID | Type | Task | Acceptance check | Depends on |
| --- | --- | --- | --- | --- |
| 4.1 | feat(api) | Plans model + API (plans, planned sessions, completion matching) | Completing an activity marks the matching session done | 1.1, 2.2 |
| 4.2 | feat(ai) | Goal-based plan generation (endurance / strength / hybrid) with server-side validation | Generated plans pass validation (progression, rest days). Fixture tests | 4.1, 1.8 |
| 4.3 | feat ∥ | Plan calendar UI (web + iOS), move/skip sessions | Playwright + UI test | 4.1 |
| 4.4 | feat(apple) | **WorkoutKit**: request authorization, check supported activity/device, schedule planned endurance sessions, **reschedule or remove** when a session moves or is skipped | Real device: a scheduled workout appears in the Workout app. Moving it updates it, skipping removes it. Denied permission shows a clear state | 4.3 |
| 4.5 | feat(ai) | Weekly plan adaptation job (uses completed vs. planned sessions, RPE **and CTL/ATL/TSB**). Uses only the TSS-equivalent aggregate and its breakdowns. Series marked low-confidence (e.g. missing thresholds, mostly estimated sessions) are used only as context, not as a trigger | Fixture scenarios (missed week, high RPE) produce sensible adjustments | 4.2 |
| 4.6 | feat(ai) | Chat coach with read-only tools (activities, workouts, diary, body, plan), history, delete | Tools are scoped to the current user (cross-tenant test). Deleting the history removes it | 1.8, 1.1, 2.2, 3.3, 3.3b, 4.1 |
| 4.7 | feat ∥ | Weekly summary (training + nutrition), optional push | Summary generated for a fixture week | 4.5 |

**Exit criteria (install/smoke gate):** a fresh TestFlight install → onboarding → generate a 4-week hybrid plan → sessions appear in the calendar and the endurance ones in the Watch's Workout app → complete one → the plan adapts → the coach answers a question citing the user's data correctly.

---

## Phase 5 — Public beta

| ID | Type | Task | Acceptance check |
| --- | --- | --- | --- |
| 5.1 | feat(landing) | Final landing page: screenshots, feature tour, FAQ, TestFlight / App Store links | Lighthouse ≥ 90. de/en complete |
| 5.2 | chore | Production hardening: backups incl. Storage objects (see deployment), **repeat the restore drill** (G1.4) on production backups, monitoring/alerts, rate-limit review, load test of hot endpoints | Restore drill documented and successful. p95 targets met under load |
| 5.3 | feat | Admin area: users, quotas, entitlements, feature flags (incl. AI kill switch) | Admin-only (authorisation tests) |
| 5.4 | chore(apple) | **G2** checklist + App Store submission | G2 criteria met. Build accepted for external testing |
| 5.5 | docs | User docs / help pages (de/en) | Linked from the apps and landing |

**Exit criteria (install/smoke gate):** G1 and G2 passed. A new external tester can install via public TestFlight link, sign up, connect Health, log a workout, a meal and an activity, export their data and delete their account, with no manual intervention by the owner.

## Later (backlog, not scheduled)

Social feed (follow, kudos, comments) · subscriptions (StoreKit 2 + web) · Garmin/Wahoo/Polar · micronutrients · intermittent fasting · plate calculator · exercise animations · Watch complications · App Intents/Shortcuts · community foods.
