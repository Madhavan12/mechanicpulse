terraform {
  required_version = ">= 1.10" # S3-native state locking (use_lockfile)

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in S3 so it survives a laptop. The bucket is created once by
  # hand (docs/deploy-staging.md, step 2) and passed in at init:
  #   terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      project = "mechanicpulse"
      env     = "staging"
      managed = "terraform"
    }
  }
}

# CloudFront certificates must live in us-east-1 (used only by dns.tf).
provider "aws" {
  alias   = "us_east_1"
  region  = "us-east-1"
  profile = var.aws_profile

  default_tags {
    tags = {
      project = "mechanicpulse"
      env     = "staging"
      managed = "terraform"
    }
  }
}
