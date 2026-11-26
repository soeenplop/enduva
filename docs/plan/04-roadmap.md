# 04 — Roadmap

Each line in the task tables is **one PR** (branch → worktree → review → merge). IDs are stable and used as issue titles (`[1.3] …`). Tasks marked ∥ can run in parallel with their siblings once their dependencies are merged.

Once the owner approves the plan, phases become **GitHub milestones** and tasks become **issues**.

---

## Phase 0 — Foundations

**Goal:** a deployed, empty-but-real system. You can sign up on staging (web + iOS) and see your profile. All tooling, CI and the review workflow are in place.

| ID | Type | Task | Depends on |
| --- | --- | --- | --- |
| 0.1 | docs | Project plan (this PR) | — |
| 0.2 | chore | Repo hygiene: `AGENTS.md`/`CLAUDE.md` (agent rules), `CONTRIBUTING.md`, PR + issue templates, licence (O1), `.editorconfig`, commitlint + lefthook, repo settings (merge commits only, auto-delete branches), branch ruleset on `main` | 0.1 |
| 0.3 | spike | **TypeScript 7 toolchain**: NestJS + SWC + `tsgo` type-check, SvelteKit type-checking (`.svelte`), oxlint type-aware, Vitest, drizzle-kit. Output: ADR-0001 + minimal working configs | 0.2 |
| 0.4 | chore | Monorepo scaffold: pnpm workspaces, Turborepo, `packages/config` (tsconfig/oxlint/prettier/vitest presets), empty `contracts`, `domain`, `db`, `i18n`, `ui` | 0.3 |
| 0.5 | ci | GitHub Actions: install/cache, lint, typecheck, test, build, commitlint (PR title + commits), gitleaks, CodeQL, Renovate config | 0.4 |
| 0.6 | design ∥ | **Brand identity by GPT-6.2 Astra**: app icon (iOS/watchOS sizes, favicon, OG image), wordmark, colour + type tokens in `packages/ui/tokens` | 0.2 |
| 0.7 | feat(db) ∥ | Supabase local (`supabase init`), Drizzle setup, migration flow (drizzle-kit → `supabase/migrations`), `profiles`, `user_settings`, `entitlements`, `ai_consents` + RLS, seed. ADR-0002 (DB access & RLS strategy) | 0.4 |
| 0.8 | feat(api) | NestJS skeleton: config (Zod-validated env), pino logging, health check, problem+json errors, Supabase JWT guard (JWKS), `/v1/me` GET/PATCH, OpenAPI generation + CI drift check, throttling | 0.7 |
| 0.9 | feat(web) ∥ | SvelteKit app: Paraglide (de/en), Tailwind + tokens, Supabase auth (email/password, magic link, Google), Turnstile on sign-up, app shell + navigation, profile/settings page | 0.8 |
| 0.10 | feat(landing) ∥ | Landing page skeleton (de/en): hero, three pillars, AI section, CTA, imprint + privacy placeholders, OG tags, sitemap | 0.6 |
| 0.11 | feat(apple) ∥ | Xcode project: iOS app + watchOS app + `EnduvaKit` package, SwiftLint/swift-format, String Catalogs, generated OpenAPI client, sign-in (email, Google), profile screen. Build script for CI/local | 0.8 |
| 0.12 | build(deploy) | Dockerfiles (api/worker, web, landing), `deploy/compose.yaml`, GHCR images in CI, Supabase Cloud projects (staging + prod, EU), `supabase db push` in CI, Dokploy CLI deploy script, domains + TLS, release-please | 0.8, 0.9, 0.10 |
| 0.13 | feat | GDPR basics: account deletion (API + web + iOS), data export job skeleton, consent screen (AI + Health), onboarding flow (body data + goals) | 0.9, 0.11 |

**Exit criteria:** staging is live at the staging domains. Sign-up works via web and TestFlight internal build. CI is green. The review workflow has been exercised on all PRs above.

