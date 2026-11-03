# Deploying the staging environment (AWS)

**For:** whoever is deploying (Akash first)  **Written:** 3 Nov 2026  **Terraform:** `infra/staging/`

A real HTTPS address for the proof of concept: open it on any phone, no laptop, no Wi-Fi tricks. Built by Akash while Madhavan was unavailable, **for Madhavan to review** — see "For Madhavan's review" at the bottom.

## What you get

```
phone ──https──▶ CloudFront ──http──▶ Load balancer ──▶ web  (Next.js, Fargate)   everything except /api/*
 (xxxx.cloudfront.net)                  (only accepts    └▶ api  (Fastify, Fargate)  /api/* and /health
                                         CloudFront)          │
                                                              ├─▶ RDS Postgres 16 (private subnets)
                                                              └─▶ S3 uploads bucket (photos, direct from the browser)
```

- **One address for web and API.** No CORS, no mixed content, and the web image has nothing environment-specific baked in.
- **No domain needed.** CloudFront's own `https://xxxx.cloudfront.net` address is a trusted certificate. A custom domain can be added later.
- **Secrets** (database URL, JWT secret, Twilio) live in Secrets Manager and are injected into the containers; none are in the repo or the images.
- **No stored AWS keys.** The API container gets S3 access from its IAM role (read/write on its own bucket only).
- **Region:** `ap-southeast-2` (Sydney). Everything is tagged `env=staging`.

Does **not** touch existing resources (the dev S3 bucket, SSO, etc.): staging has its own VPC, bucket, database and state.

## Rough cost

Roughly **US$70–80 per month** while running (load balancer ~$18, two small Fargate services ~$20, RDS micro ~$16, public IPv4 addresses ~$14, Secrets Manager and logs a few dollars). These are estimates from public list prices, not a quote; check the AWS pricing calculator. `terraform destroy` stops all of it.

## Before you start

