variable "aws_region" {
  description = "Region for the central InfraOrchestrator (control-plane) account."
  type        = string
  default     = "ap-south-1"
}

variable "github_owner" {
  description = <<-EOT
    GitHub account/org that owns the repos allowed to assume the orchestrator role.
    Personal username or org. ALL repos under this owner are trusted. Never "*".
  EOT
  type        = string

  validation {
    condition     = var.github_owner != "*" && !can(regex("[/*]", var.github_owner))
    error_message = "github_owner must be a single account/org name, never '*' and never contain '/' or '*'."
  }
}

variable "orchestrator_role_name" {
  description = "Name of the central role GitHub Actions assumes via OIDC."
  type        = string
  default     = "InfraOrchestrator-GitHub-Role"
}

variable "deploy_role_name" {
  description = "Fixed name of the deploy role each user creates in their account."
  type        = string
  default     = "InfraOrchestrator-Deploy-Role"
}

variable "use_environment_gate" {
  description = "Post-demo hardening: require workflows to use a named GitHub Environment."
  type        = bool
  default     = false
}

variable "github_environment" {
  description = "GitHub Environment name required when use_environment_gate = true."
  type        = string
  default     = "infra-deploy"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket for the CENTRAL account's own Terraform state."
  type        = string
}

variable "state_lock_table_name" {
  description = "DynamoDB table for central-account Terraform state locking."
  type        = string
  default     = "infraorchestrator-tf-locks"
}

variable "jobs_bucket_name" {
  description = "Globally-unique S3 bucket name for the generate->push job store."
  type        = string
}

variable "github_target_repo" {
  description = "owner/repo the generator pushes into. MUST be under github_owner."
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_target_repo))
    error_message = "github_target_repo must be exactly owner/repo."
  }
}
