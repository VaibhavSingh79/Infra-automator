"""Server-side proxy for GitHub Actions run status.

The browser never sends a PAT here — this reads the token from Secrets Manager
(config.get_github_pat) and the repo from SSM (config.get_target_repo), exactly
like the other server-side GitHub calls. That's what lets the pipeline-status
view scale to many users and survive PAT rotation: one token, one place. When
the PAT expires, updating the Secrets Manager secret fixes every user at once.

Register in main.py:
    from api.routers import upload, git_ops, state_ops, github_api, github_status
    app.include_router(github_status.router, prefix="/api/v1/github", tags=["GitHub Status"])
"""
import time
import requests
from fastapi import APIRouter, HTTPException, Query
from core import config

router = APIRouter()

GH_API = "https://api.github.com"
GH_VERSION = "2022-11-28"

# Tiny per-container cache so N pollers watching the same deploy don't each hit
# GitHub. TTL is short so the view still feels live. (Per Lambda container, not
# global — good enough to blunt bursts; a shared cache would need DynamoDB.)
_cache: dict = {}
_CACHE_TTL = 3.0


def _headers(pat: str) -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {pat}",
        "X-GitHub-Api-Version": GH_VERSION,
    }


def _repo_parts():
    repo = config.get_target_repo()  # "owner/name" from SSM
    if "/" not in repo:
        raise HTTPException(status_code=500, detail=f"Malformed target repo in SSM: {repo!r}")
    owner, name = repo.split("/", 1)
    return owner, name


def _get(url: str, pat: str):
    try:
        r = requests.get(url, headers=_headers(pat), timeout=15)
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach GitHub: {e}")
    if r.status_code == 401:
        # The single most useful message we can surface: expired/invalid PAT.
        raise HTTPException(
            status_code=502,
            detail="GitHub rejected the stored token (401). The PAT in Secrets "
                   "Manager may have expired — rotate it with put-secret-value.",
        )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Repo or run not found on GitHub.")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GitHub API error {r.status_code}: {r.text[:200]}")
    return r.json()


def _simplify_run(run: dict) -> dict:
    return {
        "id": run["id"],
        "name": run.get("name"),
        "display_title": run.get("display_title"),
        "status": run.get("status"),          # queued | in_progress | completed
        "conclusion": run.get("conclusion"),  # success | failure | cancelled | null
        "event": run.get("event"),
        "run_number": run.get("run_number"),
        "created_at": run.get("created_at"),
        "updated_at": run.get("updated_at"),
        "html_url": run.get("html_url"),
        "head_sha": (run.get("head_sha") or "")[:7],
    }


def _simplify_job(job: dict) -> dict:
    return {
        "id": job["id"],
        "name": job.get("name"),
        "status": job.get("status"),
        "conclusion": job.get("conclusion"),
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
        "html_url": job.get("html_url"),
        "steps": [
            {
                "name": s.get("name"),
                "status": s.get("status"),
                "conclusion": s.get("conclusion"),
                "number": s.get("number"),
            }
            for s in (job.get("steps") or [])
        ],
    }


@router.get("/runs")
def list_runs(limit: int = Query(5, ge=1, le=20)):
    """Recent workflow runs (summary only) — for a history list."""
    pat = config.get_github_pat()
    owner, name = _repo_parts()
    data = _get(f"{GH_API}/repos/{owner}/{name}/actions/runs?per_page={limit}", pat)
    return {"runs": [_simplify_run(r) for r in data.get("workflow_runs", [])]}


@router.get("/latest-run")
def latest_run(workflow: str = Query(None, description="Optional workflow file name(s), comma-separated, e.g. 'terraform-plan.yml,terraform-apply.yml'. Without it, returns the newest run of ANY workflow.")):
    """Latest run + its jobs/steps for the given workflow(s).

    IMPORTANT: without a workflow filter this returns the newest run across ALL
    workflows — which means a destroy run can show up under the apply view and
    vice-versa. Callers should pass `workflow=` so each pipeline view only ever
    reflects its own workflow. When multiple files are given, we pick whichever
    of them ran most recently.
    """
    cache_key = f"latest:{workflow or '*'}"
    now = time.time()
    cached = _cache.get(cache_key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    pat = config.get_github_pat()
    owner, name = _repo_parts()

    files = [w.strip() for w in workflow.split(",") if w.strip()] if workflow else []
    candidates = []
    if files:
        # Ask GitHub for the latest run of each named workflow file, then keep
        # the most recent across them (created_at is ISO-8601, so string sort works).
        for f in files:
            data = _get(f"{GH_API}/repos/{owner}/{name}/actions/workflows/{f}/runs?per_page=1", pat)
            wr = data.get("workflow_runs", [])
            if wr:
                candidates.append(wr[0])
        candidates.sort(key=lambda r: r.get("created_at", ""), reverse=True)
    else:
        candidates = _get(f"{GH_API}/repos/{owner}/{name}/actions/runs?per_page=1", pat).get("workflow_runs", [])

    if not candidates:
        result = {"run": None, "jobs": []}
        _cache[cache_key] = (now, result)
        return result

    run = candidates[0]
    jobs_data = _get(f"{GH_API}/repos/{owner}/{name}/actions/runs/{run['id']}/jobs", pat)
    result = {"run": _simplify_run(run), "jobs": [_simplify_job(j) for j in jobs_data.get("jobs", [])]}
    _cache[cache_key] = (now, result)
    return result


@router.get("/runs/{run_id}/jobs")
def run_jobs(run_id: int):
    """Jobs + steps for a specific run — for expanding an older run."""
    pat = config.get_github_pat()
    owner, name = _repo_parts()
    jobs_data = _get(f"{GH_API}/repos/{owner}/{name}/actions/runs/{run_id}/jobs", pat)
    return {"jobs": [_simplify_job(j) for j in jobs_data.get("jobs", [])]}