locals {
  # Owner-scoped subject. NOT repo:* — that would trust every repo on GitHub.
  oidc_sub = var.use_environment_gate ? "repo:${var.github_owner}/*:environment:${var.github_environment}" : "repo:${var.github_owner}/*"
}

data "aws_iam_policy_document" "orchestrator_trust" {
  statement {
    sid     = "GitHubOIDC"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.oidc_sub]
    }
  }
}

resource "aws_iam_role" "orchestrator" {
  name                 = var.orchestrator_role_name
  assume_role_policy   = data.aws_iam_policy_document.orchestrator_trust.json
  max_session_duration = 3600
}

# Least privilege: can ONLY assume the fixed-name deploy role, in any account.
data "aws_iam_policy_document" "orchestrator_permissions" {
  statement {
    sid       = "AssumeUserDeployRole"
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = ["arn:aws:iam::*:role/${var.deploy_role_name}"]
  }
}

resource "aws_iam_role_policy" "orchestrator" {
  name   = "assume-deploy-role"
  role   = aws_iam_role.orchestrator.id
  policy = data.aws_iam_policy_document.orchestrator_permissions.json
}
