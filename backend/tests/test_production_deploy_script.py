"""deploy/prod/deploy.sh, run for real against stand-ins for `docker` and `curl`.

The stand-ins record every docker call and answer like a healthy (or a deliberately broken)
server, so the script's decisions are tested: backup before migrations, the order of the
steps, automatic rollback to the previous release when the new one is unhealthy, no
rollback when nothing was changed yet, release bookkeeping, and that no secret from
.env.prod ever reaches the output."""

import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SECRET = "Sup3r-Secret-Value-That-Must-Never-Be-Printed-1234567890"
SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("flock") is None, reason="needs bash + flock"
)

FAKE_DOCKER = r"""#!/usr/bin/env bash
# Read-only `docker ps --format` (is our nginx running?) is not recorded: nothing changes.
[[ "$1 $2" == "ps --format" ]] && exit 0
echo "docker IMAGE_TAG=${IMAGE_TAG:-} $*" >>"$FAKE_LOG"
args="$*"
case "$args" in
  *"exec -T postgres sh -c"*) printf 'PGDMP-fake-dump' ;;
  *"exec -T postgres pg_restore --list"*) cat >/dev/null ;;
  *"run --rm --no-deps -T backend python manage.py migrate"*)
      [[ "${FAIL_MIGRATE_TAG:-}" == "$IMAGE_TAG" ]] && { echo "migration error" >&2; exit 1; } ;;
  *"ps --status running --quiet"*) echo "container-id" ;;
  *"run --rm --no-deps -T nginx nginx -t"*)
      if [[ "${FAIL_NGINX_TEST_TAG:-}" == "$IMAGE_TAG" ]]; then
        echo "nginx: [emerg] cannot load certificate" >&2; exit 1
      fi ;;
  *"run --rm --no-deps -T backend python manage.py check --deploy"*)
      echo "System check identified no issues (1 silenced)." ;;
  *"exec -T celery celery -A config inspect ping"*)
      [[ "${FAIL_CELERY_TAG:-}" == "$IMAGE_TAG" ]] && exit 69 ;;
esac
exit 0
"""

# `ss -Hltn "sport = :80"`: a listening socket line only when the test says the port is busy.
FAKE_SS = r"""#!/usr/bin/env bash
if [[ -n "${BUSY_PORT:-}" && "$*" == *":$BUSY_PORT"* ]]; then
  echo "LISTEN 0 511 0.0.0.0:$BUSY_PORT 0.0.0.0:*"
fi
exit 0
"""

FAKE_CURL = r"""#!/usr/bin/env bash
host="" ; url=""
while (($#)); do
  case "$1" in
    --resolve) host="${2%%:*}"; shift 2 ;;
    -o|-w|--max-time) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
path="/${url#https://*/}"
echo "curl IMAGE_TAG=${IMAGE_TAG:-} $host $path" >>"$FAKE_LOG"
if [[ -n "${BAD_TAG:-}" && "$IMAGE_TAG" == "$BAD_TAG" && "$path" == /api/v1/health/ ]]; then
  printf 502; exit 0
fi
if [[ "$host" == www.* ]]; then printf 301
elif [[ "$host" == admin.* && "$path" == / ]]; then printf 401
else printf 200
fi
"""


@pytest.fixture
def server(tmp_path):
    root = tmp_path / "srv-mcq"
    (root / "releases").mkdir(parents=True)
    (root / "nginx").mkdir()
    (root / "certbot-www").mkdir()
    (root / "nginx" / "admin.htpasswd").write_text("owner:$6$x$y\n")
    env = root / ".env.prod"
    # The real template with every placeholder filled (as init-env.sh does).
    env.write_text(
        (REPO / ".env.prod.example")
        .read_text()
        .replace("=change-me/", "=ops-test-path/")
        .replace("=change-me", f"={SECRET}")
    )
    env.chmod(0o600)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("docker", FAKE_DOCKER), ("curl", FAKE_CURL), ("ss", FAKE_SS)):
        path = bin_dir / name
        path.write_text(body)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return {"root": root, "bin": bin_dir, "log": tmp_path / "calls.log"}


def stage(server, sha):
    """What the workflow does: copy this commit's compose file and deploy/ folder."""
    release = server["root"] / "releases" / sha
    release.mkdir()
    shutil.copy(REPO / "docker-compose.prod.yml", release)
    shutil.copy(REPO / ".env.prod.example", release)
    shutil.copytree(REPO / "deploy", release / "deploy")
    (release / ".env.prod").symlink_to(server["root"] / ".env.prod")
    return release


