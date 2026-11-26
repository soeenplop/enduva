# Enduva — Project Plan

Enduva combines three kinds of apps in one product:

| Pillar | Inspired by | In one sentence |
| --- | --- | --- |
| **Endurance** | Strava, Endurain | Collect and analyse running, cycling, hiking and swimming activities. |
| **Strength** | Hevy | Plan and log strength workouts set by set, including on Apple Watch. |
| **Nutrition** | Yazio | Track calories and macros using European food data, with AI assistance. |

An AI layer (training analysis, plan generation, meal recognition and a coach) ties the three together. Enduva runs as a native iPhone + Apple Watch app, a web app and a public landing page.

## Documents

| # | Document | Contents |
| --- | --- | --- |
| 00 | [Decisions](00-decisions.md) | Every product and technical decision made so far, plus open questions |
| 01 | [Product scope](01-product-scope.md) | Personas, feature scope per pillar, what is out of scope |
| 02 | [Architecture](02-architecture.md) | System overview, tech stack, repo layout, auth, sync, AI, i18n |
| 03 | [Domain model](03-domain-model.md) | Core entities and their relationships |
| 04 | [Roadmap](04-roadmap.md) | Phases, milestones and PR-sized tasks |
| 05 | [Workflow](05-workflow.md) | Branching, worktrees, commits, agents, PR review, merging, releases |
| 06 | [Deployment](06-deployment.md) | Environments, Docker Compose, Dokploy, Supabase Cloud, secrets |
| 07 | [Risks](07-risks.md) | Known risks and how we reduce them |

## Guiding principles

1. **Small steps.** Each PR covers one coherent task that can be reviewed in about 15 minutes.
2. **Vertical slices.** Each phase ships something usable end to end (DB → API → web/iOS) instead of building every layer in turn.
3. **API first.** The NestJS API is the single source of business logic. Web, iOS and watchOS are clients of the same contract.
4. **Privacy by design.** Health data is GDPR Art. 9 data. AI processing needs explicit consent, and users can export and delete their data.
5. **Metric only, bilingual from day one.** Every user-facing string goes through i18n (German and English).
6. **English everywhere in the repo.** Code, docs, commits, PRs and issues are written in English.
