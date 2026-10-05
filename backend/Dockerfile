# Backend image for local development (Milestone 1).
# A production image (gunicorn, collectstatic) will be added with deployment work.
FROM python:3.12-slim

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

# Which requirements file to install:
#   requirements/dev.txt  (default) → runtime + pytest, pytest-django, ruff for local development
#   requirements/base.txt           → runtime only, for a future production image:
#       docker build --build-arg REQUIREMENTS=requirements/base.txt ./backend
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
