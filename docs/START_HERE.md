# Start Here

This repository is intentionally at the planning stage.

## First Claude Code Task
Before writing application code, Claude Code should:

1. Read `CLAUDE.md`.
2. Read all files under `docs/requirements/`.
3. Analyze the requirements only.
4. Create the planning documents below:
   - `docs/ARCHITECTURE.md`
   - `docs/DATABASE_DESIGN.md`
   - `docs/API_PLAN.md`
   - `docs/SECURITY_PLAN.md`
   - `docs/MODULES.md`
   - `docs/ROADMAP.md`
5. Do not install packages.
6. Do not initialize Django, Next.js or Expo yet.
7. Do not commit, push or deploy unless explicitly asked.

## Suggested First Prompt

```text
Read CLAUDE.md carefully and inspect all requirement files under docs/requirements/.

Do not write application code yet.

First analyze the approved requirements and create:
- docs/ARCHITECTURE.md
- docs/DATABASE_DESIGN.md
- docs/API_PLAN.md
- docs/SECURITY_PLAN.md
- docs/MODULES.md
- docs/ROADMAP.md

Use this preferred stack:
Backend: Django + Django REST Framework + PostgreSQL + Redis + Celery
Web: Next.js + TypeScript + Tailwind CSS
Mobile: React Native + Expo + TypeScript
Infrastructure: Docker Compose + GitHub

Use a modular monolith architecture with one centralized backend/API and one centralized PostgreSQL database.

Do not install packages.
Do not initialize Django/Next.js/Expo.
Do not modify requirement files.
Do not commit, push or deploy.

At the end show:
1. architecture summary
2. database entities and relationships
3. module dependency order
4. security risks and controls
5. recommended next implementation step
6. anything unclear or conflicting in the requirement scope

Explain everything simply because I am learning while building this project.
```