def deploy(server, sha, *, rollback=False, **extra_env):
    script = server["root"] / "releases" / sha / "deploy" / "prod" / "deploy.sh"
    env = {
        "PATH": f"{server['bin']}:{os.environ['PATH']}",
        "MCQ_ROOT": str(server["root"]),
        "FAKE_LOG": str(server["log"]),
        "HEALTH_ATTEMPTS": "2",
        "HEALTH_DELAY": "0",
        **extra_env,
    }
    args = [str(script), *(["--rollback"] if rollback else []), sha]
    return subprocess.run(args, env=env, capture_output=True, text=True, timeout=60, check=False)  # noqa: S603


def calls(server):
    return server["log"].read_text().splitlines() if server["log"].exists() else []


def current(server):
    link = server["root"] / "current"
    return Path(os.readlink(link)).name if link.is_symlink() else None


def test_first_deploy_backs_up_migrates_starts_and_verifies(server):
    stage(server, SHA_A)
    result = deploy(server, SHA_A)
    assert result.returncode == 0, result.stdout + result.stderr
    assert current(server) == SHA_A
    log = calls(server)
    order = [
        next(i for i, c in enumerate(log) if " pull --quiet" in c),
        next(i for i, c in enumerate(log) if "manage.py check --deploy" in c),
        next(i for i, c in enumerate(log) if "nginx nginx -t" in c),
        next(i for i, c in enumerate(log) if "pg_dump" in c),
        next(i for i, c in enumerate(log) if "manage.py migrate" in c),
        next(i for i, c in enumerate(log) if "collectstatic" in c),
        next(i for i, c in enumerate(log) if "up -d --wait --wait-timeout 300" in c),
        next(i for i, c in enumerate(log) if c.startswith("curl")),
    ]
    assert order == sorted(order), (
        "pull → check config → backup → migrate → static → start → verify"
    )
    assert any("celery -A config inspect ping" in c for c in log)
    assert all(
        f"IMAGE_TAG={SHA_A}" in c for c in log if c.startswith("docker") and "prune" not in c
    )
    assert all("--project-name mcq-prod" in c for c in log if " compose " in c)
    backups = list((server["root"] / "backups").glob("pre-deploy-*-aaaaaaaaaaaa.dump"))
    assert len(backups) == 1 and backups[0].read_text() == "PGDMP-fake-dump"
    assert oct(backups[0].stat().st_mode & 0o777) == "0o600"
    assert f"deploy {SHA_A} ok" in (server["root"] / "deploy-history.log").read_text()
    # Nothing destructive, ever.
    joined = "\n".join(log)
    for forbidden in (" down", "volume rm", "flush", "dropdb", "pg_restore -d", "reset_db", " -v"):
        assert forbidden not in joined, forbidden


