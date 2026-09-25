# AWS setup: getting access to MechanicPulse

**For:** anyone joining the project (Akash first)
**Time:** about 20 minutes
**Updated:** 25 Sep 2026

## What changed

We lost access to the old AWS account, so the project now runs in a **new AWS account**.
We also changed how people sign in:

| Before | Now |
|---|---|
| IAM user with a permanent access key in `~/.aws/credentials` | **IAM Identity Center (SSO)**: you sign in through a browser, and your keys expire after 8 hours |
| One shared account login | Everyone has their own login with MFA |

Why: permanent keys can leak, and old keys left in `~/.aws` caused the
`SignatureDoesNotMatch` bug in week 0 (see `docs/decisions.md`). With SSO, no
long-lived keys are stored on your laptop.

The code hasn't changed. The only differences are two lines in `apps/api/.env`.

## Key details

| Thing | Value |
|---|---|
| AWS access portal (SSO start URL) | `https://d-97679e0edb.awsapps.com/start` |
| SSO region | `ap-southeast-2` (Sydney) |
| Bucket | `mechanicpulse-spike-madhavan-2026` |
| CLI profile name | `mechanicpulse` |
| Your permission | `AdministratorAccess`, through the `mechanicpulse-devs` group |

---

## Step 1: Accept your invite

Madhavan has added you as a user in IAM Identity Center.

1. Look for an email titled **"Invitation to join AWS IAM Identity Center"**. Check spam too.
   The link expires after 7 days. If it has expired, ask Madhavan to resend it.
2. Click **Accept invitation** and set your password.
3. **Register MFA** when asked. Choose *Authenticator app* and scan the QR code with
   Google Authenticator or Microsoft Authenticator.
4. The access portal opens and shows the MechanicPulse account. Click it, then click
   **Management console** under `AdministratorAccess`. If the console opens and the top right
   shows `AdministratorAccess/<your-username>`, your access works.

From now on, always sign in to the AWS console through the portal URL above.

## Step 2: Install AWS CLI v2

SSO needs **version 2** of the CLI.

```
aws --version
```

If it shows `aws-cli/2.x`, go to step 3. If not, install version 2:

- **Windows:** `msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi`, then open a new terminal.
- **macOS:** download and run https://awscli.amazonaws.com/AWSCLIV2.pkg

## Step 3: Move any old AWS keys out of the way

If you've used AWS on this laptop before, old keys in `~/.aws` can override your new
login and cause signature errors. Rename the folder so the old keys stay as a backup
but aren't used:

- **Windows (Command Prompt):** `ren "%USERPROFILE%\.aws" ".aws-old"`
- **Windows (PowerShell):** `Rename-Item "$HOME\.aws" ".aws-old"`
- **macOS / Linux:** `mv ~/.aws ~/.aws-old`

If it says the folder doesn't exist, that's fine.

## Step 4: Connect the CLI with SSO

```
aws configure sso
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| SSO session name | `mechanicpulse` |
| SSO start URL | `https://d-97679e0edb.awsapps.com/start` |
| SSO region | `ap-southeast-2` |
| SSO registration scopes | press Enter |

A browser opens. Sign in, enter your MFA code, and click **Allow**. Back in the terminal:

| Prompt | Answer |
|---|---|
| Account / role | the MechanicPulse account, `AdministratorAccess` (picked automatically if it's the only one) |
| Default client Region | `ap-southeast-2` |
| CLI default output format | `json` |
| Profile name | `mechanicpulse` (type this in place of the suggested default) |

## Step 5: Test it

```
aws sts get-caller-identity --profile mechanicpulse
aws s3 ls --profile mechanicpulse
```

- The first command should show an `Arn` ending in
  `assumed-role/AWSReservedSSO_AdministratorAccess_.../<your-username>`
- The second should list `mechanicpulse-spike-madhavan-2026`

## Step 6: Set up the repo

```
git clone https://github.com/Madhavan12/mechanicpulse.git
cd mechanicpulse/apps/api
```

If you already have the repo, run `git pull` in it.

Create your `.env` from the example:

- **Windows:** `copy .env.example .env`
- **macOS / Linux:** `cp .env.example .env`

It should contain:

```
S3_BUCKET=mechanicpulse-spike-madhavan-2026
AWS_REGION=ap-southeast-2
PORT=3001
AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
AWS_PROFILE=mechanicpulse
```

**Never commit `.env`, and never put access keys in it.** The SDK gets your keys from the
SSO login through `AWS_PROFILE`.

## Step 7: Run it and upload a photo

Use three terminals and keep the first two running.

**Terminal 1: API**
```
cd apps/api
npm install
npm run dev
```
Wait for: `API on :3001  bucket=mechanicpulse-spike-madhavan-2026  region=ap-southeast-2`

**Terminal 2: spike page**
```
cd apps/spike
npx serve .
```
It must be on **port 3000**. The bucket's CORS rule only allows `http://localhost:3000`.

**Terminal 3: checks**
```
curl http://localhost:3001/health
```

Open http://localhost:3000, take or pick a photo, and it should say
**"Uploaded. Check the bucket."** Then confirm the file is in S3:

```
aws s3 ls s3://mechanicpulse-spike-madhavan-2026/spike/ --recursive --profile mechanicpulse
```

## Every day

Your login lasts 8 hours. Before you start work, run:

```
aws sso login --profile mechanicpulse
```

---

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `Token has expired and refresh failed` / `The SSO session has expired` | 8-hour login ran out | `aws sso login --profile mechanicpulse`, then restart `npm run dev` |
| Page says **Failed to fetch** | The API isn't running | Check Terminal 1; `curl http://localhost:3001/health` should reply |
| Browser console mentions **CORS** | Page isn't on `localhost:3000` | Stop other things using port 3000, then rerun `npx serve .` |
| **S3 returned 403** / `SignatureDoesNotMatch` | Old keys are being used, or the content type doesn't match | Check step 3. Run `aws configure list --profile mechanicpulse`: the Type column should say `sso` |
| Plain **400** from S3 | `AWS_REQUEST_CHECKSUM_CALCULATION` is missing | Make sure it's in `.env` (see `docs/decisions.md`) |
| `S3_BUCKET is not set` | No `.env` file | Do step 6 |
| Page shows a different API URL | Leftover setting in the browser | F12 → Console → `localStorage.removeItem("api")` → reload |

Stuck? Send Madhavan the exact error text or a screenshot.

---

## For admins: adding a new teammate

1. Sign in through the access portal.
2. **IAM Identity Center → Users → Add user**: username, their email, and "send an email with password setup instructions".
3. Add them to the group **`mechanicpulse-devs`**. The group already has `AdministratorAccess` on the account.
4. Send them this doc.

To remove someone, delete their user in IAM Identity Center. Their access stops within
the hour, and there are no leftover keys to revoke.

## Account notes

- Region for everything: **ap-southeast-2 (Sydney)**.
- The root login is for emergencies only. Its MFA and recovery details are shared between
  two people, so we can't lose access to the account again.
- There's a budget alert on the account, so an unexpected bill shows up by email.
