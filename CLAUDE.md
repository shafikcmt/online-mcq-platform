# Online MCQ Platform - Claude Code Instructions

## Project Goal
Build a production-oriented Online MCQ Examination Platform.

Main components:
1. Android Mobile App
2. Public Website
3. Admin Panel
4. Secure Backend/API
5. PostgreSQL Database

The approved project scope is stored under `docs/requirements/`.
Always review the requirement files before planning or implementing a feature.

## Product & UI Reference
Reference website for product flow and interaction ideas:
- https://web.livemcq.com/

Use the reference only as inspiration for flow, layout patterns, and usability. Do not copy proprietary code, branding, text, assets, or exact visual identity.

The UI/UX for the Mobile App, Public Website, and Admin Panel should be modern, smart, clean, fast, responsive, and easy to use.
Prefer:
- clear information hierarchy
- uncluttered screens
- modern cards, tables, forms, filters, and dashboards
- consistent spacing and typography
- mobile-first responsive behavior
- accessible color contrast and readable states
- smooth but restrained interactions
- polished loading, empty, success, warning, and error states

Avoid outdated, crowded, or overly decorative UI. Keep the experience suitable for a serious exam platform used by students and administrators.

## Preferred Technology Stack
Backend:
- Python
- Django
- Django REST Framework
- PostgreSQL
- Redis
- Celery

Web:
- Next.js
- TypeScript
- Tailwind CSS

Mobile:
- React Native
- Expo
- TypeScript

Infrastructure:
- Docker Compose
- GitHub

## Architecture Rules
- Use a modular monolith architecture initially.
- Django/DRF is the main backend.
- PostgreSQL is the source of truth.
- Mobile App, Admin Panel and Public Website use the same backend/API and database.
- Important business logic must run on the backend.
- Exam result calculation must run server-side.
- Exam timer validation must run server-side.
- Payment verification must run server-side.
- Correct answers must never be unnecessarily exposed to the mobile app before submission.
- Do not hard-code configurable business rules.
- Keep modules maintainable and loosely coupled.

## Development Workflow
Before implementing anything:
1. Read the relevant requirement and existing code.
2. Explain what you plan to change.
3. Identify files that will change.
4. Identify database changes.
5. Identify security risks.
6. Then implement only the requested scope.

After implementation:
1. Run relevant tests.
2. Run lint/checks.
3. Show changed files.
4. Summarize implementation.
5. Explain what I should learn from the change.

## Git Rules
- Never work directly on `main` for feature development.
- Use `develop` as the integration branch.
- Use one feature branch per feature.
- Do not commit automatically unless explicitly requested.
- Do not push automatically unless explicitly requested.
- Never deploy automatically unless explicitly requested.

## Security Rules
Never commit:
- `.env`
- API keys
- SMS credentials
- payment credentials
- database passwords
- Django `SECRET_KEY`
- private certificates or signing keys

Use environment variables and `.env.example` placeholders.

## Scope Control
- Do not silently add unrelated features.
- If a requested change affects another module, explain the dependency first.
- Do not modify requirement files unless explicitly asked.

## Learning Mode
The project owner is learning while building this system.
For every important implementation explain:
- why it is needed
- how it works
- important files
- database relationships
- API request flow
- security considerations
- how to test it manually
