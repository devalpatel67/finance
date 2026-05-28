import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { MinioContainer, StartedMinioContainer } from "@testcontainers/minio";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";

export type TestEnv = {
  pg: StartedPostgreSqlContainer;
  minio: StartedMinioContainer;
  databaseUrl: string;
  s3: { endpoint: string; accessKey: string; secretKey: string; bucket: string };
  stop: () => Promise<void>;
};

export async function bootstrap(): Promise<TestEnv> {
  const accessKey = "minioadmin";
  const secretKey = "minioadmin";
  const bucket = "finance-test";

  const [pg, minio] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("finance_test")
      .withUsername("finance")
      .withPassword("finance")
      .start(),
    new MinioContainer("minio/minio:latest")
      .withUsername(accessKey)
      .withPassword(secretKey)
      .start(),
  ]);

  const databaseUrl = pg.getConnectionUri();
  const endpoint = minio.getConnectionUrl().startsWith("http")
    ? minio.getConnectionUrl()
    : `http://${minio.getConnectionUrl()}`;

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migrationDb = drizzle(pool);
    await migrate(migrationDb, { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }

  const s3 = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  s3.destroy();

  return {
    pg,
    minio,
    databaseUrl,
    s3: { endpoint, accessKey, secretKey, bucket },
    stop: async () => {
      await Promise.allSettled([pg.stop(), minio.stop()]);
    },
  };
}
