import type { Pool } from 'pg';
import { cifrar, decifrar } from '@/lib/vault-crypto';
import { internalHeaders } from '@/lib/session';

// Importação diária do CRM Sorrifácil (sorrifaciloffice.com.br) para o Reports.
//
// O botão "Detalhes" dos cards Faturamento e Leads do painel do CRM NÃO abre
// tela: faz POST em /PainelSistema/DetalhesOffices e devolve o CSV direto
// (Content-Disposition: attachment). Então o servidor faz o mesmo caminho que
// uma pessoa faz à mão — login por formulário, os dois POSTs — sem navegador.
//
// A importação em si NÃO é reimplementada aqui: o CSV é entregue à MESMA rota
// da tela "Importar Planilha" (/api/integrations/spreadsheet?step=import), com
// o mapeamento de colunas fixo abaixo. Qualquer correção futura da importação
// (dedupe, datas, filtro de canal) vale automaticamente para esta rotina.

const BASE = 'https://sorrifaciloffice.com.br';
const K = 'sorrifacil_sync';

export type MapaClinica = { clinica: string; clientId: string; clientName: string };

export type SorrifacilConfig = {
  ativo: boolean;
  usuario: string;
  senhaCifrada: string | null;
  mapa: MapaClinica[];
};

export type ResultadoRelatorio = {
  tipo: 'Faturamento' | 'Leads';
  mes: string; // MM/AAAA
  linhas: number;
  ok: boolean;
  resultado?: Record<string, number>;
  descartadas_origem?: number;
  erro?: string;
};

export type ResultadoSync = {
  ok: boolean;
  iniciado_em: string;
  duracao_ms: number;
  relatorios: ResultadoRelatorio[];
  erro?: string;
};

// ── Critérios de importação (confirmados com o Matheus em 22/09/2026) ────────
// Faturamento = tipo Venda: data forçada em DATA FATURAMENTO (a rota já força,
// mas mandamos explícito) e SEM id de negócio — ORCAMENTO não é id no ledger
// (entrada e parcela são linhas distintas; usar o orçamento apagou R$ 43 mil).
// Leads = tipo Leads: SITUACAO em status E stage (sem os dois o agendamento não
// conta no funil), NUMERO ORCAMENTO como id ("-" já é tratado como sem id).
const COLUNAS = {
  Faturamento: {
    tipoPlanilha: 'venda',
    cols: {
      clinicColumn: 'CLINICA',
      dateColumn: 'DATA FATURAMENTO',
      revenueColumn: 'VALOR TOTAL FATURADO',
      nameColumn: 'PACIENTE',
      channelColumn: 'COMO NOS CONHECEU',
      paymentColumn: 'FORMA PAGAMENTO',
    },
  },
  Leads: {
    tipoPlanilha: 'lead',
    cols: {
      clinicColumn: 'CLINICA',
      dateColumn: 'DATA CADASTRO',
      nameColumn: 'NOME',
      phoneColumn: 'TELEFONE',
      channelColumn: 'COMO NOS CONHECEU',
      statusColumn: 'SITUACAO',
      stageColumn: 'SITUACAO',
      scheduledDateColumn: 'DATA AVALIACAO AGENDADA',
      budgetColumn: 'R$ ORCAMENTO',
      dealIdColumn: 'NUMERO ORCAMENTO',
    },
  },
} as const;

type TipoRelatorio = keyof typeof COLUNAS;

// ── Configuração (system_settings, senha cifrada com VAULT_KEY) ──────────────

