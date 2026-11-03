variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "aws_profile" {
  description = "AWS CLI profile (SSO) to use."
  type        = string
  default     = "mechanicpulse"
}

variable "api_image_tag" {
  description = "Tag of the API image in ECR to run."
  type        = string
  default     = "staging"
}

variable "web_image_tag" {
  description = "Tag of the web image in ECR to run."
  type        = string
  default     = "staging"
}

variable "desired_count" {
  description = "Tasks per service. Set to 0 for the first apply, before any image has been pushed."
  type        = number
  default     = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "sms_provider" {
  description = "\"console\" logs texts instead of sending them. \"twilio\" sends real ones and needs the three twilio_* values."
  type        = string
  default     = "console"

  validation {
    condition     = contains(["console", "twilio"], var.sms_provider)
    error_message = "sms_provider must be \"console\" or \"twilio\"."
  }
}

variable "twilio_account_sid" {
  type      = string
  default   = ""
  sensitive = true
}

variable "twilio_auth_token" {
  type      = string
  default   = ""
  sensitive = true
}

variable "twilio_from" {
  description = "Sender: a Twilio number (+…) or a Messaging Service SID (MG…)."
  type        = string
  default     = ""
}
