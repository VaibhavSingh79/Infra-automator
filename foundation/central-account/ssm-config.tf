# Runtime config the backend reads instead of hardcoding.

resource "aws_ssm_parameter" "target_repo" {
  name        = "/infraorchestrator/github/target_repo"
  description = "Repo the generator pushes generated Terraform into."
  type        = "String"
  value       = var.github_target_repo

  lifecycle {
    ignore_changes = [value] # allow swapping the repo in-console without TF drift
  }
}

resource "aws_ssm_parameter" "orchestrator_role_arn" {
  name        = "/infraorchestrator/aws/orchestrator_role_arn"
  description = "ARN the workflows and user-setup script assume."
  type        = "String"
  value       = aws_iam_role.orchestrator.arn
}

# PAT container. VALUE is set out-of-band, never in Terraform/tfvars/state:
#   aws secretsmanager put-secret-value \
#     --secret-id infraorchestrator/github-pat --secret-string 'YOUR_FINE_GRAINED_PAT'
resource "aws_secretsmanager_secret" "github_pat" {
  name        = "infraorchestrator/github-pat"
  description = "Fine-grained GitHub PAT scoped to github_owner. Value set outside Terraform."
}
