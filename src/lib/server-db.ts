import { Pool } from 'pg';

export function makeServerPool() {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;

  if (connectionString) {
    // ⚠️ Banco na PRÓPRIA VPS (rede interna do docker) não fala SSL — o Postgres
    // oficial sobe sem certificado. Forçar `ssl` aqui derruba a conexão com
    // "The server does not support SSL connections". O tráfego não sai do host,
    // então texto puro na rede interna é aceitável; para qualquer host remoto
    // (Supabase e afins) o SSL continua obrigatório.
    const interno = /@(onmid-reports-db|localhost|127\.0\.0\.1|postgres)(:\d+)?\//.test(connectionString);
    return new Pool({
      connectionString,
      ssl: interno ? false : { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: 'aws-1-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.SUPABASE_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}
