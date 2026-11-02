# Backend images (one Dockerfile, two targets):
#   development (default — `docker compose` locally): dev requirements, runserver, source mounted
#   production  (`--target production` — docker-compose.staging.yml): runtime requirements only,
#               gunicorn, code baked in, no source mount
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# gettext: compiles Bangla/English translation files (makemessages / compilemessages).
RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user.
RUN useradd --create-home --uid 1000 app


# --- production --------------------------------------------------------------------------
FROM base AS production

# Pinned runtime requirements only (no test tools).
COPY requirements/ requirements/
RUN pip install -r requirements/base.txt

COPY --chown=app:app . .
# Mount points for the shared static/media volumes, owned by the app user so a fresh
# named volume inherits the ownership.
RUN mkdir -p /app/staticfiles /app/media && chown app:app /app/staticfiles /app/media
USER app

# Compile Bangla/English translations (.po → .mo). The .mo files are generated, not committed.
RUN python manage.py compilemessages --verbosity 0

# Production settings by default in this image (refuse placeholder secrets and DEBUG);
# set after compilemessages, which runs at build time without any secrets.
ENV DJANGO_SETTINGS_MODULE=config.settings.prod

EXPOSE 8000

# Secrets and settings come from the environment at run time (never baked in).
CMD ["gunicorn", "config.wsgi:application", "--config", "gunicorn.conf.py"]


# --- development (default target) ----------------------------------------------------------
FROM base AS development

# Which requirements file to install:
#   requirements/dev.txt  (default) → runtime + pytest, pytest-django, ruff for local development
#   requirements/base.txt           → runtime only
ARG REQUIREMENTS=requirements/dev.txt
COPY requirements/ requirements/
RUN pip install -r ${REQUIREMENTS}

COPY --chown=app:app . .
USER app

# Compile Bangla/English translations (.po → .mo). The .mo files are generated, not committed.
RUN python manage.py compilemessages --verbosity 0

EXPOSE 8000

# Migrations are run explicitly (see README: `docker compose exec backend python manage.py migrate`).
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
