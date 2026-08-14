from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import boto3
import json
from botocore.exceptions import ClientError
import os

router = APIRouter()

# Note: Boto3 will automatically use your local ~/.aws/credentials 
# Make sure your local terminal has AWS access configured!
s3_client = boto3.client('s3', region_name='us-east-1')

# This must match the bucket name in your backend.tf
BUCKET_NAME = "demo-terraform-state-bucket-vaibhav" 
STATE_KEY = "poc/terraform.tfstate"

class StateUpdateRequest(BaseModel):
    state_data: dict

@router.get("/state/fetch")
def fetch_state():
    """Retrieves the current Terraform state file from S3."""
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=STATE_KEY)
        state_content = response['Body'].read().decode('utf-8')
        return {"status": "success", "data": json.loads(state_content)}
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            raise HTTPException(status_code=404, detail="State file not found. Have you run 'Terraform Apply' yet?")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/state/update")
def update_state(request: StateUpdateRequest):
    """Increments the serial number and pushes the updated JSON back to S3."""
    updated_state = request.state_data
    
    if "version" not in updated_state or "serial" not in updated_state:
        raise HTTPException(status_code=400, detail="Invalid state format. Missing 'serial' or 'version'.")

    try:
        # Terraform strictly requires the serial number to increment on every change
        current_serial = int(updated_state.get('serial', 0))
        updated_state['serial'] = current_serial + 1

        new_state_content = json.dumps(updated_state, indent=2)

        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=STATE_KEY,
            Body=new_state_content,
            ContentType='application/json'
        )
        
        return {"status": "success", "message": "State updated successfully.", "new_serial": updated_state['serial']}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update S3: {str(e)}")
    

