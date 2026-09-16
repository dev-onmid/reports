/**
 * Memoização de "garantir schema" — o antídoto do incidente de 15–16/09/2026.
 *
 * ⚠️ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` NÃO é barato só porque não muda nada:
 * ele pede lock ACCESS EXCLUSIVE na tabela mesmo quando é no-op. Numa rota de caminho
 * quente (o CRM faz poll a cada 3s; o webhook roda a cada mensagem) as chamadas
 * concorrentes se enfileiram nesse lock, e basta uma escrita longa na mesma tabela
 * — o `sync-cron` importando leads, por exemplo — para a fila inteira estourar.
 *
 * Medido em 16/09: `GET /api/crm` verificava 25 colunas de `crm_leads` por request;
 * a rota passou a estourar 60s para TODOS os clientes (board vazio) e o Postgres
 * registrou `deadlock detected` em `crm_leads`. A query de leads em si levava 4ms.
 *
 * Use `memoizarSchema` em toda função que roda DDL fora de migração. O cache é por
 * processo: roda uma vez, e um redeploy reexecuta.
 */
export function memoizarSchema<P>(fn: (pool: P) => Promise<void>): (pool: P) => Promise<void> {
  let pronto: Promise<void> | null = null;
  return (pool: P) => {
    // ⚠️ Cache limpo no erro: senão uma falha transitória de rede congelaria o schema
    // desatualizado pelo resto da vida do processo.
    // ⚠️ O pool é o da PRIMEIRA chamada e some junto com ela (cada request cria e fecha
    // o seu). Isso é seguro porque a promise já resolveu quando o pool fecha — mas é a
    // razão de o schema nunca poder ser "revalidado" com um pool guardado em global.
    pronto ??= fn(pool).catch(err => {
      pronto = null;
      throw err;
    });
    return pronto;
  };
}

/**
 * Variante por chave — para schema que depende de argumento (por cliente, por conta).
 * ⚠️ O mapa é `Map`, não objeto: chave vinda de request nunca deve encostar em
 * `Object.prototype`.
 */
export function memoizarSchemaPorChave<T extends string>(
  fn: (chave: T) => Promise<void>,
): (chave: T) => Promise<void> {
  const cache = new Map<T, Promise<void>>();
  return chave => {
    let p = cache.get(chave);
    if (!p) {
      p = fn(chave).catch(err => {
        cache.delete(chave);
        throw err;
      });
      cache.set(chave, p);
    }
    return p;
  };
}
