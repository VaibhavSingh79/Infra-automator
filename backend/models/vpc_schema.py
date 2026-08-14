from pydantic import BaseModel, Field, field_validator
import ipaddress
from typing import List, Optional

class SubnetDetails(BaseModel):
    name: str
    cidr: str
    route_table_association: str # e.g., "Private" or "Public"

    @field_validator('cidr')
    def validate_cidr(cls, v):
        try:
            ipaddress.IPv4Network(v)
        except ValueError:
            raise ValueError(f"Invalid Subnet CIDR block: {v}")
        return v

class VPCConfig(BaseModel):
    account_name: str
    organization_unit: str
    vpc_name: str
    vpc_cidr: str
    region: str
    nat_gateway: bool
    subnets: List[SubnetDetails]

    @field_validator('vpc_cidr')
    def validate_vpc_cidr(cls, v):
        try:
            ipaddress.IPv4Network(v)
        except ValueError:
            raise ValueError(f"Invalid VPC CIDR block: {v}")
        return v
        
    # Optional advanced validation: Check if subnet CIDRs fall within the VPC CIDR