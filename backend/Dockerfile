# Backend image for local development (Milestone 1).
# A production image (gunicorn, collectstatic) will be added with deployment work.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

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

EXPOSE 8000

# NOTE: no `migrate` here on purpose — migrations start in Milestone 2 (custom User model).
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