- Docker running.
- AWS CLI v2 and your SSO login: `aws sso login --profile mechanicpulse`, then `aws sts get-caller-identity --profile mechanicpulse` should show the MechanicPulse account.
- **Terraform 1.10 or newer.** (`brew install hashicorp/tap/terraform`; if Homebrew complains about Xcode command-line tools, download the binary from https://developer.hashicorp.com/terraform/install instead.)

All commands run from the repo root unless a `cd` says otherwise.

## 1. One-time: a bucket for Terraform's state

Terraform remembers what it built in a state file. Keep it in a private S3 bucket so it survives your laptop:

```bash
export AWS_PROFILE=mechanicpulse
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=mechanicpulse-tfstate-staging-$ACCOUNT

aws s3api create-bucket --bucket $BUCKET --region ap-southeast-2 \
  --create-bucket-configuration LocationConstraint=ap-southeast-2
aws s3api put-bucket-versioning --bucket $BUCKET --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $BUCKET --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
echo $BUCKET
```

The state contains the generated database password and JWT secret, which is why the bucket is private, encrypted and versioned. **Never commit state or `backend.hcl`** (both are gitignored).

```bash
cd infra/staging
cp backend.hcl.example backend.hcl      # put the bucket name in
terraform init -backend-config=backend.hcl
```

## 2. Build the infrastructure (services off)

```bash
terraform plan  -var desired_count=0     # read it: everything should be a new resource
terraform apply -var desired_count=0
```

It takes 10–15 minutes (RDS and CloudFront are the slow parts). `desired_count=0` creates the services but starts no containers yet, because there are no images to run.

**The plan must show only things being created.** If it proposes to change or destroy anything, stop and ask.

## 3. Build and push the images

Images are built for ARM (`linux/arm64`): the Fargate tasks run on ARM, which is cheaper, and it matches an Apple-silicon Mac.

```bash
cd infra/staging
API=$(terraform output -raw ecr_api); WEB=$(terraform output -raw ecr_web)
cd ../..

aws ecr get-login-password --region ap-southeast-2 \
  | docker login --username AWS --password-stdin ${API%%/*}

docker build --platform linux/arm64 -f apps/api/Dockerfile -t ${API}:staging .
docker build --platform linux/arm64 -f apps/web/Dockerfile -t ${WEB}:staging .
docker push ${API}:staging
docker push ${WEB}:staging
```

The first build is slow (a few minutes); later ones reuse the cache.

## 4. Create the database tables and the first login

One-off containers run the same API image with a different command.

```bash
cd infra/staging
CLUSTER=$(terraform output -raw cluster)
FAMILY=$(terraform output -raw api_task_family)
SG=$(terraform output -raw task_security_group)
SUBNETS=$(terraform output -json task_subnets | python3 -c 'import sys,json;print(",".join(json.load(sys.stdin)))')
NET="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}"

run_task() {  # $1 = overrides JSON
  ARN=$(aws ecs run-task --cluster $CLUSTER --launch-type FARGATE --task-definition $FAMILY \
    --network-configuration "$NET" --overrides "$1" --query 'tasks[0].taskArn' --output text)
  aws ecs wait tasks-stopped --cluster $CLUSTER --tasks $ARN
  aws logs tail $(terraform output -raw api_log_group) --since 10m
}

# a) create the tables
run_task '{"containerOverrides":[{"name":"api","command":["node","dist/apps/api/src/scripts/migrate.js"]}]}'
# expect: "applying 0001_initial_schema.sql" then "done, 1 applied"

# b) create the workshop and the owner login (edit the values)
run_task '{"containerOverrides":[{"name":"api","command":["node","dist/apps/api/src/scripts/createMechanic.js"],
  "environment":[
    {"name":"WORKSHOP_NAME","value":"Your Workshop"},
    {"name":"WORKSHOP_PHONE","value":"+61390000000"},
    {"name":"MECHANIC_NAME","value":"Your Name"},
    {"name":"MECHANIC_EMAIL","value":"you@example.com"}]}]}'
# expect: "created owner …" and "generated password (shown once): …" — copy it now
```

Do **not** load `db/seed/dev_seed.sql` here: its logins all share the public password `password123`.

The password is generated in the container and printed in the log (CloudWatch), so it never appears in a command, your shell history, or the task's saved overrides. There is no change-password screen yet. Re-run (b) with a different email for each additional login.

## 5. Start it

```bash
cd infra/staging
terraform apply            # desired_count back to 1
terraform output site_url
```

Wait about two minutes, then:

```bash
curl -s $(terraform output -raw site_url)/health      # {"ok":true}
```

Open `site_url` on your phone and log in with the generated password.

If it doesn't come up, see "When it doesn't work" below.

## 6. Turn on real texts (Twilio)

Create `infra/staging/staging.auto.tfvars` (gitignored, never commit):

```hcl
sms_provider       = "twilio"
twilio_account_sid = "AC..."
twilio_auth_token  = "..."
twilio_from        = "+1..."     # or a Messaging Service SID (MG...)
```

`terraform apply`. The API restarts with the new settings, and delivery receipts work because the API now has a public address (`PUBLIC_API_URL` is set to `site_url` for you). Remember a Twilio **trial** account can only send Twilio's predefined messages (error 572006), so use an upgraded account for real texts. Details: `docs/product-decisions.md`, `docs/test-cases.md` (SMS section).

## Deploying a new version

```bash
# from the repo root, after merging to main
docker build --platform linux/arm64 -f apps/api/Dockerfile -t ${API}:staging . && docker push ${API}:staging
docker build --platform linux/arm64 -f apps/web/Dockerfile -t ${WEB}:staging . && docker push ${WEB}:staging

CLUSTER=$(terraform -chdir=infra/staging output -raw cluster)
aws ecs update-service --cluster $CLUSTER --service mechanicpulse-staging-api --force-new-deployment
aws ecs update-service --cluster $CLUSTER --service mechanicpulse-staging-web --force-new-deployment
```

If a release changes the database, run the migrate task from step 4a **before** the new API starts. A failed rollout rolls itself back (circuit breaker).

## When it doesn't work

| Symptom | Look at |
|---|---|
| `terraform apply` fails on a name that already exists | Something with that name was created by hand earlier; rename it or import it. Don't delete anything you didn't create. |
| Site shows 502/503 | `aws ecs describe-services --cluster $CLUSTER --services mechanicpulse-staging-api mechanicpulse-staging-web --query 'services[].events[:5]'`. Usually the image isn't pushed (step 3) or the task can't start. |
| Task stops straight away | `aws logs tail /ecs/mechanicpulse-staging-api --since 15m` (or `…-web`). A missing env var is printed at startup. |
| API can't connect to the database | Did step 4a run? The log will say. The database only accepts connections from the containers' security group. |
| Login fails with "Wrong email or password" | Step 4b not done, or the password was mistyped. |
| 403 "Forbidden" at the CloudFront address | The load balancer only answers requests that carry CloudFront's secret header; a 403 straight from the ALB address is expected. Use `site_url`. |
| Photos won't upload | The S3 bucket's CORS allows only `site_url`; you must be opening the site at exactly that address. |

## Tear down

```bash
# empty the uploads bucket first (Terraform won't delete a bucket with photos in it)
aws s3 rm s3://$(terraform -chdir=infra/staging output -raw uploads_bucket) --recursive
cd infra/staging && terraform destroy
```

RDS takes a final snapshot (`mechanicpulse-staging-final`) before it goes. Delete that by hand if you don't want it.

## Known gaps (deliberate for a proof of concept)

- **Database TLS is encrypted but not verified.** The API accepts RDS's certificate without checking it (`DATABASE_SSL=true`). Traffic stays inside the VPC. Bundle the RDS CA and verify before real customer data.
- **Containers have public IPs** (no NAT gateway, which would add ~US$45/month). Their security group only accepts the load balancer, and the database has no route to the internet.
- **Secrets are in the Terraform state** (private, encrypted, versioned bucket). Fine for staging; production should create them outside Terraform.
- **Deploys are manual** (build, push, force a redeploy). A GitHub Actions deploy using OIDC is the next step; it needs no repository secrets and no repo admin rights.
- **No custom domain, no WAF, no alarms.** CloudFront's default certificate and address are used.
- **One database instance, one Availability Zone**, 7-day backups.
- **Amplify Hosting** (the other option in `docs/product-decisions.md`) wasn't used: connecting it to GitHub needs admin rights on the repo, and Next.js 16 support on Amplify is unconfirmed. It can be revisited.

## For Madhavan's review

Built without Madhavan, so the things he'd want to look at:

- `infra/staging/` — everything created, in plain Terraform. Remote state in its own bucket; nothing shares state with existing resources.
- Why Fargate for both apps behind one CloudFront address (instead of Amplify for the web app): see the last bullet above and `docs/product-decisions.md`.
- The decisions above under "Known gaps" are his to tighten or accept.
- Whether to keep this as the staging shape, and what production should look like.
