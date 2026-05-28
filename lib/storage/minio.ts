import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

function resolveEndpoint(): string {
  const raw = env.MINIO_ENDPOINT;
  if (/^https?:\/\//i.test(raw)) return raw;
  const protocol = env.MINIO_USE_SSL === "true" ? "https" : "http";
  const port = env.MINIO_PORT ? `:${env.MINIO_PORT}` : "";
  return `${protocol}://${raw}${port}`;
}

const s3 = new S3Client({
  endpoint: resolveEndpoint(),
  region: env.MINIO_REGION,
  credentials: {
    accessKeyId: env.MINIO_ACCESS_KEY,
    secretAccessKey: env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

export function statementKey(userId: string, statementId: string) {
  return `users/${userId}/statements/${statementId}.pdf`;
}

export async function putStatementPdf(opts: {
  userId: string;
  statementId: string;
  body: Buffer;
}) {
  const Key = statementKey(opts.userId, opts.statementId);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.MINIO_BUCKET,
      Key,
      Body: opts.body,
      ContentType: "application/pdf",
    }),
  );
  return { bucket: env.MINIO_BUCKET, key: Key };
}

export async function getStatementPdf(opts: { bucket: string; key: string }) {
  const out = await s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }));
  const chunks: Buffer[] = [];
  for await (const c of out.Body as AsyncIterable<Buffer>) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function presignedStatementUrl(opts: { bucket: string; key: string }) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: opts.bucket, Key: opts.key }),
    { expiresIn: 300 },
  );
}
