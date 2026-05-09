import { Pool } from 'pg';

export function makeServerPool() {
  const password = process.env.SUPABASE_DB_PASSWORD;

  if (password) {
    return new Pool({
      host: 'aws-1-us-east-2.pooler.supabase.com',
      port: 6543,
      database: 'postgres',
      user: 'postgres.iremmorsgwiqrorzoihx',
      password,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString?.includes('iremmorsgwiqrorzoihx')) {
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: 'aws-1-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}
