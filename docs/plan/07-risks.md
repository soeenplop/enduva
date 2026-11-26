# 07 — Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | **TypeScript 7 tooling gaps.** No JS compiler API in TS 7.0, so decorator metadata emit, `svelte-check` and typescript-eslint may not work | High | High | Spike 0.3 before any feature work: SWC for NestJS emit, `tsgo` for type-checking, oxlint instead of typescript-eslint. If a blocker remains, the owner decides (no silent TS 6 fallback) |
| R2 | **App Store rejection** for Google login without Sign in with Apple (Guideline 4.8) | High (for App Store / external TestFlight) | Medium | Decide O2 early. Supabase supports Apple login, so adding it is cheap |
| R3 | **HealthKit limitations**: data only on device, background delivery is throttled, route/stream data is heavy | Medium | Medium | Anchored queries + background delivery + catch-up on app launch. Compressed stream upload. Resumable sync |
| R4 | **AI nutrition accuracy** (portion sizes from photos are hard) | High | Medium | Clarifying questions, editable gram amounts, matching to real DB entries, "AI estimate" badge, nothing logged without confirmation, fixture set to track quality over time |
| R5 | **AI cost & abuse** with open registration | Medium | Medium | Consent + per-user quotas + global kill switch, Turnstile at sign-up, email confirmation, `ai_usage` monitoring |
| R6 | **GDPR / health data** (Art. 9) | Medium | High | Explicit consent, EU hosting, data minimisation for AI, export + deletion from Phase 0, privacy policy before opening to others, "not medical advice" disclaimer |
| R7 | **Food data licences & quality** (OFF ODbL share-alike, OFF data gaps, BLS terms) | Medium | Medium | Attribution in UI + landing. Keep OFF-derived data separate (source column). Quality score. Document BLS terms in the importer PR |
| R8 | **Supabase free-tier limits** (500 MB, pausing, no backups) | Medium | Medium | Store streams compactly, import only a DACH OFF subset, upgrade prod (O4), own nightly dumps |
| R9 | **Sync conflicts / data loss** between Watch, iPhone and server | Medium | High | Client UUIDs, idempotent mutations, outbox, LWW with versions, extensive tests for the sync engine, never hard-delete synced data client-side |
| R10 | **Agent workflow overhead** (review loops, merge conflicts between parallel PRs) | Medium | Low | Small PRs, max 3 parallel implementers, serialise migrations/contracts, arbiter rule after 2 rounds |
| R11 | **Single GitHub identity** for all agents (authorship unclear, no formal approvals) | Certain | Low | `[Sol]`/`[Claude]` prefixes and verdict lines. Optional bot account / GitHub App later |
| R12 | **Commit signing blocks unattended agents** (1Password agent locked) | Medium | Low | Keep 1Password unlocked during agent sessions. Agents report signing failures instead of disabling signing |
| R13 | **Public repo leaks** (secrets, personal data in fixtures) | Low | High | Gitleaks, `.env` ignored, synthetic fixtures only (no real health data of the owner in the repo) |
| R14 | **Scope creep** (three apps in one) | High | High | Strict phase exit criteria. Backlog for everything "later". Owner approves scope changes via PRs to this plan |
