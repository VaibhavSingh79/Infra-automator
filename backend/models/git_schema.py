from pydantic import BaseModel, HttpUrl

class GitCredentials(BaseModel):
    repo_url: HttpUrl
    branch_name: str = "main"
    pat_token: str
    commit_message: str = "feat: auto-generated infrastructure from Excel POC"

class AWSCredentials(BaseModel):
    repo_url: HttpUrl
    pat_token: str
    aws_access_key_id: str
    aws_secret_access_key: str