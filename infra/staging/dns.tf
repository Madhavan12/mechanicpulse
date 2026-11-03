# A friendly address (https://staging.mechanicpulse.com) in front of CloudFront.
# Off unless var.domain_name is set; with it empty the site stays on its
# xxxx.cloudfront.net address and none of this is created.
#
# Two ways to host the DNS records:
#  - dns_zone_name set: the domain was registered in Route 53, which already
#    made a hosted zone for it. Terraform looks that zone up and adds records.
#  - dns_zone_name empty: the domain lives at another registrar. Terraform
#    makes a zone for just var.domain_name and the registrar delegates that
#    one subdomain to it with four NS records.
# Steps for both: docs/deploy-staging.md, "Use your own domain".

data "aws_route53_zone" "existing" {
  count = local.custom_domain && local.existing_zone ? 1 : 0
  name  = var.dns_zone_name
}

resource "aws_route53_zone" "site" {
  count = local.custom_domain && !local.existing_zone ? 1 : 0
  name  = var.domain_name
}

# CloudFront only accepts certificates from us-east-1, whatever region the
# rest of the stack is in.
resource "aws_acm_certificate" "site" {
  count             = local.custom_domain ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.custom_domain ? {
    for o in aws_acm_certificate.site[0].domain_validation_options : o.domain_name => {
      name   = o.resource_record_name
      type   = o.resource_record_type
      record = o.resource_record_value
    }
  } : {}

  zone_id         = local.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Waits until AWS has seen the validation record. That only happens once the
# registrar delegates the subdomain to this zone's name servers.
resource "aws_acm_certificate_validation" "site" {
  count                   = local.custom_domain ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.site[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_route53_record" "site" {
  for_each = local.custom_domain ? toset(["A", "AAAA"]) : toset([])

  zone_id = local.zone_id
  name    = var.domain_name
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
