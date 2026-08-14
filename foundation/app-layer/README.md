# App layer — hosts the platform in the new account

Stands up Cognito (with the @minfytech.com pre-signup guard), the backend Lambda
(container + Function URL), and the frontend (S3 + CloudFront). Run AFTER the
foundation stack.

Put this folder at `infra-validator/foundation/app-layer/`.

## Deploy order (first time)

There's a chicken-and-egg: the Lambda needs an image in ECR before it can be
created. So ECR comes first.

```bash
cd foundation/app-layer
cp terraform.tfvars.example terraform.tfvars   # fill in jobs_bucket_name + frontend_bucket_name
terraform init

# 1. Create ONLY the ECR repo
terraform apply -target=aws_ecr_repository.backend

# 2. Build + push the backend image (run from the backend dir)
cd ../../backend
../foundation/app-layer/build-and-push.sh "$(cd ../foundation/app-layer && terraform output -raw ecr_repo_url)" latest

# 3. Now apply everything (Lambda picks up :latest, Cognito + CloudFront come up)
cd ../foundation/app-layer
terraform apply
```

## Wire the frontend

```bash
terraform output   # note cognito_pool_id, cognito_app_client_id, backend_function_url, cloudfront_domain, frontend_bucket
```

Create `frontend/.env`:

```
VITE_API_URL=<backend_function_url>
VITE_COGNITO_REGION=ap-south-1
VITE_COGNITO_POOL_ID=<cognito_pool_id>
VITE_COGNITO_CLIENT_ID=<cognito_app_client_id>
```

Then build + publish:

```bash
cd frontend
npm run build
aws s3 sync dist/ "s3://<frontend_bucket>/" --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
```

## Redeploys

Backend code change → re-run build-and-push.sh, then
`aws lambda update-function-code ... --image-uri <ecr>:latest`.
Frontend change → `npm run build` + `s3 sync` + CloudFront invalidation.

## Post-demo hardening
- Narrow the Function URL CORS `allow_origins` from `*` to the CloudFront URL.
- The State Editor tab reads Terraform state, which now lives in each user's
  account — that cross-account read needs the deploy role to also trust this
  Lambda's role. Left out of scope until you need that tab.