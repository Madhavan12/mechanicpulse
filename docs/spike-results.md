# Week 0 spike results

What we set out to learn: can a photo taken on a phone reach S3 reliably,
small enough to be fast and sharp enough to show damage?

## Run 1 — 25 Sep 2026 (Madhavan)

**Setup:** iPhone, Safari, 4G (wifi off). The API ran on a laptop and was
exposed to the phone through a Cloudflare quick tunnel. Uploads went straight
from the phone to S3 in ap-southeast-2 using a presigned URL.

| # | Question | Result |
|---|---|---|
| 1 | Compressed size | Over **80% smaller** after the JPEG fix below. The first try was *bigger* than the original (1500 KB → 2784 KB). |
| 1b | Is fine detail still visible? | Not tested yet |
| 2 | Upload time on one bar | Not tested yet |
| 3 | Survives the phone locking mid-upload? | Not tested yet |
| 4 | Survives a tab reload mid-upload? | Not tested yet |

## Findings

**iPhone Safari can't encode WebP.** When the page asks the browser for
`image/webp`, Safari quietly returns a PNG. A PNG of a photo is larger than the
original JPEG, so "compression" made the file 86% bigger.
→ **Fixed:** the page now tries WebP, and falls back to JPEG when the browser
doesn't produce a WebP. The real app must check what it actually got, not just
what it asked for.

**CORS has to allow the page's origin.** The upload failed instantly with
"network dropped", with no progress. The browser had blocked the upload because the bucket's
CORS rule didn't allow the tunnel address.
→ **Fixed:** the bucket CORS now allows `https://*.trycloudflare.com` for the spike.
For the real app, list exact origins, never wildcards.

**"network dropped" is misleading.** An instant failure right after getting the
signed URL is almost always CORS, not the signal. A real signal drop fails
*partway*, after the progress bar has moved.

## Still to do

Tests 1b–4 need a weak-signal spot (basement carpark, lift lobby). Add the
numbers to a "Run 2" section here.
