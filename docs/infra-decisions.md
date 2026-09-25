# Decisions

One entry per choice or trap worth remembering. Newest at the bottom.
Add to this whenever you spend more than twenty minutes on something
that wasn't obvious from the error message.

---

## 2026-09-20 — Stale AWS credentials in `~/.aws/config` broke presigning

**What happened.** The API's presign endpoint returned URLs that S3 rejected
with `SignatureDoesNotMatch`. The error pointed at "check your key and
signing method" — which sent us looking at the wrong thing, because the
IAM user and access key were correct.

**Root cause.** `~/.aws/config` had a full `[default]` credentials block —
access key, secret, *and a session token* — written there by the AWS
Toolkit for JetBrains plugin at some point in the past, from a completely
different AWS account. The AWS CLI resolves credentials from
`~/.aws/credentials` first and ignored it, which is why `aws s3 cp` worked
fine from the terminal. The Node SDK resolves the two files differently and
picked up the stale block, mixing a long-lived key with someone else's
session token. Signature mismatch, every time.

**How we found it.** `aws configure list` showed the CLI using the right
key. The giveaway was the presigned URL itself containing
`X-Amz-Security-Token` — a parameter that only appears with *temporary*
credentials (`ASIA...` keys), never with a permanent IAM user key
(`AKIA...`). That mismatch is what to check first next time this error
shows up.

**Fix.** Credentials belong only in `~/.aws/credentials`. `~/.aws/config`
should hold settings (`region`, `output`) under `[default]`, nothing else.
Deleted the stray block.

**If you hit `SignatureDoesNotMatch` or a 400 with no useful message:**
run `aws configure list` and check the `Type` column. If it says anything
other than `shared-credentials-file` for the access key, something else is
injecting credentials — check `~/.aws/config` for a `[default]` block with
`aws_session_token` in it, and check for `credential_process` or SSO
entries too.

---

## 2026-09-20 — Presigned upload URLs need `WHEN_REQUIRED` checksum mode

**What happened.** After fixing the credentials above, uploads still
failed with a plain `400` and no useful body visible in the browser.

**Root cause.** Recent versions of the AWS SDK for JavaScript add an
`x-amz-checksum-crc32` parameter to presigned URLs by default. That
parameter is included in the signature. A plain browser `PUT` (via `fetch`
or `XMLHttpRequest`) has no idea it's supposed to send a matching checksum
header, so the signature S3 recomputes doesn't match what was signed.

This is a known SDK v3 behavior change, not something specific to us.

**Fix.** Set the checksum calculation mode to `WHEN_REQUIRED` — either on
the client:

```ts
const s3 = new S3Client({
  region: REGION,
  requestChecksumCalculation: "WHEN_REQUIRED",
});
```

or via environment variable, which is more reliable across SDK versions:

```
AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
```

**How to tell this is your problem:** the presigned URL contains
`x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm` as query
parameters. If those are present and you're uploading from a browser,
this is why.

**Don't debug this by opening the presigned URL in a browser address
bar** — that sends a GET, and the URL is signed for a PUT. It will always
fail with a *different* signature error that has nothing to do with the
actual bug. Test with the real upload flow, or with `curl -X PUT`.

---

## Where AWS credentials live for this project

*Updated 2026-09-25: moved to a new AWS account after losing access to the old one.*

- **New AWS account.** The root login is used for emergencies only, with MFA on, and its
  recovery details are shared between two people. Losing sole access is what forced the move.
- **People sign in with IAM Identity Center (SSO), not IAM users.** Each person has
  their own login and MFA. The group `mechanicpulse-devs` has `AdministratorAccess`.
- **No long-lived access keys on laptops.** `aws sso login --profile mechanicpulse`
  gives 8-hour keys, and the API picks them up through `AWS_PROFILE=mechanicpulse` in `.env`.
- **Deployed services will use an IAM role**, not keys.
- `.env` is gitignored. Keep it that way.
- Setup steps for new people: `docs/aws-setup.md`.
