output "cognito_pool_id" {
  value = aws_cognito_user_pool.main.id
}
output "cognito_app_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}
output "backend_api_url" {
  description = "Set as VITE_API_URL in the frontend (API Gateway endpoint)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}
output "cloudfront_domain" {
  description = "Where the app is served from."
  value       = aws_cloudfront_distribution.frontend.domain_name
}
output "ecr_repo_url" {
  value = aws_ecr_repository.backend.repository_url
}
output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}