def test_second_deploy_records_the_previous_release(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    assert deploy(server, SHA_B).returncode == 0
    assert current(server) == SHA_B
    assert (server["root"] / "previous").read_text().strip() == SHA_A


def test_unhealthy_release_is_rolled_back_automatically(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    server["log"].unlink()
    result = deploy(server, SHA_B, BAD_TAG=SHA_B)
    output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "health check failed: API health" in output
    assert "rolled back to aaaaaaaaaaaa" in output
    assert current(server) == SHA_A  # the failed release never became "current"
    log = calls(server)
    # The rollback started the previous images again, without migrating.
    rollback_calls = [c for c in log if f"IMAGE_TAG={SHA_A}" in c]
    assert any("up -d --wait --wait-timeout 300" in c for c in rollback_calls)
    assert not any("migrate" in c for c in rollback_calls)
    history = (server["root"] / "deploy-history.log").read_text()
    assert f"deploy {SHA_B} FAILED" in history and f"rollback {SHA_A} ok" in history


def test_failed_migration_changes_no_running_service(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    server["log"].unlink()
    result = deploy(server, SHA_B, FAIL_MIGRATE_TAG=SHA_B)
    assert result.returncode != 0
    assert "the live site is untouched" in result.stdout + result.stderr
    assert not any("up -d --wait --wait-timeout 300" in c for c in calls(server))
    assert current(server) == SHA_A


def test_manual_rollback_does_not_migrate_or_back_up(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    assert deploy(server, SHA_B).returncode == 0
    server["log"].unlink()
    result = deploy(server, SHA_A, rollback=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert current(server) == SHA_A
    assert not any("migrate" in c or "pg_dump" in c for c in calls(server))


def test_no_secret_is_ever_printed(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    deploy(server, SHA_A)
    result = deploy(server, SHA_B, BAD_TAG=SHA_B)
    assert SECRET not in result.stdout + result.stderr
    assert SECRET not in "\n".join(calls(server))


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda root: (root / ".env.prod").chmod(0o644), "must be mode 600"),
        (lambda root: (root / "nginx" / "admin.htpasswd").unlink(), "admin.htpasswd is missing"),
        (
            lambda root: (root / ".env.prod").write_text(
                (root / ".env.prod").read_text() + "PAYMENT_PROVIDER=mock\n"
            ),
            "never allowed in production",
        ),
    ],
)
def test_preflight_refuses_unsafe_servers_before_touching_anything(server, change, message):
    stage(server, SHA_A)
    change(server["root"])
    result = deploy(server, SHA_A)
    assert result.returncode != 0 and message in result.stderr
    assert calls(server) == []


@pytest.mark.parametrize("sha", ["main", "abc123", "A" * 40, "a" * 39, f"{'a' * 40};id"])
def test_only_full_commit_shas_are_accepted(server, sha):
    stage(server, SHA_A)
    script = server["root"] / "releases" / SHA_A / "deploy" / "prod" / "deploy.sh"
    result = subprocess.run(  # noqa: S603
        [str(script), sha],
        env={"PATH": os.environ["PATH"], "MCQ_ROOT": str(server["root"])},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0 and "usage" in result.stderr


def test_missing_release_folder_is_refused(server):
    stage(server, SHA_A)
    script = server["root"] / "releases" / SHA_A / "deploy" / "prod" / "deploy.sh"
    result = subprocess.run(  # noqa: S603
        [str(script), SHA_C],
        env={"PATH": os.environ["PATH"], "MCQ_ROOT": str(server["root"])},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0 and "missing or incomplete" in result.stderr


def test_not_ready_server_gets_every_problem_and_its_fix_at_once(server):
    stage(server, SHA_A)
    (server["root"] / ".env.prod").unlink()
    (server["root"] / "nginx" / "admin.htpasswd").unlink()
    result = deploy(server, SHA_A)
    assert result.returncode != 0
    assert "init-env.sh" in result.stderr and "set-admin-password.sh" in result.stderr
    assert "nothing was changed" in result.stderr
    assert calls(server) == []


def run_script(server, sha, name, *args, stdin=None):
    script = server["root"] / "releases" / sha / "deploy" / "prod" / name
    env = {"PATH": f"{server['bin']}:{os.environ['PATH']}", "MCQ_ROOT": str(server["root"])}
    return subprocess.run(  # noqa: S603
        [str(script), *args], env=env, input=stdin, capture_output=True, text=True, check=False
    )


class TestInitEnv:
    def test_creates_a_complete_private_env_file_without_printing_secrets(self, server):
        stage(server, SHA_A)
        (server["root"] / ".env.prod").unlink()
        result = run_script(server, SHA_A, "init-env.sh")
        assert result.returncode == 0, result.stderr
        env_file = server["root"] / ".env.prod"
        assert oct(env_file.stat().st_mode & 0o777) == "0o600"
        values = dict(
            line.split("=", 1)
            for line in env_file.read_text().splitlines()
            if line and not line.startswith("#")
        )
        assert "change-me" not in env_file.read_text()
        secrets_ = [
            values[k] for k in ("DJANGO_SECRET_KEY", "JWT_SIGNING_KEY", "POSTGRES_PASSWORD")
        ]
        assert all(len(v) >= 50 for v in secrets_) and len(set(secrets_)) == 3
        assert re.fullmatch(r"ops-[0-9a-f]{24}/", values["DJANGO_ADMIN_URL"])
        assert values["PAYMENT_PROVIDER"] == "unavailable"
        assert values["SITE_HOST"] == "livemodeltest.com"
        for value in [*secrets_, values["DJANGO_ADMIN_URL"]]:
            assert value not in result.stdout + result.stderr

    def test_the_generated_file_passes_the_deploy_preflight(self, server):
        stage(server, SHA_A)
        (server["root"] / ".env.prod").unlink()
        assert run_script(server, SHA_A, "init-env.sh").returncode == 0
        assert deploy(server, SHA_A).returncode == 0

    def test_never_overwrites_an_existing_env_file(self, server):
        stage(server, SHA_A)
        before = (server["root"] / ".env.prod").read_text()
        result = run_script(server, SHA_A, "init-env.sh")
        assert result.returncode != 0 and "already exists" in result.stderr
        assert (server["root"] / ".env.prod").read_text() == before


class TestSetAdminPassword:
    def _run_in_terminal(self, server, sha, answers, *args):
        """Run the script attached to a pseudo-terminal and type the answers."""
        import pty
        import select

        script = server["root"] / "releases" / sha / "deploy" / "prod" / "set-admin-password.sh"
        env = {"PATH": f"{server['bin']}:{os.environ['PATH']}", "MCQ_ROOT": str(server["root"])}
        pid, fd = pty.fork()
        if pid == 0:  # child
            os.execve(str(script), [str(script), *args], env)  # noqa: S606
        output = b""
        pending = list(answers)
        while True:
            ready, _, _ = select.select([fd], [], [], 10)
            if not ready:
                break
            try:
                chunk = os.read(fd, 1024)
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            if pending and b"(hidden): " in chunk:
                os.write(fd, pending.pop(0).encode() + b"\n")
        _, status = os.waitpid(pid, 0)
        return os.waitstatus_to_exitcode(status), output.decode(errors="replace")

    def test_hidden_prompt_writes_only_a_hash(self, server):
        stage(server, SHA_A)
        password = "Basic-Auth-Test-Passphrase-1"
        code, output = self._run_in_terminal(server, SHA_A, [password, password], "owner")
        assert code == 0, output
        assert password not in output  # never echoed
        line = (server["root"] / "nginx" / "admin.htpasswd").read_text().strip()
        assert line.startswith("owner:$6$") and password not in line
        salt = line.split("$")[2]
        expected = subprocess.run(  # noqa: S603
            ["openssl", "passwd", "-6", "-salt", salt, "-stdin"],  # noqa: S607
            input=password,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert line == f"owner:{expected}"

    def test_mismatch_changes_nothing(self, server):
        stage(server, SHA_A)
        before = (server["root"] / "nginx" / "admin.htpasswd").read_text()
        code, output = self._run_in_terminal(
            server, SHA_A, ["Basic-Auth-Test-Passphrase-1", "something-else-entirely"]
        )
        assert code != 0 and "do not match" in output
        assert (server["root"] / "nginx" / "admin.htpasswd").read_text() == before

    def test_refuses_without_a_terminal(self, server):
        stage(server, SHA_A)
        result = run_script(server, SHA_A, "set-admin-password.sh", stdin="x\nx\n")
        assert result.returncode != 0 and "terminal" in result.stderr


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (
            lambda text: text.replace("\nJWT_SIGNING_KEY=", "\n#JWT_SIGNING_KEY="),
            "JWT_SIGNING_KEY is missing",
        ),
        (
            lambda text: text.replace("\nSITE_HOST=livemodeltest.com", "\nSITE_HOST="),
            "SITE_HOST is missing",
        ),
        (
            lambda text: text.replace("DJANGO_DEBUG=false", "DJANGO_DEBUG=true"),
            "DJANGO_DEBUG must be false",
        ),
    ],
)
def test_required_settings_are_validated_before_anything_runs(server, edit, message):
    stage(server, SHA_A)
    env_file = server["root"] / ".env.prod"
    env_file.write_text(edit(env_file.read_text()))
    result = deploy(server, SHA_A)
    assert result.returncode != 0 and message in result.stderr
    assert SECRET not in result.stdout + result.stderr
    assert calls(server) == []


def test_a_port_used_by_another_project_is_reported(server):
    stage(server, SHA_A)
    result = deploy(server, SHA_A, BUSY_PORT="443")
    assert result.returncode != 0 and "port 443 is already used" in result.stderr
    assert not any(" up " in c or "pull" in c for c in calls(server))


def test_invalid_server_configuration_changes_nothing(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    server["log"].unlink()
    result = deploy(server, SHA_B, FAIL_NGINX_TEST_TAG=SHA_B)
    assert result.returncode != 0
    assert "the live site is untouched" in result.stdout + result.stderr
    log = calls(server)
    assert not any(
        "pg_dump" in c or "migrate" in c or "up -d --wait --wait-timeout 300" in c for c in log
    )
    assert current(server) == SHA_A


def test_celery_not_answering_triggers_rollback(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    assert deploy(server, SHA_A).returncode == 0
    result = deploy(server, SHA_B, FAIL_CELERY_TAG=SHA_B)
    output = result.stdout + result.stderr
    assert result.returncode != 0 and "Celery worker does not answer" in output
    assert "rolled back to aaaaaaaaaaaa" in output
    assert current(server) == SHA_A


def test_rollback_never_removes_volumes(server):
    stage(server, SHA_A)
    stage(server, SHA_B)
    deploy(server, SHA_A)
    deploy(server, SHA_B, BAD_TAG=SHA_B)  # automatic rollback
    deploy(server, SHA_A, rollback=True)  # manual rollback
    joined = "\n".join(calls(server))
    for forbidden in (" down", "volume rm", "volume prune", "system prune", " rm -v", " -v "):
        assert forbidden not in joined, forbidden


# ======================================================================================
# stage-release.sh: atomic, idempotent staging that never touches a release in use
# ======================================================================================
def stage_with_script(server, sha, source=REPO):
    script = REPO / "deploy" / "prod" / "stage-release.sh"
    env = {"PATH": f"{server['bin']}:{os.environ['PATH']}", "MCQ_ROOT": str(server["root"])}
    return subprocess.run(  # noqa: S603
        ["bash", str(script), sha, str(source)],  # noqa: S607
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def fingerprint(path):
    """Identity and content of a release folder: same inode + same files = untouched."""
    files = sorted(
        (str(p.relative_to(path)), p.read_bytes(), p.stat().st_mtime_ns)
        for p in path.rglob("*")
        if p.is_file()
    )
    return path.stat().st_ino, files


def releases(server):
    return sorted(p.name for p in (server["root"] / "releases").iterdir())


class TestStageRelease:
    def test_stages_a_complete_release_atomically(self, server):
        result = stage_with_script(server, SHA_A)
        assert result.returncode == 0, result.stderr
        release = server["root"] / "releases" / SHA_A
        for item in ("docker-compose.prod.yml", ".env.prod.example", "deploy/prod/deploy.sh"):
            assert (release / item).exists(), item
        assert os.access(release / "deploy" / "prod" / "deploy.sh", os.X_OK)
        assert releases(server) == [SHA_A]  # no staging leftovers

    def test_links_the_server_settings_file_next_to_the_compose_file(self, server):
        # docker-compose.prod.yml has `env_file: .env.prod` (relative to its own folder).
        assert stage_with_script(server, SHA_A).returncode == 0
        link = server["root"] / "releases" / SHA_A / ".env.prod"
        assert link.is_symlink()
        assert os.readlink(link) == str(server["root"] / ".env.prod")  # a link, never a copy
        assert deploy(server, SHA_A).returncode == 0

    def test_deploy_refuses_a_release_without_the_settings_link(self, server):
        assert stage_with_script(server, SHA_A).returncode == 0
        (server["root"] / "releases" / SHA_A / ".env.prod").unlink()
        result = deploy(server, SHA_A)
        assert result.returncode != 0
        assert "must be a link to" in result.stderr and "nothing was changed" in result.stderr
        assert current(server) is None

    def test_redeploying_the_live_sha_never_deletes_or_rewrites_it(self, server):
        assert stage_with_script(server, SHA_A).returncode == 0
        assert deploy(server, SHA_A).returncode == 0
        live = server["root"] / "releases" / SHA_A
        assert current(server) == SHA_A
        before = fingerprint(live)

        # The workflow is re-run for the same commit: stage again, deploy again.
        result = stage_with_script(server, SHA_A)
        assert result.returncode == 0, result.stderr
        assert "reused, nothing changed" in result.stdout
        assert fingerprint(live) == before  # same folder (inode), same files, same times
        assert deploy(server, SHA_A).returncode == 0
        assert current(server) == SHA_A
        assert fingerprint(live) == before
        assert releases(server) == [SHA_A]

    def test_redeploy_of_the_live_sha_keeps_the_rollback_target(self, server):
        for sha in (SHA_A, SHA_B):
            assert stage_with_script(server, sha).returncode == 0
            assert deploy(server, sha).returncode == 0
        previous_file = server["root"] / "previous"
        assert previous_file.read_text().strip() == SHA_A
        rollback_target = fingerprint(server["root"] / "releases" / SHA_A)

        assert stage_with_script(server, SHA_B).returncode == 0
        assert deploy(server, SHA_B).returncode == 0
        assert current(server) == SHA_B
        assert previous_file.read_text().strip() == SHA_A  # not overwritten with B
        assert fingerprint(server["root"] / "releases" / SHA_A) == rollback_target
        # …and the rollback still works afterwards.
        assert deploy(server, SHA_A, rollback=True).returncode == 0
        assert current(server) == SHA_A

    def test_rerunning_after_an_unhealthy_redeploy_keeps_the_live_release(self, server):
        assert stage_with_script(server, SHA_A).returncode == 0
        assert deploy(server, SHA_A).returncode == 0
        live = server["root"] / "releases" / SHA_A
        before = fingerprint(live)
        assert stage_with_script(server, SHA_A).returncode == 0
        result = deploy(server, SHA_A, BAD_TAG=SHA_A)
        assert result.returncode != 0
        assert current(server) == SHA_A and fingerprint(live) == before

    @pytest.mark.parametrize("role", ["live", "rollback target", "unused"])
    def test_a_modified_existing_release_is_refused_never_replaced(self, server, role):
        for sha in (SHA_A, SHA_B):
            assert stage_with_script(server, sha).returncode == 0
            assert deploy(server, sha).returncode == 0
        sha = {"live": SHA_B, "rollback target": SHA_A, "unused": SHA_C}[role]
        if role == "unused":
            assert stage_with_script(server, SHA_C).returncode == 0
        release = server["root"] / "releases" / sha
        (release / "deploy" / "nginx" / "prod-site.conf").write_text("# edited on the server\n")
        before = fingerprint(release)
        result = stage_with_script(server, sha)
        assert result.returncode != 0
        assert "DIFFERENT files" in result.stderr and "Nothing was changed" in result.stderr
        if role != "unused":
            assert f"it is the {role} release" in result.stderr
        assert fingerprint(release) == before
        assert not [n for n in releases(server) if n.startswith(".staging")]

    def test_leftovers_of_an_interrupted_staging_are_cleaned(self, server):
        leftover = server["root"] / "releases" / f".staging-{SHA_A}.abc123"
        leftover.mkdir()
        (leftover / "docker-compose.prod.yml").write_text("half-copied")
        assert stage_with_script(server, SHA_A).returncode == 0
        assert releases(server) == [SHA_A]

    def test_incomplete_checkout_creates_nothing(self, server, tmp_path):
        source = tmp_path / "checkout"
        source.mkdir()
        shutil.copy(REPO / "docker-compose.prod.yml", source)
        result = stage_with_script(server, SHA_A, source)
        assert result.returncode != 0 and "checkout is incomplete" in result.stderr
        assert releases(server) == []

    @pytest.mark.parametrize("sha", ["main", "a" * 39, f"{'a' * 40}/../x", "../../etc"])
    def test_only_full_commit_shas(self, server, sha):
        result = stage_with_script(server, sha)
        assert result.returncode != 0 and "usage" in result.stderr
        assert releases(server) == []


def test_pruning_never_removes_the_live_or_rollback_release(server):
    for sha in (SHA_A, SHA_B):
        assert stage_with_script(server, sha).returncode == 0
        assert deploy(server, sha).returncode == 0
    # A and B are now the OLDEST folders; six newer releases exist.
    os.utime(server["root"] / "releases" / SHA_A, (1, 1))
    os.utime(server["root"] / "releases" / SHA_B, (2, 2))
    newer = [f"{n:x}" * 40 for n in range(3, 9)]
    for sha in newer:
        stage(server, sha[:40])
    hidden = server["root"] / "releases" / f".staging-{SHA_C}.keep"
    hidden.mkdir()
    assert deploy(server, SHA_B).returncode == 0  # redeploy of the live SHA prunes
    kept = set(releases(server))
    assert {SHA_A, SHA_B} <= kept  # rollback target and live release survive
    assert len([n for n in kept if not n.startswith(".")]) == 7  # 5 newest + live + previous
    assert hidden.name in kept  # hidden staging folders are never pruned by deploy.sh
