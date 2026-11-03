data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "mechanicpulse-staging"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)

  # One public address serves the web app and the API (/api/* goes to the
  # API), so there is no CORS and no mixed content.
  custom_domain = var.domain_name != ""
  existing_zone = var.dns_zone_name != ""
  zone_id       = local.custom_domain ? (local.existing_zone ? data.aws_route53_zone.existing[0].zone_id : aws_route53_zone.site[0].zone_id) : null
  site_url      = local.custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.site.domain_name}"

  twilio = var.sms_provider == "twilio"
}
