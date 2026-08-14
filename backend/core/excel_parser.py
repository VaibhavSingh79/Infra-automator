import pandas as pd
from typing import List, Tuple
from pydantic import ValidationError
from models.vpc_schema import VPCConfig, SubnetDetails
from models.account_schema import OrgAccount, SSOGroup
from pydantic import BaseModel, ValidationError, EmailStr


def parse_vpc_sheet(df: pd.DataFrame) -> Tuple[List[VPCConfig], List[str]]:
    """
    Parses the complex VPC-Subnet-Details dataframe and returns a list of validated Pydantic models.
    """
    if df.iloc[0].astype(str).str.contains('Subnet CIDR').any():
        df = df.drop(0).reset_index(drop=True)

    vpc_core_columns = [
        'Account  Name', 'Organization Unit', 'VPC Name', 'CIDR', 'Region', 'NAT Gateway'
    ]
    
    existing_vpc_cols = [col for col in vpc_core_columns if col in df.columns]
    df[existing_vpc_cols] = df[existing_vpc_cols].ffill()

    vpc_configs = []
    alerts = [] # Stores our soft-validation warnings
    
    df = df.dropna(subset=['VPC Name'])
    grouped = df.groupby('VPC Name')

    for vpc_name, group in grouped:
        first_row = group.iloc[0]
        subnets = []

        for _, row in group.iterrows():
            route_table = str(row.get('Route-Table-Association', 'Private'))

            zone_a_name = row.iloc[8] if len(row) > 8 else None
            zone_a_cidr = row.iloc[9] if len(row) > 9 else None
            if pd.notna(zone_a_name) and pd.notna(zone_a_cidr):
                subnets.append(SubnetDetails(name=str(zone_a_name), cidr=str(zone_a_cidr), route_table_association=route_table))

            zone_b_name = row.iloc[10] if len(row) > 10 else None
            zone_b_cidr = row.iloc[11] if len(row) > 11 else None
            if pd.notna(zone_b_name) and pd.notna(zone_b_cidr):
                subnets.append(SubnetDetails(name=str(zone_b_name), cidr=str(zone_b_cidr), route_table_association=route_table))

            zone_c_name = row.iloc[12] if len(row) > 12 else None
            zone_c_cidr = row.iloc[13] if len(row) > 13 else None
            if pd.notna(zone_c_name) and pd.notna(zone_c_cidr):
                subnets.append(SubnetDetails(name=str(zone_c_name), cidr=str(zone_c_cidr), route_table_association=route_table))

        # 5. Construct the Pydantic Model (WITH SOFT VALIDATION)
        try:
            config = VPCConfig(
                account_name=str(first_row.get('Account  Name', 'Unknown')),
                organization_unit=str(first_row.get('Organization Unit', 'Unknown')),
                vpc_name=str(vpc_name),
                vpc_cidr=str(first_row.get('CIDR')),
                region=str(first_row.get('Region', 'us-east-1')),
                nat_gateway=str(first_row.get('NAT Gateway', 'No')).strip().lower() == 'yes',
                subnets=subnets
            )
            vpc_configs.append(config)
        except ValidationError as ve:
            # Catch bad CIDRs and log them as alerts instead of failing
            error_details = [err['msg'] for err in ve.errors()]
            alerts.append(f"Alert for VPC '{vpc_name}': {', '.join(error_details)}")

    # Return BOTH lists
    return vpc_configs, alerts


def parse_account_sheet(df: pd.DataFrame) -> Tuple[List[OrgAccount], List[str]]:
    """Parses the Org.Account-Structure sheet."""
    accounts = []
    alerts = []

    # Drop completely empty rows
    df = df.dropna(how='all')

    for index, row in df.iterrows():
        # Skip header repetitions if any
        if str(row.get('Account Name')) == 'Account Name':
            continue

        try:
            account = OrgAccount(
                organization_unit=str(row.get('Organization Unit', 'NA')),
                account_name=str(row.get('Account Name', '')),
                email=str(row.get('Email Distribution List', '')),
                primary_region=str(row.get('Primary-Region', 'us-east-1')),
                dr_region=str(row.get('DR - Region', 'us-west-2'))
            )
            accounts.append(account)
        except ValidationError as ve:
            error_details = [err['msg'] for err in ve.errors()]
            alerts.append(f"Account Alert row {index + 1}: {', '.join(error_details)}")

    return accounts, alerts

def parse_sso_sheet(df: pd.DataFrame) -> Tuple[List[SSOGroup], List[str]]:
    """Parses the SSO User Access List sheet, handling stacked tables."""
    sso_groups_dict = {}
    alerts = []

    # Rename columns explicitly to target the 1st and 3rd columns based on your CSV snippet
    # Group name is in col 0, Email ID is in col 2. The middle column name changes.
    df.columns = ['SSO_Group', 'User_Name', 'Email_ID']

    # Drop empty rows where both Group and Email are missing
    df = df.dropna(subset=['SSO_Group', 'Email_ID'], how='all')

    for index, row in df.iterrows():
        group_name = str(row['SSO_Group']).strip()
        email = str(row['Email_ID']).strip()

        # Skip rows that are just section headers (like "SSO Group, Minfy SSO Users, Email ID")
        if group_name == 'SSO Group' or group_name == 'nan':
            continue

        # If it's a valid group but no email yet, initialize it
        if group_name not in sso_groups_dict:
            sso_groups_dict[group_name] = []

        # If there is an email, attempt to validate and add it
        if email != 'nan' and email != '':
            # We use a temporary Pydantic model just to validate the single email
            try:
                class TempEmailValidator(BaseModel):
                    email: EmailStr
                valid_email = TempEmailValidator(email=email).email
                sso_groups_dict[group_name].append(valid_email)
            except ValidationError:
                alerts.append(f"SSO Alert for '{group_name}': Invalid email '{email}'")

    # Convert the dictionary map into our final Pydantic models
    sso_configs = []
    for group, emails in sso_groups_dict.items():
        sso_configs.append(SSOGroup(group_name=group, users=emails))

    return sso_configs, alerts