---

## Phase 1 — Endurance

**Goal:** all Apple Workouts (run, ride, hike, swim) show up in Enduva automatically with map, charts and an AI analysis. Files from other devices can be imported.

| ID | Type | Task | Depends on |
| --- | --- | --- | --- |
| 1.1 | feat(db,api) | Activities model (+ laps, streams storage per ADR-0003), idempotent ingest endpoint, list/detail/update/delete endpoints | 0.12 |
| 1.2 | feat(domain) ∥ | Pure functions: splits per km, moving time, elevation smoothing, pace/speed, HR zones (if O5), stream downsampling (LTTB), polyline encoding. Unit-tested | 0.4 |
| 1.3 | feat(apple) | HealthKit permissions + workout import (anchored query, routes, HR, splits, swim laps), background delivery, upload via sync engine v1 | 1.1 |
| 1.4 | feat(api) ∥ | File import: upload to Storage via signed URL → pg-boss job → FIT/GPX/TCX parsing → activity | 1.1 |
| 1.5 | feat(web) ∥ | Activity list (filters by sport), calendar, weekly/monthly totals | 1.1 |
| 1.6 | feat(web) | Activity detail: MapLibre map, synced charts (elevation, pace/speed, HR, cadence), splits table, edit metadata, file-upload UI | 1.2, 1.5 |
| 1.7 | feat(apple) ∥ | Activity list + detail (MapKit, Swift Charts), edit metadata | 1.3 |
| 1.8 | feat(api) | AI foundation: AI module, model registry, consent guard, usage + quotas, prompt versioning, test fixtures with recorded responses | 0.13 |
| 1.9 | feat(ai) | Post-activity AI analysis (worker job after ingest, shown on web + iOS, regenerate on demand) | 1.8, 1.6, 1.7 |
| 1.10 | feat ∥ | Public share links for activities (read-only page on the web app) | 1.6 |
| 1.11 | feat | Simple personal records + HR zone distribution (pending O5) | 1.2 |

**Exit criteria:** the owner's last 12 months of Apple Workouts are imported correctly (spot-checked against the Fitness app). New workouts appear within minutes without opening the app.

---

## Phase 2 — Strength

**Goal:** Enduva replaces Hevy for the owner, including full logging on the Apple Watch.

| ID | Type | Task | Depends on |
| --- | --- | --- | --- |
| 2.1 | feat(db) | Exercise library: schema, translations, import from the open dataset (licence check in PR), custom exercises API | 0.12 |
| 2.2 | feat(api) | Routines + folders CRUD, workouts + sets model and API, sync support | 2.1 |
| 2.3 | feat(domain) ∥ | 1RM estimation (Epley/Brzycki), PR detection, volume aggregation, "previous values" lookup logic | 0.4 |
| 2.4 | feat(web) ∥ | Exercise browser, routine editor (drag & drop, supersets), workout history | 2.2 |
| 2.5 | feat(apple) | iPhone workout logging: start from routine/empty, set types, RPE/RIR, rest timer, previous values, finish summary. SwiftData + outbox sync for workouts | 2.2 |
| 2.6 | feat(apple) | Live Activity + Dynamic Island for the active workout | 2.5 |
| 2.7 | feat(apple) | **watchOS standalone logging**: `HKWorkoutSession`, routine picker, set logging (Digital Crown for weight/reps), rest timer + haptics, HR. Sync via WatchConnectivity / direct | 2.5 |
| 2.8 | feat(apple) | Mirrored workout session (Watch ↔ iPhone), save HKWorkout to Health with Enduva metadata, import-dedupe | 2.7 |
| 2.9 | feat ∥ | Progress: PRs, est. 1RM and volume charts per exercise/muscle group (web + iOS) | 2.3, 2.4, 2.5 |
| 2.10 | feat(ai) | AI routine generation + progression suggestions | 1.8, 2.2 |

