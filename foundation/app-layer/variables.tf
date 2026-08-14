variable "aws_region" {
  type    = string
  default = "ap-south-1"
}

variable "project" {
  type    = string
  default = "infraorchestrator"
}

# From the foundation apply (output "jobs_bucket").
variable "jobs_bucket_name" {
  type        = string
  description = "Name of the job-store bucket created by the foundation stack."
}

# Image tag pushed to ECR (see build-and-push.sh). Keep 'latest' for the demo.
variable "image_tag" {
  type    = string
  default = "latest"
}

# Must be globally unique.
variable "frontend_bucket_name" {
  type        = string
  description = "S3 bucket that holds the built React app (served via CloudFront)."
}