async function ensureSettings(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.system_settings (
       key TEXT PRIMARY KEY, value TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT
     )`,
  ).catch(() => {});
}

async function lerJson<T>(pool: Pool, key: string): Promise<T | null> {
  await ensureSettings(pool);
  const { rows } = await pool.query(`SELECT value FROM public.system_settings WHERE key = $1`, [key]);
  if (!rows[0]?.value) return null;
  try { return JSON.parse(rows[0].value) as T; } catch { return null; }
}

async function gravarJson(pool: Pool, key: string, value: unknown, userId?: string | null) {
  await ensureSettings(pool);
  await pool.query(
    `INSERT INTO public.system_settings (key, value, updated_at, updated_by)
     VALUES ($1,$2,NOW(),$3)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW(), updated_by=EXCLUDED.updated_by`,
    [key, JSON.stringify(value), userId ?? null],
  );
}

export async function lerConfig(pool: Pool): Promise<SorrifacilConfig> {
  const c = await lerJson<Partial<SorrifacilConfig>>(pool, K);
  return {
    ativo: c?.ativo === true,
    usuario: c?.usuario ?? '',
    senhaCifrada: c?.senhaCifrada ?? null,
    mapa: Array.isArray(c?.mapa) ? c!.mapa.filter(m => m?.clinica && m?.clientId) : [],
  };
}

/**
 * `senha` undefined = mantém a gravada. Sem VAULT_KEY a senha NÃO é gravada em
 * texto puro — devolve erro (mesma regra do Cofre).
 */
export async function salvarConfig(
  pool: Pool,
  dados: { ativo?: boolean; usuario?: string; senha?: string; mapa?: MapaClinica[] },
  userId?: string | null,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const atual = await lerConfig(pool);
  let senhaCifrada = atual.senhaCifrada;
  if (typeof dados.senha === 'string' && dados.senha.length > 0) {
    const c = cifrar(dados.senha);
    if (!c) return { ok: false, erro: 'VAULT_KEY não configurada no servidor — a senha não pode ser guardada com segurança.' };
    senhaCifrada = c;
  }
  await gravarJson(pool, K, {
    ativo: dados.ativo ?? atual.ativo,
    usuario: (dados.usuario ?? atual.usuario).trim(),
    senhaCifrada,
    mapa: dados.mapa ?? atual.mapa,
  }, userId);
  return { ok: true };
}

export async function lerUltimaExecucao(pool: Pool): Promise<ResultadoSync | null> {
  return lerJson<ResultadoSync>(pool, `${K}_ultima`);
}

// ── CRM: login + download ────────────────────────────────────────────────────

function juntarCookies(res: Response, jar: Map<string, string>) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of lista) {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Login por formulário (UserName/Password). Devolve o cabeçalho Cookie da sessão. */
export async function loginSorrifacil(usuario: string, senha: string): Promise<string> {
  const jar = new Map<string, string>();
  // GET inicial: pega o cookie de sessão anônima que o ASP.NET espera no POST.
  const g = await fetch(`${BASE}/`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  juntarCookies(g, jar);

  const body = new URLSearchParams({ UserName: usuario, Password: senha, Teste: '' });
  const p = await fetch(`${BASE}/`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  juntarCookies(p, jar);

  // Sucesso = redirect para fora da tela de login. Login errado devolve 200
  // com o próprio formulário de novo.
  const destino = p.headers.get('location') ?? '';
  if (p.status < 300 || p.status >= 400 || destino === '/' || /login/i.test(destino)) {
    throw new Error('Login no CRM Sorrifácil recusado — confira usuário e senha.');
  }
  return cookieHeader(jar);
}

/** Baixa o CSV de um card (mesmo POST do botão "Detalhes", todas as clínicas). */
export async function baixarRelatorio(cookie: string, tipo: TipoRelatorio, mes: string): Promise<Buffer> {
  const body = new URLSearchParams({ tipoMeta: tipo, idOffice: '-1', dateBegin: mes, dateEnd: mes });
  const r = await fetch(`${BASE}/PainelSistema/DetalhesOffices`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
    body,
    signal: AbortSignal.timeout(90_000),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const inicio = buf.subarray(0, 200).toString('latin1');
  // Sessão expirada vira redirect/HTML — nunca importar isso como planilha.
  if (r.status !== 200 || !inicio.includes('CLINICA;')) {
    throw new Error(`CRM não devolveu a planilha de ${tipo} (${mes}) — HTTP ${r.status}.`);
  }
  return buf;
}

// ── Período ──────────────────────────────────────────────────────────────────

function hojeBRT(): { dia: number; mes: number; ano: number } {
  const [ano, mes, dia] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return { dia, mes, ano };
}

const mm = (m: number, a: number) => `${String(m).padStart(2, '0')}/${a}`;

/**
 * Sempre o mês atual. Nos 5 primeiros dias também o mês anterior: vendas e
 * status do fim do mês ainda mudam depois da virada, e sem essa passada o mês
 * fechado ficaria congelado no retrato do último dia. Reimportar é seguro — a
 * importação atualiza em vez de duplicar.
 */
export function mesesParaSincronizar(hoje = hojeBRT()): string[] {
  const meses = [mm(hoje.mes, hoje.ano)];
  if (hoje.dia <= 5) {
    const m = hoje.mes === 1 ? 12 : hoje.mes - 1;
    const a = hoje.mes === 1 ? hoje.ano - 1 : hoje.ano;
    meses.unshift(mm(m, a));
  }
  return meses;
}

// ── Importação via a rota canônica ───────────────────────────────────────────

/**
 * O CRM exporta em windows-1252 SEM BOM. Reencoda para UTF-8 COM BOM antes de
 * entregar à importação: assim o parser lê os acentos de forma determinística
 * e "São José" no CSV é exatamente o "São José" gravado no de-para — um
 * caractere trocado faria a clínica casar com zero linhas, em silêncio.
 */
export function csvParaUtf8(buf: Buffer): Buffer {
  const texto = new TextDecoder('windows-1252').decode(buf);
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto, 'utf8')]);
}

function linhasCsv(buf: Buffer): string[] {
  return new TextDecoder('windows-1252').decode(buf).split(/\r?\n/).filter(l => l.trim());
}

function appOrigin(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://reports.onmid.app')
    .trim().replace(/\/$/, '');
}

async function importar(buf: Buffer, tipo: TipoRelatorio, mes: string, mapa: MapaClinica[]) {
  const def = COLUNAS[tipo];
  const { gzipSync } = await import('node:zlib');
  const fd = new FormData();
  const nome = `Detalhamento${tipo}-${mes.replace('/', '-')}.csv.gz`;
  fd.append('file', new Blob([new Uint8Array(gzipSync(csvParaUtf8(buf)))]), nome);
  fd.append('mappings', JSON.stringify(mapa.map(m => ({ clinicValue: m.clinica, clientId: m.clientId, clientName: m.clientName }))));
  fd.append('tipoPlanilha', def.tipoPlanilha);
  for (const [campo, coluna] of Object.entries(def.cols)) fd.append(campo, coluna);

  const res = await fetch(`${appOrigin()}/api/integrations/spreadsheet?step=import`, {
    method: 'POST',
    headers: internalHeaders(),
    body: fd,
    signal: AbortSignal.timeout(240_000),
  });
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean; error?: string; results?: Record<string, number>; origem_descartadas?: number;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `Importação respondeu HTTP ${res.status}.`);
  return data;
}

/** Roda a rotina inteira e grava o resumo em system_settings. Nunca lança. */
export async function sincronizarSorrifacil(pool: Pool): Promise<ResultadoSync> {
  const inicio = Date.now();
  const out: ResultadoSync = { ok: false, iniciado_em: new Date().toISOString(), duracao_ms: 0, relatorios: [] };
  try {
    const cfg = await lerConfig(pool);
    const senha = decifrar(cfg.senhaCifrada).valor;
    if (!cfg.usuario || !senha) throw new Error('Usuário e senha do CRM não configurados.');
    if (cfg.mapa.length === 0) throw new Error('Nenhuma clínica mapeada para cliente do Reports.');

    const cookie = await loginSorrifacil(cfg.usuario, senha);
    for (const mes of mesesParaSincronizar()) {
      for (const tipo of ['Faturamento', 'Leads'] as const) {
        const item: ResultadoRelatorio = { tipo, mes, linhas: 0, ok: false };
        try {
          const buf = await baixarRelatorio(cookie, tipo, mes);
          item.linhas = Math.max(0, linhasCsv(buf).length - 1);
          const r = await importar(buf, tipo, mes, cfg.mapa);
          item.ok = true;
          item.resultado = r.results;
          item.descartadas_origem = r.origem_descartadas;
        } catch (e) {
          item.erro = e instanceof Error ? e.message : String(e);
        }
        out.relatorios.push(item);
      }
    }
    out.ok = out.relatorios.every(r => r.ok);
  } catch (e) {
    out.erro = e instanceof Error ? e.message : String(e);
  }
  out.duracao_ms = Date.now() - inicio;
  await gravarJson(pool, `${K}_ultima`, out).catch(() => {});
  return out;
}

/** Lista as clínicas presentes no CRM (para a tela montar o de-para). */
export async function listarClinicas(usuario: string, senha: string): Promise<string[]> {
  const cookie = await loginSorrifacil(usuario, senha);
  const [mes] = mesesParaSincronizar().slice(-1);
  const buf = await baixarRelatorio(cookie, 'Leads', mes);
  const linhas = linhasCsv(buf);
  const cab = linhas[0].split(';');
  const i = cab.indexOf('CLINICA');
  return [...new Set(linhas.slice(1).map(l => l.split(';')[i]?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
