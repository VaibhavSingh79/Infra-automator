import os
os.environ["GIT_PYTHON_REFRESH"] = "quiet"
os.environ["GIT_PYTHON_GIT_EXECUTABLE"] = "/usr/bin/git"

import re
import shutil
import tempfile
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from models.git_schema import GitCredentials
from utils.git_ops import archive_and_destroy_infra, push_generated_code_to_git
from utils.github_api import trigger_terraform_destroy, set_repo_variable
from utils import job_store
from github import Github
from github.GithubException import UnknownObjectException

from core import config

router = APIRouter()


class CrossAccountSetupRequest(BaseModel):
    account_id: str
    repo_url: str
    pat_token: str
    cross_account_role_arn: str | None = None


class PushRequest(BaseModel):
    job_id: str          # token from the generate step
    creds: GitCredentials


# Updated GitOps workflows: role ARN + region come from repo Actions variables,
# owner-scoped trust, concurrency, current action versions. Nothing account-
# specific baked in.
_WORKFLOWS = {
    ".github/workflows/terraform-plan.yml": """name: 1. Terraform Plan (Auto)
on:
  push:
    branches: [main]
permissions:
  id-token: write
  contents: read
concurrency:
  group: terraform-${{ github.repository }}
  cancel-in-progress: false
jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform Init
        working-directory: ./infrastructure
        run: |
          for i in 1 2 3; do
            terraform init && break
            if [ "$i" = "3" ]; then echo "terraform init failed after 3 attempts" >&2; exit 1; fi
            sleep 10
          done
      - name: Terraform Plan
        working-directory: ./infrastructure
        run: terraform plan
""",
    ".github/workflows/terraform-apply.yml": """name: 2. Terraform Apply (UI Triggered)
on: workflow_dispatch
permissions:
  id-token: write
  contents: read
concurrency:
  group: terraform-${{ github.repository }}
  cancel-in-progress: false
jobs:
  apply:
    name: Terraform Apply
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform Init
        working-directory: ./infrastructure
        run: |
          for i in 1 2 3; do
            terraform init && break
            if [ "$i" = "3" ]; then echo "terraform init failed after 3 attempts" >&2; exit 1; fi
            sleep 10
          done
      - name: Terraform Apply
        working-directory: ./infrastructure
        run: terraform apply -auto-approve
""",
    ".github/workflows/terraform-destroy.yml": """name: 3. Terraform Destroy (UI Triggered)
on: workflow_dispatch
permissions:
  id-token: write
  contents: read
concurrency:
  group: terraform-${{ github.repository }}
  cancel-in-progress: false
jobs:
  destroy:
    name: Terraform Destroy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform Init
        working-directory: ./infrastructure
        run: |
          for i in 1 2 3; do
            terraform init && break
            if [ "$i" = "3" ]; then echo "terraform init failed after 3 attempts" >&2; exit 1; fi
            sleep 10
          done
      - name: Terraform Destroy
        working-directory: ./infrastructure
        run: terraform destroy -auto-approve
""",
}


@router.post("/git/push")
async def push_to_repository(req: PushRequest):
    # Hydrate this job's files from the durable store (works even though generate
    # ran on a different container), then push. Job left in place for re-push;
    # an S3 lifecycle rule expires it.
    try:
        job = job_store.get_job(req.job_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    temp_dir = tempfile.mkdtemp(prefix="job_")
    try:
        for name, content in job["files"].items():
            with open(os.path.join(temp_dir, name), "w") as f:
                f.write(content)
        return push_generated_code_to_git(req.creds, source_dir=temp_dir)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re_err:
        raise HTTPException(status_code=401, detail=str(re_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@router.post("/destroy")
def trigger_destruction(creds: GitCredentials):
    try:
        return archive_and_destroy_infra(creds)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/git/bootstrap")
def bootstrap_repo(creds: GitCredentials):
    """Inject the GitOps workflows AND set the Actions variables they read."""
    try:
        repo_name = str(creds.repo_url).replace("https://github.com/", "").replace(".git", "").strip("/")
        token_val = creds.pat_token.get_secret_value() if hasattr(creds.pat_token, "get_secret_value") else creds.pat_token

        g = Github(token_val)
        repo = g.get_repo(repo_name)

        injected, updated = [], []
        for file_path, content in _WORKFLOWS.items():
            try:
                existing = repo.get_contents(file_path)
                repo.update_file(file_path, "chore: update GitOps pipeline", content, existing.sha)
                updated.append(file_path)
            except UnknownObjectException:
                repo.create_file(file_path, "chore: auto-inject GitOps pipeline via Orchestrator", content)
                injected.append(file_path)

        set_repo_variable(str(creds.repo_url), token_val, "AWS_ROLE_ARN", config.get_orchestrator_role_arn())
        set_repo_variable(str(creds.repo_url), token_val, "AWS_REGION", config.AWS_REGION)

        msg = "GitOps workflows injected." if injected else "GitOps workflows present and updated."
        return {"status": "success", "message": f"{msg} Actions variables set. Ready to deploy."}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to bootstrap repo: {str(e)}")


@router.post("/git/destroy-trigger")
def trigger_destroy_pipeline(creds: GitCredentials):
    try:
        return trigger_terraform_destroy(str(creds.repo_url), creds.branch_name, creds.pat_token)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/git/setup-cross-account")
def setup_cross_account(payload: CrossAccountSetupRequest):
    """Validate a tenant's account and confirm their deploy role. Does NOT mutate
    any IAM role — the orchestrator role already has a standing grant to assume
    arn:aws:iam::*:role/<DEPLOY_ROLE_NAME>."""
    account_id = payload.account_id.strip()

    if not re.fullmatch(r"\d{12}", account_id):
        raise HTTPException(status_code=400, detail="account_id must be exactly 12 digits.")

    role_arn = config.deploy_role_arn(account_id)

    if payload.cross_account_role_arn:
        supplied = payload.cross_account_role_arn.strip()
        if supplied != role_arn:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Deploy role must be named '{config.DEPLOY_ROLE_NAME}' in account {account_id} "
                    f"(expected {role_arn}). Re-run the setup script - do not rename the role."
                ),
            )

    try:
        set_repo_variable(payload.repo_url, payload.pat_token, "AWS_ROLE_ARN", config.get_orchestrator_role_arn())
        set_repo_variable(payload.repo_url, payload.pat_token, "AWS_REGION", config.AWS_REGION)
    except Exception as e:
        return {
            "status": "warning",
            "message": f"Account validated ({role_arn}) but could not set repo variables: {e}",
            "cross_account_role_arn": role_arn,
        }

    return {
        "status": "success",
        "message": f"Account {account_id} validated. Deploy role confirmed. Ready to generate.",
        "cross_account_role_arn": role_arn,
    }


class BuildStatusRequest(BaseModel):
    repo_url: str
    pat_token: str
    history: int = 3


# @router.post("/git/build-status")
# def build_status(req: BuildStatusRequest):
#     """Read-only view of the repo's GitHub Actions runs (latest run with
#     job+step detail, plus a short history). The frontend polls this while a run
#     is active. No state stored — GitHub is the source of truth."""
#     try:
#         return get_build_status(req.repo_url, req.pat_token, history=req.history)
#     except Exception as e:
#         raise HTTPException(status_code=502, detail=str(e))