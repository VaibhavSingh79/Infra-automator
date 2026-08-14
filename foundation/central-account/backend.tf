# PHASE 2 — enable AFTER the first apply has created the state bucket + lock table.
# Then run:  terraform init -migrate-state
#
# terraform {
#   backend "s3" {
#     bucket         = "REPLACE_WITH_state_bucket_name"
#     key            = "central/foundation.tfstate"
#     region         = "ap-south-1"
#     dynamodb_table = "infraorchestrator-tf-locks"
#     encrypt        = true
#   }
# }
