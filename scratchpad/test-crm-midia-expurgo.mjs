// Recompile: npx esbuild src/lib/crm-midia.ts --bundle --format=esm --platform=node \
//   --packages=external --alias:@=./src --outfile=scratchpad/build/crm-midia.mjs
//
// Exercita a função REAL com um Postgres de mentira em memória: o que importa
// aqui é QUEM é escolhido para apagar e se o arquivo some do disco.
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'expurgo-'));
process.env.MIDIA_DIR = dir;
const { expurgarMidia, DIAS_PADRAO, TETO_GB_PADRAO } = await import('./build/crm-midia.mjs');

let n = 0, falhas = 0;
const ok = (c, msg) => { n++; if (!c) { falhas++; console.error('  ✗ ' + msg); } };
const dias = d => new Date(Date.now() - d * 86400e3);

// Pool de mentira que entende as 4 consultas da função.
function poolFake(linhas) {
  const marcados = [];
  return {
    marcados,
    linhas,
    async query(sql, params) {
      if (/CREATE TABLE/i.test(sql)) return { rows: [] };
      if (/SUM\(bytes\)/i.test(sql)) {
        const b = linhas.filter(l => !l.expurgada_em).reduce((a, l) => a + l.bytes, 0);
        return { rows: [{ b: String(b) }] };
      }
      if (/UPDATE public\.crm_midia SET expurgada_em/i.test(sql)) {
        for (const t of params[0]) {
          marcados.push(t);
          const l = linhas.find(x => x.token === t);
          if (l) l.expurgada_em = new Date();
        }
        return { rows: [] };
      }
      if (/mime NOT LIKE 'audio\/%'/i.test(sql)) {
        const limite = Date.now() - Number(params[0]) * 86400e3;
        return { rows: linhas.filter(l => !l.expurgada_em && l.created_at.getTime() < limite && !l.mime.startsWith('audio/')) };
      }
      if (/ORDER BY created_at ASC/i.test(sql)) {
        return { rows: linhas.filter(l => !l.expurgada_em).sort((a, b) => a.created_at - b.created_at) };
      }
      throw new Error('consulta não prevista: ' + sql.slice(0, 60));
    },
  };
}

async function arquivoDe(nome) {
  const p = path.join(dir, nome);
  await fs.writeFile(p, 'x');
  return p;
}

// ── 1) o prazo POUPA áudio e apaga foto/vídeo/documento ──────────────────────
{
  const linhas = [
    { token: 'a'.repeat(32), arquivo: await arquivoDe('velho.jpg'), mime: 'image/jpeg', bytes: 300_000, created_at: dias(120), expurgada_em: null },
    { token: 'b'.repeat(32), arquivo: await arquivoDe('velho.ogg'), mime: 'audio/ogg',  bytes: 40_000,  created_at: dias(120), expurgada_em: null },
    { token: 'c'.repeat(32), arquivo: await arquivoDe('novo.jpg'),  mime: 'image/jpeg', bytes: 300_000, created_at: dias(10),  expurgada_em: null },
  ];
  const pool = poolFake(linhas);
  const r = await expurgarMidia(pool, { dias: 90, tetoGb: 999 });

  ok(r.porPrazo === 1, 'apaga só a foto velha (1), não as três');
  ok(pool.marcados.includes('a'.repeat(32)), 'a foto de 120 dias foi marcada');
  // ⚠️ o ponto da decisão do Matheus: áudio é 72% dos arquivos e custa ~42 KB
  ok(!pool.marcados.includes('b'.repeat(32)), 'ÁUDIO de 120 dias é POUPADO pelo prazo');
  ok(!pool.marcados.includes('c'.repeat(32)), 'foto de 10 dias fica');
  ok(!(await fs.stat(path.join(dir, 'velho.jpg')).catch(() => null)), 'arquivo da foto velha sumiu do disco');
  ok(Boolean(await fs.stat(path.join(dir, 'velho.ogg')).catch(() => null)), 'arquivo do áudio continua no disco');
  ok(r.bytesPorPrazo === 300_000, 'soma os bytes liberados');
}

