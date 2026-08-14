import requests

GH_HEADERS_VERSION = "2022-11-28"


def _parse_repo(repo_url: str):
    clean_url = repo_url.replace(".git", "").strip().rstrip("/")
    parts = clean_url.split("/")
    return parts[-2], parts[-1]


def _headers(pat_token: str) -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {pat_token}",
        "X-GitHub-Api-Version": GH_HEADERS_VERSION,
    }


def set_repo_variable(repo_url: str, pat_token: str, name: str, value: str) -> dict:
    """Upsert a GitHub Actions repository variable.

    The workflows read role-to-assume / region from vars.AWS_ROLE_ARN and
    vars.AWS_REGION, so nothing account-specific is baked into the YAML. Setting
    these here is what makes swapping repos or accounts a config change, not an
    edit to every workflow file.
    """
    owner, repo = _parse_repo(repo_url)
    base = f"https://api.github.com/repos/{owner}/{repo}/actions/variables"
    headers = _headers(pat_token)

    # Update if it exists, otherwise create.
    resp = requests.patch(f"{base}/{name}", headers=headers, json={"name": name, "value": value})
    if resp.status_code == 404:
        resp = requests.post(base, headers=headers, json={"name": name, "value": value})

    if resp.status_code not in (200, 201, 204):
        raise Exception(f"Failed to set variable {name}. Code {resp.status_code}: {resp.text}")
    return {"status": "success", "variable": name}


def trigger_terraform_apply(repo_url: str, branch_name: str, pat_token: str) -> dict:
    owner, repo = _parse_repo(repo_url)
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/terraform-apply.yml/dispatches"
    response = requests.post(url, headers=_headers(pat_token), json={"ref": "main"})
    if response.status_code == 204:
        return {"status": "success", "message": "Deployment authorized! Terraform Apply pipeline is now running in the background."}
    raise Exception(f"GitHub API rejected the trigger. Code {response.status_code}: {response.text}")


def trigger_terraform_destroy(repo_url: str, branch_name: str, pat_token: str) -> dict:
    owner, repo = _parse_repo(repo_url)
    url = f"https://api.github.com/repos/{owner}/{repo}/actions/workflows/terraform-destroy.yml/dispatches"
    response = requests.post(url, headers=_headers(pat_token), json={"ref": "main"})
    if response.status_code == 204:
        return {"status": "success", "message": "Destroy pipeline triggered! Resources are being torn down."}
    raise Exception(f"GitHub API rejected the trigger. Code {response.status_code}: {response.text}")


def validate_github_credentials(repo_url: str, pat_token: str) -> dict:
    owner, repo = _parse_repo(repo_url)
    url = f"https://api.github.com/repos/{owner}/{repo}"
    response = requests.get(url, headers=_headers(pat_token))
    if response.status_code == 200:
        scopes = response.headers.get("X-OAuth-Scopes", "")
        if "workflow" not in scopes:
            return {"status": "warning", "message": "Repo found, but PAT is missing the 'workflow' scope!"}
        return {"status": "success", "message": "Connection verified! Token and Repo are valid."}
    elif response.status_code == 401:
        raise Exception("Invalid or expired Personal Access Token.")
    elif response.status_code == 404:
        raise Exception("Repository not found, or your PAT does not have access to it.")
    else:
        raise Exception(f"GitHub API Error: {response.status_code}")