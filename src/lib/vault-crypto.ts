import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';

/**
 * Cifragem do Cofre de credenciais dos clientes.
 *
 * A coluna se chama `password_enc` desde sempre, mas NUNCA cifrou nada: a tela
 * gravava a senha crua e lia de volta. São credenciais dos CLIENTES (painéis,
 * hospedagem, redes sociais) em texto legível no banco.
 *
 * ⚠️ Chave em variável PRÓPRIA (`VAULT_KEY`), deliberadamente NÃO derivada do
 * SESSION_SECRET. Se dependesse dele, rotacionar a chave de sessão — coisa
 * rotineira e que já foi anunciada como segura — tornaria todo o Cofre
 * indecifrável de uma vez, sem volta.
 *
 * Comportamento sem `VAULT_KEY` configurada:
 *  - LEITURA do que já existe em texto puro continua funcionando (não quebra a
 *    tela nem esconde dado que a equipe precisa hoje);
 *  - ESCRITA nova é RECUSADA. Sem chave não há como cifrar, e gravar mais texto
 *    puro seria aumentar o problema que este arquivo existe para resolver.
 */

const PREFIXO = 'gcm.v1';
const ALGO = 'aes-256-gcm';

export function vaultKeyConfigurada(): boolean {
  const k = process.env.VAULT_KEY;
  return typeof k === 'string' && k.length >= 32;
}

/**
 * A chave da env vira 32 bytes por scrypt. O salt é fixo e derivado da própria
 * chave: precisamos que a mesma env produza sempre a mesma chave (senão nada
 * decifra), então salt aleatório por chamada está fora de questão aqui.
 */
function chave(): Buffer | null {
  const k = process.env.VAULT_KEY;
  if (!k || k.length < 32) return null;
  const salt = createHash('sha256').update(`onmid-vault-salt-v1:${k}`).digest().subarray(0, 16);
  return scryptSync(k, salt, 32);
}

/** Distingue valor já cifrado de texto puro legado. */
export function estaCifrado(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(`${PREFIXO}:`);
}

/**
 * Cifra. Devolve null quando não há chave — o caller DEVE tratar isso como
 * recusa de escrita, nunca como "grava em texto puro mesmo".
 */
export function cifrar(texto: string): string | null {
  const key = chave();
  if (!key) return null;
  const iv = randomBytes(12); // 96 bits, o tamanho recomendado pro GCM
  const c = createCipheriv(ALGO, key, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [PREFIXO, iv.toString('base64'), tag.toString('base64'), dados.toString('base64')].join(':');
}

export type Decifrado = {
  valor: string | null;
  /** 'puro' = legado ainda não migrado; 'ok' = decifrado; 'erro' = chave errada/dado corrompido. */
  estado: 'puro' | 'ok' | 'erro' | 'vazio';
};

/**
 * Decifra, aceitando os DOIS formatos.
 *
 * Chave errada não devolve lixo: o GCM valida a etiqueta de autenticação e a
 * decifragem falha, então retornamos `erro` e a tela mostra isso em vez de
 * exibir bytes aleatórios como se fossem a senha.
 */
export function decifrar(v: string | null | undefined): Decifrado {
  if (v == null || v === '') return { valor: null, estado: 'vazio' };
  if (!estaCifrado(v)) return { valor: v, estado: 'puro' };

  const key = chave();
  if (!key) return { valor: null, estado: 'erro' };

  const partes = v.split(':');
  if (partes.length !== 4) return { valor: null, estado: 'erro' };
  try {
    const iv = Buffer.from(partes[1], 'base64');
    const tag = Buffer.from(partes[2], 'base64');
    const dados = Buffer.from(partes[3], 'base64');
    const d = createDecipheriv(ALGO, key, iv);
    d.setAuthTag(tag);
    return { valor: Buffer.concat([d.update(dados), d.final()]).toString('utf8'), estado: 'ok' };
  } catch {
    return { valor: null, estado: 'erro' };
  }
}

/**
 * Prepara um valor para gravação.
 *
 * `{ ok: false }` significa "não grave" — sem chave configurada, a rota deve
 * devolver erro em vez de persistir texto puro.
 */
/**
 * Linha do Cofre pronta para a tela, com a senha já decifrada.
 *
 * Vive aqui e não na rota porque `route.ts` do App Router só pode exportar os
 * handlers HTTP — qualquer export extra quebra o validador de tipos do Next.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function linhaVaultPublica(r: any) {
  const d = decifrar(r.password_enc);
  return {
    id: r.id, title: r.title, url: r.url, login: r.login,
    password_enc: d.valor,
    // `estado` é obrigatório na resposta: sem ele, uma senha que não abriu
    // (chave errada) apareceria vazia, como se nunca tivesse existido.
    password_estado: d.estado,
    category: r.category, notes: r.notes,
    created_at: r.created_at, updated_at: r.updated_at,
    ...(r.client_id ? { client_id: r.client_id } : {}),
    ...(r.client_name ? { client_name: r.client_name } : {}),
  };
}

export function prepararParaGravar(texto: string | null | undefined): { ok: true; valor: string | null } | { ok: false; motivo: string } {
  if (texto == null || texto === '') return { ok: true, valor: null };
  const c = cifrar(texto);
  if (c === null) {
    return {
      ok: false,
      motivo: 'VAULT_KEY não configurada no servidor — o Cofre não grava senha sem cifragem.',
    };
  }
  return { ok: true, valor: c };
}
