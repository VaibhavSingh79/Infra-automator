import os
import tempfile
from typing import List, Optional, Tuple
from jinja2 import Environment, FileSystemLoader
from models.vpc_schema import VPCConfig
from models.account_schema import OrgAccount, SSOGroup

# Template path logic is UNCHANGED, so this file works wherever it currently
# lives in your tree (templates/ resolved relative to this module's parent).
TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'templates')


def _env() -> Environment:
    return Environment(loader=FileSystemLoader(TEMPLATE_DIR))


def new_output_dir() -> str:
    """A fresh, isolated scratch dir per request.

    The old code wrote every request into one global '/tmp/generated_tf_output'.
    In Lambda a warm container is reused across concurrent invocations, so two
    users hitting Generate at once would read/write the same files. A unique
    mkdtemp per request removes that race entirely.
    """
    return tempfile.mkdtemp(prefix="tf_gen_")


def generate_terraform_scripts(vpc_configs: List[VPCConfig], output_dir: str) -> List[str]:
    """Render one .tf per VPC into output_dir. Returns the file paths."""
    env = _env()
    vpc_template = env.get_template('vpc.tf.j2')

    generated_files = []
    for vpc in vpc_configs:
        rendered_tf = vpc_template.render(vpc=vpc)
        file_path = os.path.join(output_dir, f"{vpc.vpc_name}.tf")
        with open(file_path, 'w') as tf_file:
            tf_file.write(rendered_tf)
        generated_files.append(file_path)

    return generated_files


def generate_account_tf_scripts(account_configs: List[OrgAccount], output_dir: str) -> List[str]:
    env = _env()
    account_template = env.get_template('account.tf.j2')

    generated_files = []
    for account in account_configs:
        rendered_tf = account_template.render(account=account)
        safe_name = account.account_name.replace(' ', '_').lower()
        file_path = os.path.join(output_dir, f"account_{safe_name}.tf")
        with open(file_path, 'w') as tf_file:
            tf_file.write(rendered_tf)
        generated_files.append(file_path)

    return generated_files


def generate_sso_tf_scripts(sso_groups: List[SSOGroup], output_dir: str) -> List[str]:
    env = _env()
    sso_template = env.get_template('sso.tf.j2')

    generated_files = []
    for group in sso_groups:
        rendered_tf = sso_template.render(group=group)
        safe_name = group.group_name.replace(' ', '_').lower()
        file_path = os.path.join(output_dir, f"sso_group_{safe_name}.tf")
        with open(file_path, 'w') as tf_file:
            tf_file.write(rendered_tf)
        generated_files.append(file_path)

    return generated_files


def generate_variables_tf(output_dir: str, identity_store_id: str = "d-1234567890") -> str:
    """Declare variables the generated .tf references so `plan` doesn't error.

    identity_store_id defaults to a placeholder for the POC; pass the account's
    real AWS Identity Center store ID in production.
    """
    file_path = os.path.join(output_dir, 'variables.tf')
    content = f'''# Auto-generated Variables File
variable "identity_store_id" {{
  description = "The ID of the AWS SSO Identity Store"
  type        = string
  default     = "{identity_store_id}"
}}
'''
    with open(file_path, 'w') as f:
        f.write(content)
    return file_path


