data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "mechanicpulse-staging"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)

  # One public address serves the web app and the API (/api/* goes to the
  # API), so there is no CORS and no mixed content.
  site_url = "https://${aws_cloudfront_distribution.site.domain_name}"

  twilio = var.sms_provider == "twilio"
}
