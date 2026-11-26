# 01 — Product Scope

## Personas

- **Hybrid athlete.** Runs or rides 2–4×/week, lifts 2–3×/week and wants one place for both, plus nutrition matched to training load.
- **Recreational lifter who tracks food.** Mostly strength training. Wants fast logging in the gym (Watch!) and simple calorie tracking with European products.
- **Endurance beginner with a goal.** Wants an AI-generated plan (e.g. "first half marathon in 14 weeks") that adapts when life happens.

## Surfaces

| Surface | URL / target | Purpose |
| --- | --- | --- |
| Landing page | `enduva.soeenplop.dev` | Explain Enduva, show features and screenshots, link to sign up / TestFlight, legal pages |
| Web app | `app.enduva.soeenplop.dev` | Full app: analysis, planning, diary, settings. Best for large-screen analysis and routine editing |
| iPhone app | TestFlight → App Store | Daily driver: diary, barcode/photo logging, workout logging, HealthKit sync, Live Activities, widgets |
| Watch app | bundled with iPhone app | Standalone strength (and similar) session logging, quick water/food logging later |
| API | `api.enduva.soeenplop.dev` | Single backend for all clients |

## Feature scope by pillar

The scope uses MoSCoW: **M**ust (v1), **S**hould (v1 if time allows), **C**ould (later), **W**on't (explicitly out).

### Account & platform

| Feature | Priority |
| --- | --- |
| Sign up / sign in (email + password, magic link, Google, Apple) | M |
| Profile (name, birth date, sex, height, avatar), preferences (language, theme) | M |
| Onboarding (goals, body data, AI consent, Health permissions) | M |
| GDPR: data export (JSON/ZIP), account deletion | M |
| AI consent management + usage overview | M |
| Entitlements model (free / premium) without payment | M |
| Abuse protection: email confirmation, CAPTCHA (Turnstile), rate limits | M |
| Sign in with Apple (required alongside Google, Guideline 4.8) | M |
| Admin area (users, quotas, feature flags) | S |
| Subscriptions (StoreKit 2 + web payments) | C |
| Social feed, follows, kudos, comments | C |

### Endurance

| Feature | Priority |
| --- | --- |
| Import Apple Workouts (running, cycling, hiking, pool/open-water swimming) incl. route, HR and splits | M |
| Background sync of new workouts (HealthKit background delivery) | M |
| FIT / GPX / TCX file import via web upload | M |
| Activity list + calendar + weekly/monthly totals per sport | M |
| Activity detail: map, elevation/pace/HR/cadence charts, splits/laps, summary | M |
| Edit title, description, sport type, private notes. RPE/feel rating | M |
| Share a single activity via public link | S |
| HR zone distribution, simple personal records (fastest 1/5/10 km, longest ride, …) | M |
| **Training load:** per-session load (HR/pace/swim/sRPE method), CTL (fitness), ATL (fatigue), TSB (form) chart | M |
| **VO2max** trend (from Apple Health, estimate for other sources) | M |
| Personal thresholds (max/resting HR, LTHR, threshold pace, CSS): auto-estimated, user-editable | M |
| AI post-activity analysis ("what went well, what to watch") | M |
| Garmin / Wahoo / Polar integrations | C |
| Power zones, gear tracking | W (for now) |
| Strava integration | W |
| Live GPS recording inside Enduva | W (Apple Workout app does this) |

### Strength

| Feature | Priority |
| --- | --- |
| Exercise library (seeded, DE/EN names, muscle groups, equipment) + custom exercises | M |
| Routines + folders: exercises, target sets/reps/weight, rest times, supersets | M |
| Workout logging (iPhone): normal/warm-up/drop/failure sets, RPE/RIR, notes, rest timer, previous values inline | M |
| Live Activity for the active workout (rest timer, current set) | M |
| **Watch: full standalone logging** (start routine/empty workout, log sets, edit weight/reps, rest timer, HR) | M |
| Save strength workouts to Apple Health (HKWorkout with energy + HR) | M |
| Web: routine editor, workout history, logging on the web (secondary) | M |
| Progress: PRs, estimated 1RM, volume per muscle group, exercise history charts | M |
| AI: routine generation, progression suggestions | S |
| Plate calculator, exercise animations | C |

### Nutrition

| Feature | Priority |
| --- | --- |
| Food database: BLS 4.0 (generic foods) + Open Food Facts (branded/barcodes) + custom foods | M |
| Diary per day with meals (breakfast, lunch, dinner, snacks), servings and gram amounts | M |
| Barcode scanning (iPhone camera. Web: BarcodeDetector API where available) | M |
| Favourites, recents, quick-add calories | M |
| Recipes (private): ingredients → per-portion nutrition | S |
| Water tracking | M |
| Weight + body measurements, trend line | M |
| Calorie & macro goals: BMR (Mifflin–St Jeor) × activity + goal pace, **dynamic adjustment from training energy** | M |
| **AI photo recognition** → items + estimated grams + clarifying questions → match to DB → user confirms | M |
| **AI free-text logging** ("2 Brötchen mit Nutella und ein Cappuccino") with the same flow | M |
| Write nutrition to Apple Health. Read/write weight | M |
| Micronutrients, intermittent fasting | C |
| Community-shared foods | W (for now) |

### AI coach & plans

| Feature | Priority |
| --- | --- |
| Goal-based training plan generation (endurance, strength or hybrid) → calendar of planned sessions | M |
| Push planned endurance sessions to Apple Watch via **WorkoutKit** (scheduled custom workouts in the Workout app) | S |
| Plan adaptation based on completed/missed sessions and RPE | M |
| Chat coach with read-only tool access to the user's training, nutrition and body data | M |
| Weekly summary (training + nutrition) | S |

## Non-functional requirements

- **Performance:** API p95 < 300 ms for normal reads. Activity detail loads < 1 s on the web (streams downsampled for charts).
- **Offline:** iOS/watchOS logging works fully offline. Sync stays consistent (idempotent, conflict-safe).
- **Accessibility:** Dynamic Type, VoiceOver labels, WCAG AA contrast on the web.
- **Privacy:** EU data residency for the DB. Minimal data sent to AI (only what the feature needs). No AI training use (OpenAI API default). Data export + deletion.
- **Legal:** imprint and privacy policy on the landing page, plus a "not medical advice" disclaimer in AI and nutrition features.
