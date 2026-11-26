# 03 — Domain Model

A first sketch. Column details are settled per feature PR. Conventions:

- `id uuid` (UUIDv7, can be generated on the client). `user_id` references `auth.users`.
- `created_at`, `updated_at`, `deleted_at` (soft delete for synced entities), `version bigint` (sync), `change_seq bigint` (per-user change feed).
- Every user-owned table has RLS `user_id = auth.uid()`.
- SI units in storage: metres, seconds, kilograms, grams, kcal, bpm.

```mermaid
erDiagram
  PROFILE ||--o{ ACTIVITY : owns
  PROFILE ||--o{ WORKOUT : owns
  PROFILE ||--o{ ROUTINE : owns
  PROFILE ||--o{ DIARY_ENTRY : owns
  PROFILE ||--o{ BODY_METRIC : owns
  PROFILE ||--o{ TRAINING_PLAN : owns
  PROFILE ||--|| NUTRITION_GOAL : has
  PROFILE ||--o{ ENTITLEMENT : has

  ACTIVITY ||--o{ ACTIVITY_LAP : has
  ACTIVITY ||--o| ACTIVITY_STREAMS : has

  ROUTINE ||--o{ ROUTINE_EXERCISE : contains
  ROUTINE_EXERCISE }o--|| EXERCISE : uses
  WORKOUT ||--o{ WORKOUT_EXERCISE : contains
  WORKOUT_EXERCISE ||--o{ WORKOUT_SET : has
  WORKOUT_EXERCISE }o--|| EXERCISE : uses
  WORKOUT }o--o| ROUTINE : from

  DIARY_ENTRY }o--o| FOOD : references
  DIARY_ENTRY }o--o| RECIPE : references
  FOOD ||--o{ FOOD_SERVING : has
  RECIPE ||--o{ RECIPE_INGREDIENT : has

  TRAINING_PLAN ||--o{ PLANNED_SESSION : has
  PLANNED_SESSION }o--o| ACTIVITY : completed_by
  PLANNED_SESSION }o--o| WORKOUT : completed_by
```

## Account

| Entity | Key fields |
| --- | --- |
| `profiles` | `user_id` (PK), display_name, avatar_path, birth_date, sex, height_cm, locale (`de`/`en`), time_zone, role (`user`/`admin`), onboarding_completed_at |
| `user_settings` | theme, week_start, notification prefs, health_sync settings |
| `ai_consents` | user_id, consent_version, granted_at, revoked_at |
| `entitlements` | user_id, tier (`free`/`premium`), source (`manual`/`app_store`/`web`), valid_until |
| `ai_usage` | user_id, feature, model, input/output tokens, cost_estimate, created_at |
| `data_exports` | user_id, status, storage_path, expires_at |

## Endurance

| Entity | Key fields |
| --- | --- |
| `activities` | sport (`run`/`ride`/`hike`/`swim_pool`/`swim_open_water`), sub_type (indoor/trail/…), started_at, time_zone, duration_s, moving_time_s, distance_m, elevation_gain_m, avg/max HR, avg pace/speed, avg cadence, energy_kcal, rpe, title, description, private_notes, source (`healthkit`/`fit`/`gpx`/`tcx`/`manual`), external_id, device, visibility (`private`/`link`) |
| `activity_laps` | index, kind (`auto_km`/`device_lap`/`pool_length`), start offset, duration, distance, avg HR, avg pace |
| `activity_streams` | activity_id, compressed columns (time, lat, lng, altitude, HR, cadence, speed, power), downsampled preview (for charts and maps), `route_polyline` (encoded) |
| `activity_files` | original upload (Storage path), parse status |
| `share_links` | target type/id, token, created_at, revoked_at |

Streams are stored as compressed arrays (e.g. `bytea` with columnar delta encoding, or Storage objects with a pointer) to keep row counts small. This is decided in ADR during Phase 1.

## Strength

| Entity | Key fields |
| --- | --- |
| `exercises` | owner_user_id (null = global), slug, equipment, primary/secondary muscles, mechanic, force, type (`weight_reps`/`bodyweight_reps`/`weighted_bodyweight`/`assisted_bodyweight`/`duration`/`distance_duration`), source + source_id |
| `exercise_translations` | exercise_id, locale, name, aliases[], instructions |
| `routine_folders` | name, sort_order |
| `routines` | folder_id, name, notes, sort_order |
| `routine_exercises` | routine_id, exercise_id, sort_order, superset_group, rest_s, notes, target_sets (JSON: type, reps range, weight, RPE) |
| `workouts` | routine_id?, title, started_at, ended_at, time_zone, notes, source (`ios`/`watch`/`web`), healthkit_workout_id, avg/max HR, energy_kcal, rpe |
| `workout_exercises` | workout_id, exercise_id, sort_order, superset_group, notes |
| `workout_sets` | workout_exercise_id, index, kind (`normal`/`warmup`/`drop`/`failure`), weight_kg, reps, duration_s, distance_m, rpe, rir, completed_at |
| `personal_records` | (derived) exercise_id, kind (`max_weight`/`est_1rm`/`max_volume_set`/`max_reps`), value, workout_set_id, achieved_at |

## Nutrition

| Entity | Key fields |
| --- | --- |
| `foods` | source (`bls`/`off`/`custom`/`ai_estimate`), source_id, barcode(s), owner_user_id (custom), brand, nutrients per 100 g/ml (kcal, protein, carbs, sugar, fat, sat. fat, fiber, salt + JSON for the rest), basis (`g`/`ml`), density, quality score, last_synced_at |
| `food_translations` | food_id, locale, name, aliases[] (search vectors) |
| `food_servings` | food_id, label (translated key or text), grams |
| `recipes`, `recipe_ingredients` | private recipes, portions, computed nutrients |
| `diary_entries` | date (local), meal (`breakfast`/`lunch`/`dinner`/`snack`), food_id or recipe_id or quick-add, amount_g, serving_id, multiplier, computed nutrient snapshot, source (`manual`/`barcode`/`ai_photo`/`ai_text`), ai_recognition_id, healthkit_sample_ids |
| `water_entries` | date, amount_ml |
| `favourite_foods` | user_id, food_id |
| `nutrition_goals` | goal type (`lose`/`maintain`/`gain`), pace kg/week, activity level, macro split, dynamic mode (`off`/`partial`/`full`) + training-energy factor |
| `daily_targets` | (derived per day) base kcal, training kcal added, macro targets |
| `ai_recognitions` | input (photo path, text), model output (items, questions), answers, final items, status |

Diary entries store a **nutrient snapshot**, so later changes to food data don't rewrite history.

## Body

| Entity | Key fields |
| --- | --- |
| `body_metrics` | kind (`weight`/`body_fat`/`waist`/…), value, measured_at, source (`manual`/`healthkit`), external_id |

## Plans & coach

| Entity | Key fields |
| --- | --- |
| `training_plans` | goal (text + structured: type, target event/date, target metric), status, start/end date, generated_by (model, prompt version) |
| `planned_sessions` | plan_id, date, kind (`endurance`/`strength`/`rest`), sport, structure (JSON: warm-up, intervals with targets, cool-down) or routine_id, status (`planned`/`done`/`skipped`/`moved`), completed_activity_id / completed_workout_id, workoutkit_scheduled_id |
| `coach_conversations`, `coach_messages` | user-deletable chat history, tool calls logged |

## Sync

| Entity | Key fields |
| --- | --- |
| `sync_mutations` | mutation_id (idempotency), user_id, entity, entity_id, applied_at, result |
| per-user `change_seq` | a sequence column on synced tables + `sync_tombstones` |
