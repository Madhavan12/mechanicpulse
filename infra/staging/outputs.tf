output "site_url" {
  description = "The staging site. Web and API are both served from here."
  value       = local.site_url
}

output "twilio_status_callback" {
  description = "Delivery-receipt URL the API gives Twilio automatically (shown for reference)."
  value       = "${local.site_url}/api/sms/twilio/status"
}

output "ecr_api" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web" {
  value = aws_ecr_repository.web.repository_url
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "service_api" {
  value = aws_ecs_service.api.name
}

output "service_web" {
  value = aws_ecs_service.web.name
}

output "api_task_family" {
  value = aws_ecs_task_definition.api.family
}

# For one-off tasks (migrations, creating the first login): they run in the
# same subnets and security group as the API.
output "task_subnets" {
  value = aws_subnet.public[*].id
}

output "task_security_group" {
  value = aws_security_group.tasks.id
}

output "uploads_bucket" {
  value = aws_s3_bucket.uploads.bucket
}

output "api_log_group" {
  value = aws_cloudwatch_log_group.api.name
}