def generate_backend_tf(
    output_dir: str,
    *,
    bucket: str,
    key: str,
    region: str,
    dynamodb_table: Optional[str] = None,
    role_arn: Optional[str] = None,
) -> str:
    """Per-tenant remote state.

    `bucket` is the user's OWN state bucket (created by their setup script), and
    `key` MUST be unique per tenant/project. The old code hardcoded one bucket
    and the shared key 'poc/terraform.tfstate' — which meant every user wrote to
    the same state, so one apply could destroy another user's resources.

    A safe key convention: f"{owner}/{repo}/terraform.tfstate", or
    f"tenants/{tenant_id}/{project}/terraform.tfstate".

    `role_arn` (the deploy role) is CRITICAL: the S3 backend authenticates
    independently of the provider, so without its own assume_role it would use
    the pipeline's base creds (the orchestrator role, which has no S3 access)
    and fail to read/write state with a 403. This makes the backend hop to the
    deploy role too, exactly like the provider does.
    """
    # S3-native state locking (Terraform >= 1.10). Replaces the deprecated
    # dynamodb_table lock — no separate DynamoDB table needed, and it avoids the
    # stale-lock failures that a killed run used to leave behind in DynamoDB.
    # The dynamodb_table arg is accepted for backward compat but no longer used.
    lock_line = '\n    use_lockfile = true'
    assume_block = (
        f'\n    assume_role = {{\n      role_arn = "{role_arn}"\n    }}'
        if role_arn else ""
    )
    content = f'''terraform {{
  backend "s3" {{
    bucket  = "{bucket}"
    key     = "{key}"
    region  = "{region}"
    encrypt = true{lock_line}{assume_block}
  }}
}}
'''
    file_path = os.path.join(output_dir, 'backend.tf')
    with open(file_path, 'w') as f:
        f.write(content)
    return file_path


def generate_provider_tf(
    output_dir: str,
    *,
    region: str,
    role_arn: str,
    tags: Optional[dict] = None,
) -> str:
    """Provider file with a cross-account assume_role.

    `role_arn` is passed IN from the request. The old code read it from a shared
    '/tmp/cross_account_config.json' (or a process env var), which leaked one
    request's target role into another concurrent request. Passing it as an
    argument keeps every request self-contained.

    `tags` become provider default_tags — stamp the requester + a correlation id
    here so every provisioned resource is traceable back to who asked for it.
    """
    assume_role_block = ""
    if role_arn:
        assume_role_block = f'''
  assume_role {{
    role_arn = "{role_arn}"
  }}'''

    tags_block = ""
    if tags:
        rendered_tags = "\n".join(f'      {k} = "{v}"' for k, v in tags.items())
        tags_block = f'''
  default_tags {{
    tags = {{
{rendered_tags}
    }}
  }}'''

    content = f'''# Auto-generated Provider File
provider "aws" {{
  region = "{region}"{assume_role_block}{tags_block}
}}
'''
    file_path = os.path.join(output_dir, 'provider.tf')
    with open(file_path, 'w') as f:
        f.write(content)
    return file_path


def generate_all(
    *,
    region: str,
    role_arn: str,
    state_bucket: str,
    state_key: str,
    state_region: Optional[str] = None,
    dynamodb_table: Optional[str] = None,
    vpc_configs: Optional[List[VPCConfig]] = None,
    account_configs: Optional[List[OrgAccount]] = None,
    sso_groups: Optional[List[SSOGroup]] = None,
    identity_store_id: str = "d-1234567890",
    tags: Optional[dict] = None,
) -> Tuple[str, List[str]]:
    """Single entry point for a request.

    Creates an isolated output dir, renders everything into it, and returns
    (output_dir, files). The caller pushes `files` to Git, then should
    shutil.rmtree(output_dir) when done.
    """
    output_dir = new_output_dir()
    files: List[str] = []

    if vpc_configs:
        files += generate_terraform_scripts(vpc_configs, output_dir)
    if account_configs:
        files += generate_account_tf_scripts(account_configs, output_dir)
    if sso_groups:
        files += generate_sso_tf_scripts(sso_groups, output_dir)

    files.append(generate_variables_tf(output_dir, identity_store_id))
    files.append(generate_backend_tf(
        output_dir, bucket=state_bucket, key=state_key,
        region=state_region or region, dynamodb_table=dynamodb_table,
        role_arn=role_arn,
    ))
    files.append(generate_provider_tf(
        output_dir, region=region, role_arn=role_arn, tags=tags,
    ))

    return output_dir, files