import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),

  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  OPENROUTER_API_KEY: z.string().min(1),

  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.string().regex(/^\d+$/).optional(),
  MINIO_USE_SSL: z.enum(["true", "false"]).optional(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_REGION: z.string().min(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment");
}

export const env = parsed.data;
