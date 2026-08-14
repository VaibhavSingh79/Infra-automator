import io
import os
import uuid
import shutil
import pandas as pd
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request

from core.excel_parser import parse_vpc_sheet, parse_account_sheet, parse_sso_sheet
from utils.generator import generate_all
from utils import job_store
from core import config

router = APIRouter()


def _parse_repo_path(repo_url: str) -> str:
    return repo_url.replace("https://github.com/", "").replace(".git", "").strip("/")


@router.post("/upload/infrastructure-data")
async def upload_infra_file(
    request: Request,
    file: UploadFile = File(...),
    account_id: str = Form(...),   # the one input everything else is derived from
    repo_url: str = Form(...),
):
    lower = file.filename.lower()
    if not lower.endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=400, detail="Invalid file type.")

    if not account_id.strip().isdigit() or len(account_id.strip()) != 12:
        raise HTTPException(status_code=400, detail="account_id must be exactly 12 digits.")
    account_id = account_id.strip()

    try:
        contents = await file.read()
        parsed_data = {}
        all_alerts = []
        vpcs = accounts = sso_groups = None

        # -- Parse --
        if lower.endswith(".xlsx"):
            excel_file = pd.ExcelFile(io.BytesIO(contents))
            sheet_names = excel_file.sheet_names

            if "VPC-Subnet-Details" in sheet_names:
                vpcs, vpc_alerts = parse_vpc_sheet(excel_file.parse("VPC-Subnet-Details"))
                parsed_data["vpcs"] = [v.model_dump() for v in vpcs]
                all_alerts.extend(vpc_alerts)

            if "Org.Account-Structucture" in sheet_names:
                accounts, acc_alerts = parse_account_sheet(excel_file.parse("Org.Account-Structucture"))
                parsed_data["accounts"] = [a.model_dump() for a in accounts]
                all_alerts.extend(acc_alerts)

            sso_sheet_name = next((s for s in sheet_names if "SSO" in s), None)
            if sso_sheet_name:
                sso_groups, sso_alerts = parse_sso_sheet(excel_file.parse(sso_sheet_name))
                parsed_data["sso_groups"] = [g.model_dump() for g in sso_groups]
                all_alerts.extend(sso_alerts)

        elif lower.endswith(".csv"):
            df_csv = pd.read_csv(io.BytesIO(contents))
            if "CIDR" in df_csv.columns:
                vpcs, alerts = parse_vpc_sheet(df_csv)
                parsed_data["vpcs"] = [v.model_dump() for v in vpcs]
                all_alerts.extend(alerts)
            elif "Account Number" in df_csv.columns:
                accounts, alerts = parse_account_sheet(df_csv)
                parsed_data["accounts"] = [a.model_dump() for a in accounts]
                all_alerts.extend(alerts)
            elif "SSO Group" in df_csv.columns:
                sso_groups, alerts = parse_sso_sheet(df_csv)
                parsed_data["sso_groups"] = [g.model_dump() for g in sso_groups]
                all_alerts.extend(alerts)

        # -- Derive deploy context from the single account_id --
        # Resource region comes from the blueprint (Excel). State ALWAYS lives in
        # the control region (config.AWS_REGION), where the state bucket and lock
        # table exist — the backend must NOT follow the blueprint's region.
        resource_region = config.AWS_REGION
        if parsed_data.get("vpcs"):
            resource_region = parsed_data["vpcs"][0].get("region", resource_region)
        state_region = config.AWS_REGION

        repo_path = _parse_repo_path(repo_url)
        role_arn = config.deploy_role_arn(account_id)
        state_bucket = config.state_bucket_name(account_id)
        state_key = f"{repo_path.replace('/', '-')}/terraform.tfstate"

        user_email = getattr(request.state, "user_email", "unknown")
        job_id = str(uuid.uuid4())

        # -- Render into an isolated per-request dir --
        output_dir, file_paths = generate_all(
            vpc_configs=vpcs,
            account_configs=accounts,
            sso_groups=sso_groups,
            region=resource_region,
            state_region=state_region,
            role_arn=role_arn,
            state_bucket=state_bucket,
            state_key=state_key,
            dynamodb_table=config.STATE_LOCK_TABLE,
            tags={"Requester": user_email, "JobId": job_id, "ManagedBy": "InfraOrchestrator"},
        )

        try:
            files = {}
            for path in file_paths:
                with open(path) as fh:
                    files[os.path.basename(path)] = fh.read()
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)

        # -- Park in the durable job store; the token is the handoff to push --
        job_store.create_job(
            job_id,
            metadata={
                "user": user_email,
                "account_id": account_id,
                "repo": repo_path,
                "region": resource_region,
                "state_key": state_key,
            },
            files=files,
        )

        return {
            "message": f"Successfully processed {file.filename}",
            "job_id": job_id,
            "data_extracted": parsed_data,
            "generated_files": list(files.keys()),
            "alerts": all_alerts,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")