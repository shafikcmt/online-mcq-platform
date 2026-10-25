"""gunicorn settings for the production image (staging demo first).

Sized for a small VPS (2 vCPU / 4 GB): a few synchronous workers are plenty for an
Admin Panel demo. Tune with environment variables, not by editing this file. TLS,
client IPs and HTTPS detection are handled by nginx + Django settings
(``TRUSTED_PROXY_COUNT``, ``SECURE_PROXY_SSL_HEADER``), not here.
"""

import os

bind = "0.0.0.0:8000"  # reachable only on the internal Docker network (never published)
workers = int(os.environ.get("GUNICORN_WORKERS", "3"))
threads = int(os.environ.get("GUNICORN_THREADS", "1"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "60"))
graceful_timeout = 30
keepalive = 5
# Recycle workers now and then (bounded memory growth on a small server).
max_requests = int(os.environ.get("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 100
worker_tmp_dir = "/dev/shm"  # noqa: S108 — gunicorn heartbeat files on the container tmpfs
accesslog = "-"
errorlog = "-"
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "info")
