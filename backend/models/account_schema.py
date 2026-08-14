from pydantic import BaseModel, EmailStr

class OrgAccount(BaseModel):
    organization_unit: str
    account_name: str
    email: EmailStr
    primary_region: str
    dr_region: str

class SSOGroup(BaseModel):
    group_name: str
    users: list[EmailStr]