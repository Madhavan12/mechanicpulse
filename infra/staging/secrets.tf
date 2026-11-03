# The database password and JWT secret are generated here and stored in
# Secrets Manager; the containers read them at start. They are also in the
# Terraform state, which is why the state bucket is private and encrypted.

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.name}/database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}"
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/jwt-secret"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "twilio" {
  for_each                = local.twilio ? toset(["account-sid", "auth-token", "from"]) : toset([])
  name                    = "${local.name}/twilio-${each.key}"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "twilio" {
  for_each  = aws_secretsmanager_secret.twilio
  secret_id = each.value.id
  secret_string = {
    "account-sid" = var.twilio_account_sid
    "auth-token"  = var.twilio_auth_token
    "from"        = var.twilio_from
  }[each.key]
}
