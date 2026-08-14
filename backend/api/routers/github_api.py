from fastapi import APIRouter, HTTPException
from models.git_schema import GitCredentials
from utils.github_api import trigger_terraform_apply, validate_github_credentials

router = APIRouter()

@router.post("/apply")
def execute_infrastructure_apply(creds: GitCredentials):
    """
    Acts as the 'Approve & Apply' button endpoint. 
    Triggers the Terraform Apply pipeline silently via GitHub API.
    """
    try:
        # Wrap creds.repo_url in str() to cast the Pydantic HttpUrl object to a string
        result = trigger_terraform_apply(str(creds.repo_url), creds.branch_name, creds.pat_token)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/validate")
def validate_creds(creds: GitCredentials):
    """Verifies user credentials before allowing deployments."""
    try:
        result = validate_github_credentials(str(creds.repo_url), creds.pat_token)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))