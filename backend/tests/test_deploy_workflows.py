"""The GitHub Actions deployment workflows keep their safety properties: only main deploys,
only after the full CI, images tagged by commit SHA, one deployment at a time, the
self-hosted production runner is reachable only from those deployment jobs (never from a
pull request), and no long-lived credential is used or printed."""

import re
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
DEPLOY = "deploy-production.yml"
ROLLBACK = "rollback-production.yml"
PRODUCTION_RUNNER = ["self-hosted", "linux", "mcq-production"]


def load(name):
    data = yaml.safe_load((WORKFLOWS / name).read_text())
    data["on"] = data.pop(True, data.get("on"))  # YAML 1.1 reads the key `on` as True
    return data


def all_workflows():
    return sorted(p.name for p in WORKFLOWS.glob("*.yml"))


def test_every_workflow_is_valid_yaml():
    for name in all_workflows():
        data = load(name)
        assert data["name"] and data["jobs"], name


def test_only_main_deploys():
    triggers = load(DEPLOY)["on"]
    assert set(triggers) == {"push", "workflow_dispatch"}
    assert triggers["push"] == {"branches": ["main"]}
    jobs = load(DEPLOY)["jobs"]
    for name in ("backend-ci", "admin-ci", "web-ci"):
        assert jobs[name]["if"] == "github.ref == 'refs/heads/main'"
    guard = (
        "github.ref == 'refs/heads/main' && github.event_name != 'pull_request' "
        "&& github.repository == 'shafikcmt/online-mcq-platform'"
    )
    assert jobs["build"]["if"] == guard and jobs["deploy"]["if"] == guard
    assert load(ROLLBACK)["jobs"]["rollback"]["if"] == guard
    assert set(load(ROLLBACK)["on"]) == {"workflow_dispatch"}


def test_ci_workflows_stay_ci_only_and_are_the_deploy_gate():
    for name in ("backend-ci.yml", "admin-ci.yml", "web-ci.yml"):
        data = load(name)
        assert "workflow_call" in data["on"], name
        assert data["on"]["push"]["branches"] == ["develop", "main"], name
        text = (WORKFLOWS / name).read_text()
        assert "self-hosted" not in text and "packages: write" not in text, name
    jobs = load(DEPLOY)["jobs"]
    assert jobs["backend-ci"]["uses"] == "./.github/workflows/backend-ci.yml"
    assert jobs["admin-ci"]["uses"] == "./.github/workflows/admin-ci.yml"
    assert jobs["web-ci"]["uses"] == "./.github/workflows/web-ci.yml"
    assert sorted(jobs["build"]["needs"]) == ["admin-ci", "backend-ci", "web-ci"]
    assert jobs["deploy"]["needs"] == "build"


def test_images_are_built_on_github_and_tagged_by_commit():
    build = load(DEPLOY)["jobs"]["build"]
    assert build["runs-on"] == "ubuntu-latest"
    images = {row["image"]: row for row in build["strategy"]["matrix"]["include"]}
    assert set(images) == {"backend", "admin", "website"}
    assert images["backend"]["target"] == "production"
    assert "SITE_URL=https://livemodeltest.com" in images["website"]["build-args"]
    assert "SITE_NOINDEX=" not in (WORKFLOWS / DEPLOY).read_text()
    push = next(s for s in build["steps"] if str(s.get("uses", "")).startswith("docker/build-push"))
    assert push["with"]["tags"] == "${{ env.IMAGE_PREFIX }}/${{ matrix.image }}:${{ github.sha }}"
    assert ":latest" not in (WORKFLOWS / DEPLOY).read_text()


@pytest.mark.parametrize(("name", "job"), [(DEPLOY, "deploy"), (ROLLBACK, "rollback")])
def test_production_jobs_are_serialized_and_protected(name, job):
    data = load(name)["jobs"][job]
    assert data["runs-on"] == PRODUCTION_RUNNER
    assert data["environment"]["name"] == "production"
    assert data["concurrency"] == {"group": "production-deploy", "cancel-in-progress": False}
    assert data["permissions"] == {"contents": "read", "packages": "read"}
    assert data["timeout-minutes"]


def test_production_runner_is_never_reachable_from_pull_requests():
    for name in all_workflows():
        text = (WORKFLOWS / name).read_text()
        if "self-hosted" in text:
            assert name in {DEPLOY, ROLLBACK}, name
            triggers = load(name)["on"]
            assert not {"pull_request", "pull_request_target", "issue_comment"} & set(triggers)
        for job_name, job in load(name)["jobs"].items():
            if "self-hosted" in str(job.get("runs-on", "")):
                assert job["runs-on"] == PRODUCTION_RUNNER, (name, job_name)


