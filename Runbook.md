# InfraOrchestrator — Deployment Runbook (new AWS account)

Every command in order, start to finish. Two Terraform stacks, then the app.
The new account plays both roles here: control plane (OIDC, roles, state, jobs,
SSM/Secrets) **and** app host (Cognito, backend Lambda, frontend).

Region: `ap-south-1`. Run everything with your AWS CLI pointed at the NEW account.

---

## 0. Prerequisites

Check these once:

```bash
aws sts get-caller-identity          # must show the NEW account id
terraform version                    # >= 1.5
docker info                          # daemon running (needed for the arm64 image)
node --version                       # for the frontend build
```

You also need a **fine-grained GitHub PAT** on the repo the generator pushes to,
with **Contents: read/write** and **Workflows: read/write**. Keep it handy for step 2.

Values you choose up front (write them down):
- `github_owner` — your GitHub username or org (NEVER `*`).
- `github_target_repo` — `<owner>/<repo>` under that owner.
- Three globally-unique S3 names: state bucket, jobs bucket, frontend bucket.

---

## 1. Central-account stack

```bash
cd foundation/central-account
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
aws_region           = "ap-south-1"
github_owner         = "your-github-username"
github_target_repo   = "your-github-username/infra-vbl"
state_bucket_name    = "minfy-infraorchestrator-tfstate-<unique>"
jobs_bucket_name     = "minfy-infraorchestrator-jobs-<unique>"
use_environment_gate = false
```

Apply:
```bash
terraform init
terraform plan          # sanity-check what it will create
terraform apply
```

Capture the outputs — you need three of them downstream:
```bash
terraform output
#   orchestrator_role_arn   -> frontend .env (VITE_ORCHESTRATOR_ROLE_ARN)
#   jobs_bucket             -> app-layer tfvars (jobs_bucket_name)
#   github_pat_secret_name  -> next step (should be: infraorchestrator/github-pat)
```

### 1a. Put the GitHub PAT into Secrets Manager

Terraform created the empty secret container; you set the value out-of-band so it
never lands in state or tfvars:

```bash
aws secretsmanager put-secret-value \
  --secret-id infraorchestrator/github-pat \
  --secret-string 'YOUR_FINE_GRAINED_PAT' \
  --region ap-south-1
```

---

## 2. App-layer stack

The Lambda can't be created until an image exists in ECR, so ECR comes first.

```bash
cd ../app-layer
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
aws_region           = "ap-south-1"
jobs_bucket_name     = "<paste central-account output: jobs_bucket>"
frontend_bucket_name = "minfy-infraorchestrator-frontend-<unique>"
image_tag            = "latest"
```

```bash
terraform init

# (a) create ONLY the ECR repo
terraform apply -target=aws_ecr_repository.backend

# (b) build + push the arm64 backend image (run from the backend dir)
cd ../../backend
../foundation/app-layer/build-and-push.sh \
  "$(cd ../foundation/app-layer && terraform output -raw ecr_repo_url)" latest

# (c) now apply the rest (Lambda picks up :latest, Cognito + CloudFront come up)
cd ../foundation/app-layer
terraform apply
```

Capture the outputs for the frontend:
```bash
terraform output
#   backend_function_url    -> VITE_API_URL
#   cognito_pool_id         -> VITE_COGNITO_POOL_ID
#   cognito_app_client_id   -> VITE_COGNITO_CLIENT_ID
#   cloudfront_domain       -> where the app is served
#   frontend_bucket         -> the S3 sync target
```

---

## 3. Frontend

```bash
cd ../../frontend
cp .env.example .env
```

Fill `.env` from the outputs (note the exact var names — the code reads these):
```
VITE_API_URL=<backend_function_url>
VITE_COGNITO_REGION=ap-south-1
VITE_COGNITO_POOL_ID=<cognito_pool_id>
VITE_COGNITO_CLIENT_ID=<cognito_app_client_id>
VITE_ORCHESTRATOR_ROLE_ARN=<central-account: orchestrator_role_arn>
```

Build and publish:
```bash
npm install
npm run build
aws s3 sync dist/ "s3://<frontend_bucket>/" --delete

# invalidate CloudFront (fetch the distribution id from its domain)
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?DomainName=='<cloudfront_domain>'].Id" \
  --output text)
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

Open `https://<cloudfront_domain>` — the app is live.

---

## 4. End-to-end smoke test

1. **Sign up** with an `@minfytech.com` email → you get a 6-digit code → confirm.
   (Try a non-minfytech email first: the pre-signup Lambda should reject it.)
2. **Verify Connection** — enter the repo URL + PAT. The app bootstraps the
   GitOps workflows into the repo and sets its Actions variables via OIDC.
3. **Cross-Account AWS Setup** — enter the target AWS account id, generate the
   script, and run it **in the target account** (creates `InfraOrchestrator-Deploy-Role`
   trusting the central role + the deterministic state bucket). Confirm.
4. **Upload** an Excel file → **Generate** → **Push** → **Run Terraform Plan**.
   Watch the plan run in the repo's GitHub Actions tab.

---

## Redeploys

- **Backend code change** → re-run `build-and-push.sh`, then:
  ```bash
  aws lambda update-function-code --function-name infraorchestrator-backend \
    --image-uri <ecr_repo_url>:latest --region ap-south-1
  ```
- **Frontend change** → `npm run build` → `s3 sync` → CloudFront invalidation.
- **Infra change** → `terraform apply` in the relevant stack.

## Post-demo hardening
- Narrow the backend Function URL CORS `allow_origins` from `*` to the CloudFront URL.
- Set `use_environment_gate = true` in central-account and create the
  `infra-deploy` GitHub environment.
- Rotate the PAT on a schedule.