**Exit criteria:** the owner logs four consecutive weeks of strength training only in Enduva (Watch + iPhone) without data loss.

---

## Phase 3 — Nutrition

**Goal:** a daily nutrition diary with European products, barcode scanning, AI photo/text logging and a dynamic calorie goal.

| ID | Type | Task | Depends on |
| --- | --- | --- | --- |
| 3.1 | feat(db) | Foods schema, translations, servings, search (tsvector de/en + trigram), BLS 4.0 importer (licence terms documented) | 0.12 |
| 3.2 | feat(api) ∥ | Open Food Facts: barcode lookup + cache, optional DACH subset importer as worker job (pending O4), attribution | 3.1 |
| 3.3 | feat(api) | Diary API: entries, meals, quick-add, water, favourites/recents, custom foods, nutrient snapshots | 3.1 |
| 3.4 | feat(domain) ∥ | BMR/TDEE, goal pace → kcal, macro split, **dynamic target from training energy**, daily target computation | 0.4 |
| 3.5 | feat(api) | Goals API + daily targets (uses activities/workouts energy) | 3.3, 3.4 |
| 3.6 | feat(web) ∥ | Diary UI, food search, custom foods, goals settings, weight chart | 3.3, 3.5 |
| 3.7 | feat(apple) | Diary UI, food search, **barcode scanner** (VisionKit), water, weight. HealthKit write (nutrition, water, weight) + weight read | 3.3, 3.5 |
| 3.8 | feat(ai) | **AI recognition** (photo + text): items + grams + clarifying questions, answer round-trip, DB matching, confirm UI (web + iOS) | 1.8, 3.2, 3.6, 3.7 |
| 3.9 | feat ∥ | Recipes (private): ingredients, portions, log recipe | 3.3 |
| 3.10 | feat(apple) | Widgets: today's calories/macros, water | 3.7 |

**Exit criteria:** the owner logs two weeks of food only in Enduva. The AI recognises ≥ 80 % of everyday meals with acceptable corrections, judged subjectively plus with a fixture set of 30 meal photos.

---

## Phase 4 — AI coach & training plans

| ID | Type | Task | Depends on |
| --- | --- | --- | --- |
| 4.1 | feat(api) | Plans model + API (plans, planned sessions, completion matching to activities/workouts) | Phase 1–2 |
| 4.2 | feat(ai) | Goal-based plan generation (endurance / strength / hybrid) with server-side validation | 4.1 |
| 4.3 | feat ∥ | Plan calendar UI (web + iOS), move/skip sessions | 4.1 |
| 4.4 | feat(apple) | WorkoutKit: schedule planned endurance sessions as custom workouts on the Watch | 4.3 |
| 4.5 | feat(ai) | Weekly plan adaptation job (completed vs. planned, RPE, missed sessions) | 4.2 |
| 4.6 | feat(ai) | Chat coach with read-only tools, conversation history, delete (web + iOS) | 1.8 |
| 4.7 | feat ∥ | Weekly summary (training + nutrition), optional push notification | 4.5 |

---

## Phase 5 — Public beta

| ID | Type | Task |
| --- | --- | --- |
| 5.1 | feat(landing) | Final landing page: screenshots, feature tour, FAQ, TestFlight / App Store links, real legal texts |
| 5.2 | chore | Production hardening: backups (O4), monitoring/alerts, rate-limit review, load test of hot endpoints |
| 5.3 | feat | Admin area: users, quotas, entitlements, feature flags |
| 5.4 | chore(apple) | App Store submission: privacy nutrition labels, HealthKit usage strings, review notes, Sign in with Apple (O2) |
| 5.5 | docs | User docs / help pages (de/en) |

## Later (backlog, not scheduled)

Social feed (follow, kudos, comments) · subscriptions (StoreKit 2 + web) · Garmin/Wahoo/Polar · micronutrients · intermittent fasting · plate calculator · exercise animations · Watch complications · App Intents/Shortcuts · community foods.
