// Dummy values so modules that read env at import time (e.g. the S3 client
// in routes/media.ts) don't exit the process during tests. Tests for login
// never exercise the S3 path, so these never need to be real.
process.env.S3_BUCKET ??= "test-bucket";
process.env.AWS_REGION ??= "ap-southeast-2";
// Only a fallback for anything that imports the real db module unmocked —
// login tests mock ../db directly and never touch a real database.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