// ── 2) o teto de espaço pega o mais antigo, aí SIM incluindo áudio ───────────
{
  const G = 1024 ** 3;
  const linhas = [
    { token: 'd'.repeat(32), arquivo: await arquivoDe('ant.ogg'), mime: 'audio/ogg',  bytes: 2 * G, created_at: dias(5), expurgada_em: null },
    { token: 'e'.repeat(32), arquivo: await arquivoDe('rec.jpg'), mime: 'image/jpeg', bytes: 1 * G, created_at: dias(1), expurgada_em: null },
  ];
  const pool = poolFake(linhas);
  const r = await expurgarMidia(pool, { dias: 90, tetoGb: 2 });

  ok(r.porPrazo === 0, 'nada vence o prazo aqui');
  ok(r.porEspaco === 1, 'o teto derruba exatamente 1 arquivo');
  // ⚠️ aqui o disco (compartilhado com a Evolution) vem antes do histórico
  ok(pool.marcados.includes('d'.repeat(32)), 'o MAIS ANTIGO sai primeiro, mesmo sendo áudio');
  ok(!pool.marcados.includes('e'.repeat(32)), 'o recente fica');
  ok(r.bytesDepois <= 2 * G, 'depois da faxina cabe no teto');
}

// ── 3) nada a fazer quando está tudo novo e dentro do teto ───────────────────
{
  const linhas = [{ token: 'f'.repeat(32), arquivo: await arquivoDe('ok.jpg'), mime: 'image/jpeg', bytes: 1000, created_at: dias(2), expurgada_em: null }];
  const pool = poolFake(linhas);
  const r = await expurgarMidia(pool, {});
  ok(r.porPrazo === 0 && r.porEspaco === 0, 'rodada sem nada a apagar não mexe em nada');
  ok(pool.marcados.length === 0, 'nenhuma linha marcada');
  ok(Boolean(await fs.stat(path.join(dir, 'ok.jpg')).catch(() => null)), 'arquivo intacto');
  ok(r.dias === DIAS_PADRAO && r.tetoGb === TETO_GB_PADRAO, 'usa 90 dias e 20 GB por padrão');
}

// ── 4) simulação não toca em nada ────────────────────────────────────────────
{
  const linhas = [{ token: 'g'.repeat(32), arquivo: await arquivoDe('sim.jpg'), mime: 'image/jpeg', bytes: 500, created_at: dias(200), expurgada_em: null }];
  const pool = poolFake(linhas);
  const r = await expurgarMidia(pool, { simulacao: true });
  ok(r.porPrazo === 1, 'a simulação CONTA o que seria apagado');
  ok(pool.marcados.length === 0, 'simulação não marca linha');
  ok(Boolean(await fs.stat(path.join(dir, 'sim.jpg')).catch(() => null)), 'simulação não apaga arquivo');
}

// ── 5) arquivo já sumido do disco não derruba a rodada ───────────────────────
{
  const linhas = [
    { token: 'h'.repeat(32), arquivo: path.join(dir, 'nao-existe.jpg'), mime: 'image/jpeg', bytes: 100, created_at: dias(200), expurgada_em: null },
    { token: 'i'.repeat(32), arquivo: await arquivoDe('existe.jpg'),    mime: 'image/jpeg', bytes: 100, created_at: dias(200), expurgada_em: null },
  ];
  const pool = poolFake(linhas);
  const r = await expurgarMidia(pool, {});
  ok(r.porPrazo === 2, 'segue adiante mesmo com arquivo faltando');
  ok(pool.marcados.length === 2, 'marca as duas linhas');
  ok(!(await fs.stat(path.join(dir, 'existe.jpg')).catch(() => null)), 'apaga a que existia');
}

// ── 6) limites de entrada ────────────────────────────────────────────────────
{
  const pool = poolFake([]);
  ok((await expurgarMidia(pool, { dias: -5 })).dias === 1, 'dias negativo vira 1 (nunca apaga tudo por engano)');
  ok((await expurgarMidia(pool, { dias: 99999 })).dias === 3650, 'dias absurdo é limitado');
  ok((await expurgarMidia(pool, { tetoGb: 0 })).tetoGb === 1, 'teto zero vira 1 GB');
}

await fs.rm(dir, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} de ${n} asserts FALHARAM` : `\n${n} asserts OK`);
process.exit(falhas ? 1 : 0);
