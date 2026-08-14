import os
import shutil
import tempfile
from git import Repo, GitCommandError
from models.git_schema import GitCredentials
from datetime import datetime


def push_generated_code_to_git(creds: GitCredentials, source_dir: str) -> dict:
    """Push generated .tf files into the repo's infrastructure/ folder.

    `source_dir` is the per-request output directory returned by
    generator.generate_all(...). It replaces the old global
    '/tmp/generated_tf_output' — which, being shared across concurrent Lambda
    invocations, meant one user's push could pick up another user's files.
    The caller should shutil.rmtree(source_dir) after this returns.
    """
    if not source_dir or not os.path.isdir(source_dir):
        raise ValueError("source_dir must be the per-request generated output directory.")

    os.environ["GIT_TERMINAL_PROMPT"] = "0"

    url_str = str(creds.repo_url)
    auth_url = url_str.replace("https://", f"https://{creds.pat_token}@")

    try:
        with tempfile.TemporaryDirectory() as temp_repo_dir:
            repo = Repo.clone_from(
                auth_url,
                temp_repo_dir,
                env={"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo"},
                multi_options=["-c", "credential.helper="],
                allow_unsafe_options=True,
            )

            branch_name = creds.branch_name

            # Smart branch tracking
            remote_branches = [ref.name for ref in repo.remote().refs]
            origin_branch = f"origin/{branch_name}"
            # `git clone` already creates a local branch for the repo's default
            # (e.g. main), so `checkout -b main` would fail with "already exists".
            # Check local heads first and just switch to it if present.
            local_heads = [h.name for h in repo.heads]
            if branch_name in local_heads:
                repo.git.checkout(branch_name)
            elif origin_branch in remote_branches:
                repo.git.checkout("-b", branch_name, origin_branch)
            else:
                repo.git.checkout("-b", branch_name)

            # Wipe old blueprint so deleted/renamed VPCs vanish
            infra_dir = os.path.join(temp_repo_dir, "infrastructure")
            if os.path.exists(infra_dir):
                shutil.rmtree(infra_dir)
            os.makedirs(infra_dir, exist_ok=True)

            # Copy this request's generated files in (skip any .github dir —
            # workflows are handled by the bootstrap endpoint on main)
            for item in os.listdir(source_dir):
                if item == ".github":
                    continue
                src_path = os.path.join(source_dir, item)
                if os.path.isfile(src_path):
                    shutil.copy2(src_path, os.path.join(infra_dir, item))

            repo.git.add(all=True)

            if repo.git.status("--porcelain"):
                repo.index.commit(creds.commit_message)
                push_infos = repo.remote(name="origin").push(refspec=f"{branch_name}:{branch_name}")
                for info in push_infos:
                    if info.flags & info.ERROR:
                        raise RuntimeError(f"GitHub rejected the push: {info.summary}")
                return {"status": "success", "message": f"Successfully pushed updated code to {branch_name}!"}
            else:
                return {"status": "success", "message": "No changes detected. AWS Blueprint is already up to date!"}

    except GitCommandError as e:
        raise RuntimeError(f"Git error: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"An unexpected error occurred: {str(e)}")


def archive_and_destroy_infra(creds: GitCredentials) -> dict:
    """Unchanged in behaviour — operates on the repo, not on /tmp, so it has no
    cross-request state to fix."""
    os.environ["GIT_TERMINAL_PROMPT"] = "0"
    url_str = str(creds.repo_url)
    auth_url = url_str.replace("https://", f"https://{creds.pat_token}@")

    try:
        with tempfile.TemporaryDirectory() as temp_repo_dir:
            repo = Repo.clone_from(
                auth_url,
                temp_repo_dir,
                env={"GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "echo"},
                multi_options=["-c", "credential.helper="],
                allow_unsafe_options=True,
            )

            branch_name = creds.branch_name
            remote_branches = [ref.name for ref in repo.remote().refs]
            origin_branch = f"origin/{branch_name}"
            # `git clone` already creates a local branch for the repo's default
            # (e.g. main), so `checkout -b main` would fail with "already exists".
            # Check local heads first and just switch to it if present.
            local_heads = [h.name for h in repo.heads]
            if branch_name in local_heads:
                repo.git.checkout(branch_name)
            elif origin_branch in remote_branches:
                repo.git.checkout("-b", branch_name, origin_branch)
            else:
                repo.git.checkout("-b", branch_name)

            infra_dir = os.path.join(temp_repo_dir, "infrastructure")
            if not os.path.exists(infra_dir) or len(os.listdir(infra_dir)) <= 2:
                return {"status": "skipped", "message": "No active infrastructure files found to destroy."}

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            archive_dir = os.path.join(temp_repo_dir, f"archives/archived_{timestamp}")
            os.makedirs(archive_dir, exist_ok=True)

            files_moved = 0
            for item in os.listdir(infra_dir):
                if item not in ["backend.tf", "variables.tf"]:
                    shutil.move(os.path.join(infra_dir, item), os.path.join(archive_dir, item))
                    files_moved += 1

            if files_moved > 0:
                repo.git.add(all=True)
                repo.index.commit(f"chore: archive infra files for teardown - {timestamp}")
                repo.remote(name="origin").push(refspec=f"{branch_name}:{branch_name}")
                return {"status": "success", "message": f"Successfully archived {files_moved} files. Terraform Destroy pipeline triggered!"}
            else:
                return {"status": "skipped", "message": "Only core config files remained. Nothing to archive."}

    except GitCommandError as e:
        raise RuntimeError(f"Git error during archiving: {str(e)}")
    except Exception as e:
        raise RuntimeError(f"An unexpected error occurred: {str(e)}")