/**
 * Limite de tentativas em memória (auditoria 2026-10-10).
 *
 * Para login e reconfirmação de senha: antes não havia NENHUM freio — tentar
 * senhas era de graça, e cada tentativa custa um scrypt (~16 MB) na VPS de 2
 * núcleos que também roda o WhatsApp dos clientes. Chave por IP e por e-mail,
 * janela deslizante simples. Em memória de propósito: um processo só em
 * produção (container único), e reiniciar zerar o contador é aceitável.
 */
const janelas = new Map<string, { inicio: number; n: number }>();

export function tentativaPermitida(chave: string, max: number, janelaMs: number): boolean {
  const agora = Date.now();
  const j = janelas.get(chave);
  if (!j || agora - j.inicio > janelaMs) {
    janelas.set(chave, { inicio: agora, n: 1 });
    if (janelas.size > 10_000) {
      for (const [k, v] of janelas) if (agora - v.inicio > janelaMs) janelas.delete(k);
    }
    return true;
  }
  j.n += 1;
  return j.n <= max;
}

/** IP de quem chamou, como o Traefik repassa. */
export function ipDaRequisicao(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  return (xff.split(',')[0] || req.headers.get('x-real-ip') || 'desconhecido').trim();
}

export const resposta429 = () =>
  Response.json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }, { status: 429 });
