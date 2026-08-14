# ── HTTP API in front of the backend Lambda ──────────────────────────
# Replaces the public Function URL (which this account blocks for AuthType
# NONE). Every request must carry a valid Cognito access token; API Gateway's
# JWT authorizer checks it at the edge before the Lambda ever runs.

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  # CORS handled at the edge. Browsers send an unauthenticated OPTIONS preflight;
  # HTTP API answers it automatically WITHOUT invoking the JWT authorizer, so
  # preflight never 401s. Bearer-token auth (no cookies) => "*" origin is fine.
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["*"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.project}-cognito-jwt"

  jwt_configuration {
    # Frontend sends the Cognito ACCESS token; its client_id claim is matched
    # against this audience list by API Gateway for Cognito issuers.
    audience = [aws_cognito_user_pool_client.spa.id]
    issuer   = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.backend.invoke_arn
  payload_format_version = "2.0"
}

# Explicit per-method routes on the proxy path — deliberately NOT $default and
# NOT ANY, because both would also match the OPTIONS preflight and force it
# through the JWT authorizer (401). With no OPTIONS route defined, API Gateway's
# built-in CORS responder answers preflight itself — bypassing both the
# authorizer and the Lambda. Real methods stay JWT-guarded.
resource "aws_apigatewayv2_route" "api" {
  for_each           = toset(["GET", "POST", "PUT", "DELETE", "PATCH"])
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = "${each.value} /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backend.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
