"""Durable job store for the two-step generate → push flow.

Generate renders the .tf files and parks them here under a job_id; push hydrates
them back. Because Lambda may run the two requests on different containers, this
CANNOT be /tmp — it has to be shared, durable storage. One JSON object per job
keeps it atomic (single PUT / GET) and isolated (job_id in the key), which also
removes the concurrency race between overlapping users.

Set an S3 lifecycle rule on the 'jobs/' prefix (e.g. expire after 7 days) so old
jobs clean themselves up.
"""
import json
import boto3
from core import config

_s3 = boto3.client("s3", region_name=config.AWS_REGION)


def _key(job_id: str) -> str:
    return f"jobs/{job_id}.json"


def create_job(job_id: str, metadata: dict, files: dict) -> None:
    """Store {metadata, files} as a single encrypted object."""
    body = json.dumps({"metadata": metadata, "files": files}).encode("utf-8")
    _s3.put_object(
        Bucket=config.JOBS_BUCKET,
        Key=_key(job_id),
        Body=body,
        ContentType="application/json",
        ServerSideEncryption="aws:kms",
    )


def get_job(job_id: str) -> dict:
    """Return {metadata, files}. Raises KeyError if the job is missing/expired."""
    try:
        obj = _s3.get_object(Bucket=config.JOBS_BUCKET, Key=_key(job_id))
    except _s3.exceptions.NoSuchKey:
        raise KeyError(f"Job '{job_id}' not found or expired.")
    return json.loads(obj["Body"].read())


def delete_job(job_id: str) -> None:
    _s3.delete_object(Bucket=config.JOBS_BUCKET, Key=_key(job_id))