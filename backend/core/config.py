"""Central runtime configuration.

Nothing account-specific is hardcoded here. Cognito identifiers come from Lambda
environment variables; the orchestrator role ARN and target repo come from SSM
(written by the foundation Terraform); the GitHub PAT comes from Secrets Manager.
Deploy role and state bucket are DERIVED from a tenant's account ID by fixed
convention, so we never store or look them up per user.
"""
import os
import functools
import boto3

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")

# ── Cognito (set these as Lambda env vars) ────────────────────────────────
COGNITO_REGION = os.environ.get("COGNITO_REGION", AWS_REGION)
COGNITO_POOL_ID = os.environ["COGNITO_POOL_ID"]  # required — fail fast if unset
COGNITO_APP_CLIENT_ID = os.environ.get("COGNITO_APP_CLIENT_ID")

# ── Cross-account deploy role + tenant state (fixed-name conventions) ──────
# The deploy role name and the state-bucket/lock-table naming MUST match what
# the user-setup script creates, so the backend can derive them from just the
# account ID — no per-user storage, no drift.
DEPLOY_ROLE_NAME = os.environ.get("DEPLOY_ROLE_NAME", "InfraOrchestrator-Deploy-Role")
STATE_LOCK_TABLE = os.environ.get("STATE_LOCK_TABLE", "infraorchestrator-tf-locks")
STATE_BUCKET_SUFFIX = os.environ.get("STATE_BUCKET_SUFFIX", "infraorchestrator-tfstate")

# ── Job store (central S3 bucket that carries generated files between the ──
# generate step and the push step, since they may hit different containers) ──
JOBS_BUCKET = os.environ.get("JOBS_BUCKET", "")  # set by Terraform; required at runtime

# ── Parameter / secret names ──────────────────────────────────────────────
SSM_TARGET_REPO = os.environ.get("SSM_TARGET_REPO", "/infraorchestrator/github/target_repo")
SSM_ORCHESTRATOR_ROLE = os.environ.get("SSM_ORCHESTRATOR_ROLE", "/infraorchestrator/aws/orchestrator_role_arn")
SECRET_GITHUB_PAT = os.environ.get("SECRET_GITHUB_PAT", "infraorchestrator/github-pat")

_ssm = boto3.client("ssm", region_name=AWS_REGION)
_secrets = boto3.client("secretsmanager", region_name=AWS_REGION)


def deploy_role_arn(account_id: str) -> str:
    """A tenant's deploy-role ARN, derived from their account ID alone."""
    return f"arn:aws:iam::{account_id}:role/{DEPLOY_ROLE_NAME}"


def state_bucket_name(account_id: str) -> str:
    """A tenant's state bucket, derived by convention. MUST match the name the
    user-setup script creates in that account."""
    return f"{account_id}-{STATE_BUCKET_SUFFIX}"


def get_target_repo() -> str:
    """owner/repo the generator pushes into. Fetched live so a console change to
    the SSM parameter takes effect without a redeploy."""
    return _ssm.get_parameter(Name=SSM_TARGET_REPO)["Parameter"]["Value"]


@functools.lru_cache(maxsize=1)
def get_orchestrator_role_arn() -> str:
    return _ssm.get_parameter(Name=SSM_ORCHESTRATOR_ROLE)["Parameter"]["Value"]


@functools.lru_cache(maxsize=1)
def get_github_pat() -> str:
    return _secrets.get_secret_value(SecretId=SECRET_GITHUB_PAT)["SecretString"]