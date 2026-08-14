import boto3
import json
from botocore.exceptions import ClientError
from typing import Dict, Any

# In a real app, load these from environment variables
STATE_BUCKET_NAME = "your-company-terraform-state-bucket"
STATE_FILE_KEY = "poc-infrastructure/terraform.tfstate"

# Initialize the S3 client
# Boto3 will automatically pick up your ~/.aws/credentials locally
s3_client = boto3.client('s3')

def get_terraform_state() -> Dict[str, Any]:
    """Fetches the state file from S3 and parses the JSON."""
    try:
        response = s3_client.get_object(Bucket=STATE_BUCKET_NAME, Key=STATE_FILE_KEY)
        state_content = response['Body'].read().decode('utf-8')
        return json.loads(state_content)
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'NoSuchKey':
            raise FileNotFoundError(f"State file {STATE_FILE_KEY} not found in S3.")
        else:
            raise RuntimeError(f"S3 Error: {str(e)}")

def update_terraform_state(updated_state_data: Dict[str, Any]) -> int:
    """
    Increments the serial number and pushes the updated JSON back to S3.
    Returns the new serial number.
    """
    try:
        # Terraform STRICTLY requires the serial number to increment on every state change
        current_serial = int(updated_state_data.get('serial', 0))
        new_serial = current_serial + 1
        updated_state_data['serial'] = new_serial

        # Convert back to a formatted JSON string
        new_state_content = json.dumps(updated_state_data, indent=2)

        # Push to S3
        s3_client.put_object(
            Bucket=STATE_BUCKET_NAME,
            Key=STATE_FILE_KEY,
            Body=new_state_content,
            ContentType='application/json'
        )
        
        return new_serial
    except Exception as e:
        raise RuntimeError(f"Failed to update S3 state file: {str(e)}")