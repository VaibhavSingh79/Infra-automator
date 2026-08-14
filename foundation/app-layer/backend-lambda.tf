# ── Execution role: least privilege for what the app actually does ──
resource "aws_iam_role" "backend_exec" {
  name               = "${var.project}-backend-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "backend_logs" {
  role       = aws_iam_role.backend_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "backend_perms" {
  statement {
    sid       = "ReadConfigParams"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/infraorchestrator/*"]
  }
  statement {
    sid       = "ReadGitHubPat"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:infraorchestrator/github-pat-*"]
  }
  statement {
    sid     = "JobStore"
    effect  = "Allow"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      "arn:aws:s3:::${var.jobs_bucket_name}",
      "arn:aws:s3:::${var.jobs_bucket_name}/*",
    ]
  }
}

resource "aws_iam_role_policy" "backend_perms" {
  name   = "backend-perms"
  role   = aws_iam_role.backend_exec.id
  policy = data.aws_iam_policy_document.backend_perms.json
}

# ── The backend Lambda, from the container image in ECR ──
resource "aws_lambda_function" "backend" {
  function_name = "${var.project}-backend"
  role          = aws_iam_role.backend_exec.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.backend.repository_url}:${var.image_tag}"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 1024

  environment {
    variables = {
      COGNITO_POOL_ID       = aws_cognito_user_pool.main.id
      COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.spa.id
      COGNITO_REGION        = var.aws_region
      JOBS_BUCKET           = var.jobs_bucket_name
      # AWS_REGION is injected by the Lambda runtime — do not set it here.
    }
  }
}

# NOTE: The public Lambda Function URL was removed — this account rejects
# Function URLs with AuthType NONE. Access is now via API Gateway (apigateway.tf).
