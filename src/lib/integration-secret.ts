import { timingSafeEqual } from 'node:crypto';

/**
 * Autenticação das integrações máquina→máquina (Make/TLDV).
 *
 * Segredo compartilhado no header `x-onmid-secret` — não há sessão de browser
 * nesses caminhos. Extraído de `api/integrations/reuniao/route.ts`, que já
 * tinha uma cópia idêntica em `reuniao/resumo/route.ts`; a agenda seria a
 * terceira.
 *
 * Sem `MAKE_INTEGRATION_SECRET` configurado, a resposta é 503 e nada é
 * processado: falhar fechado é melhor do que ficar aberta porque alguém
 * esqueceu a variável de ambiente.
 */
export type ResultadoSegredo = 'ok' | 'sem-segredo' | 'negado';

export function conferirSegredoIntegracao(req: Request): ResultadoSegredo {
  const esperado = process.env.MAKE_INTEGRATION_SECRET;
  if (!esperado) return 'sem-segredo';
  const recebido = req.headers.get('x-onmid-secret') ?? '';
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // timingSafeEqual exige mesmo tamanho; testar o length antes vaza só o
  // tamanho do segredo, que não ajuda quem estiver adivinhando.
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'negado';
}

/** Resposta pronta para os dois casos de recusa. */
export function respostaSegredo(r: Exclude<ResultadoSegredo, 'ok'>): Response {
  return r === 'sem-segredo'
    ? Response.json({ ok: false, erro: 'integracao_nao_configurada' }, { status: 503 })
    : Response.json({ ok: false, erro: 'nao_autorizado' }, { status: 401 });
}
