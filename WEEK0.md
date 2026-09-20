# Week 0 — the upload spike

Goal: a photo taken on a phone lands in the S3 bucket. Nothing else.

This code gets thrown away. We are buying four numbers, not a codebase:

1. Compressed file size
2. Upload time on one bar of signal
3. Does it survive the phone locking mid-upload
4. Does it survive a tab reload

## Where the files go

Unzip into the repo root. It fills in:

```
packages/shared/types.ts     the contract both sides build against
apps/api/                    the presign server (Madhavan)
apps/spike/index.html        the camera page (Akash)
```

## Running the API

```
cd apps\api
copy .env.example .env
```

Edit `.env` and set `S3_BUCKET` to the real bucket name.

```
npm install
npm run dev
```

Check it:

```
curl http://localhost:3001/health
```

## Running the spike page

Any static server will do:

```
cd apps\spike
npx serve .
```

Open it on your laptop first at `http://localhost:3000`. Once that works end to end,
deploy both somewhere public — a phone cannot reach your laptop.

To point the page at a deployed API, open the browser console on the page and run:

```js
localStorage.setItem("api", "https://your-api-url.example.com");
```

Then reload.

## When it breaks

Almost every failure here is one of three things.

**CORS.** The browser blocks the PUT and the console says something about
Access-Control-Allow-Origin. Check the bucket CORS allows `PUT` and the origin the
page is served from.

**Content-Type mismatch.** The presigned URL is signed for a specific content type.
If the browser sends a different one, S3 returns 403. The page sends `blob.type`
and the API signs the same value — keep them in step.

**Expired URL.** The signed URL lasts 5 minutes. On a slow upload from a carpark
this can genuinely expire. If that happens, that is a finding, not a bug — write it
down, it changes the design.

## Field test

Once it works on wifi:

- Basement carpark, one bar. Time an upload.
- Lock the phone halfway through. Does it finish?
- Reload the tab mid-upload. What happens?
- Look at the compressed photo. Can you see a hairline crack in it?

Post the results in `docs/spike-results.md` and in the group.
