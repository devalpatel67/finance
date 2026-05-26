// Inject baseline env vars for unit tests so `lib/env.ts` validates.
// These are not real credentials — unit tests should not hit external services.
const defaults: Record<string, string> = {
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  OPENROUTER_API_KEY: "test-openrouter-key",
  MINIO_ENDPOINT: "http://localhost:9000",
  MINIO_ACCESS_KEY: "test-access-key",
  MINIO_SECRET_KEY: "test-secret-key",
  MINIO_BUCKET: "test-bucket",
  MINIO_REGION: "us-east-1",
};

for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}