def test_no_long_lived_secrets_and_nothing_secret_is_printed():
    for name in (DEPLOY, ROLLBACK):
        text = (WORKFLOWS / name).read_text()
        # Only the short-lived per-job token; no SSH keys, passwords or app secrets in CI.
        assert set(re.findall(r"secrets\.(\w+)", text)) == {"GITHUB_TOKEN"}, name
        assert "set -x" not in text and "--password-stdin" in text
        assert not re.search(r"echo[^\n]*GHCR_TOKEN", text)
        assert "persist-credentials: false" in text or name == ROLLBACK
        assert 'rm -rf "$RUNNER_TEMP/docker-config"' in text
        assert not re.search(r"\.env\.prod(?!\.example)", text)  # app secrets stay on the server


def test_deploy_runs_the_committed_script_for_the_exact_commit():
    steps = load(DEPLOY)["jobs"]["deploy"]["steps"]
    checkout = steps[0]
    assert checkout["with"]["ref"] == "${{ github.sha }}"
    run = next(s["run"] for s in steps if "deploy.sh" in s.get("run", ""))
    assert run == '"$MCQ_ROOT/releases/$GITHUB_SHA/deploy/prod/deploy.sh" "$GITHUB_SHA"'
    rollback = next(
        s["run"]
        for s in load(ROLLBACK)["jobs"]["rollback"]["steps"]
        if s.get("name", "").startswith("Roll back")
    )
    assert rollback == '"$MCQ_ROOT/releases/$TARGET/deploy/prod/deploy.sh" --rollback "$TARGET"'


def _evaluate(condition, *, ref, event, repository="shafikcmt/online-mcq-platform"):
    """Evaluate one of the workflows' simple `if:` guards (==, !=, &&) for a context."""
    values = {"github.ref": ref, "github.event_name": event, "github.repository": repository}
    clauses = [c.strip() for c in condition.split("&&")]
    result = True
    for clause in clauses:
        left, op, right = re.fullmatch(r"(\S+) (==|!=) '([^']*)'", clause).groups()
        result &= (values[left] == right) if op == "==" else (values[left] != right)
    return result


@pytest.mark.parametrize(
    ("ref", "event", "repository", "deploys"),
    [
        ("refs/heads/main", "push", "shafikcmt/online-mcq-platform", True),  # merge into main
        ("refs/heads/main", "workflow_dispatch", "shafikcmt/online-mcq-platform", True),
        ("refs/heads/develop", "push", "shafikcmt/online-mcq-platform", False),
        ("refs/heads/feature/x", "push", "shafikcmt/online-mcq-platform", False),
        ("refs/heads/feature/x", "workflow_dispatch", "shafikcmt/online-mcq-platform", False),
        ("refs/pull/7/merge", "pull_request", "shafikcmt/online-mcq-platform", False),
        ("refs/heads/main", "pull_request", "shafikcmt/online-mcq-platform", False),
        ("refs/heads/main", "push", "someone/fork", False),
    ],
)
def test_only_main_of_this_repository_reaches_the_production_runner(
    ref, event, repository, deploys
):
    for name, job in ((DEPLOY, "deploy"), (DEPLOY, "build"), (ROLLBACK, "rollback")):
        condition = load(name)["jobs"][job]["if"]
        assert _evaluate(condition, ref=ref, event=event, repository=repository) is deploys, (
            name,
            job,
        )
    # Pushes to other branches do not even start the deployment workflow.
    assert load(DEPLOY)["on"]["push"]["branches"] == ["main"]


def test_staging_never_deletes_a_release_folder():
    steps = load(DEPLOY)["jobs"]["deploy"]["steps"]
    stage = next(s for s in steps if s.get("name") == "Stage release folder")
    assert stage["run"] == 'bash deploy/prod/stage-release.sh "$GITHUB_SHA" "$GITHUB_WORKSPACE"'
    text = (WORKFLOWS / DEPLOY).read_text()
    assert "rm -rf" not in text.split("Log in to GHCR")[0]
    names = [s.get("name", "") for s in steps]
    assert names.index("Stage release folder") < next(
        i for i, s in enumerate(steps) if "deploy.sh" in s.get("run", "")
    )
