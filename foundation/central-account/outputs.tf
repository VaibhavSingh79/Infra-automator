output "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "orchestrator_role_arn" {
  description = "Goes in the workflow role-to-assume and each user's deploy-role trust."
  value       = aws_iam_role.orchestrator.arn
}

output "state_bucket" {
  value = aws_s3_bucket.tf_state.id
}

output "state_lock_table" {
  value = aws_dynamodb_table.tf_lock.id
}

# ── Feed these into the app-layer stack / Lambda env ──
output "jobs_bucket" {
  description = "Set as jobs_bucket_name in the app-layer tfvars (and the Lambda's JOBS_BUCKET)."
  value       = aws_s3_bucket.jobs.id
}

output "github_pat_secret_name" {
  description = "Set the PAT value here out-of-band via aws secretsmanager put-secret-value."
  value       = aws_secretsmanager_secret.github_pat.name
}
