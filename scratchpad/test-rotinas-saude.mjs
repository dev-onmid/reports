// Recompilar antes de rodar:
//   npx esbuild src/lib/rotinas-saude.ts --bundle --format=esm --platform=node --external:pg --outfile=scratchpad/build/rotinas-saude.mjs
import { avaliarRotina, lerResposta, limiteAtraso, minutosDesde, ROTINAS, PESO_ESTADO, humanizar } from './build/rotinas-saude.mjs';
import assert from 'node:assert/strict';

let n = 0;
const t = (nome, fn) => { fn(); n++; };

const AGORA = new Date('2026-10-06T21:00:00Z');
const atras = (min) => new Date(AGORA.getTime() - min * 60_000);

const defMinuto = { id: 'x', nome: 'X', grupo: 'envios', oQueFaz: '', cadencia: 'a cada minuto', intervaloMin: 1, arquivo: 'x.last' };
const defDiaria = { id: 'd', nome: 'D', grupo: 'crm', oQueFaz: '', cadencia: 'todo dia', intervaloMin: 1440, arquivo: 'd.last' };
const rastro = { rotulo: 'último pedido', sql: '', toleranciaMin: 12 * 60 };

// ── lerResposta ──────────────────────────────────────────────────────────────
t('corpo vazio NÃO é sucesso', () => {
  // Foi exatamente assim que 5 crons passaram despercebidos: arquivo 0 byte.
  assert.equal(lerResposta('').ok, false);
  assert.equal(lerResposta('   \n').ok, false);
  assert.match(lerResposta('').resumo, /vazia/);
});
t('arquivo ausente é ausência de leitura, não erro de rota', () => {
  assert.deepEqual(lerResposta(null), { ok: false, resumo: null });
});
t('ok:true vira sucesso com resumo dos contadores', () => {
  const r = lerResposta('{"ok":true,"processados":12,"enviados":3}');
  assert.equal(r.ok, true);
  assert.match(r.resumo, /processados: 12/);
  assert.match(r.resumo, /enviados: 3/);
});
t('ok:false é erro e carrega o motivo', () => {
  const r = lerResposta('{"ok":false,"erro":"token recusado"}');
  assert.equal(r.ok, false);
  assert.equal(r.resumo, 'token recusado');
});
t('{"error":...} do proxy é erro', () => {
  const r = lerResposta('{"error":"Não autenticado."}');
  assert.equal(r.ok, false);
  assert.equal(r.resumo, 'Não autenticado.');
});
t('ok:true sem contador ainda é sucesso', () => {
  assert.deepEqual(lerResposta('{"ok":true}'), { ok: true, resumo: 'ok' });
});
t('HTML de erro do proxy não passa por sucesso', () => {
  assert.equal(lerResposta('<html><body>502 Bad Gateway').ok, false);
});
t('texto do curl com timeout é erro', () => {
  assert.equal(lerResposta('curl: (28) Operation timed out').ok, false);
});
t('texto neutro não-JSON não é acusado de erro', () => {
  assert.equal(lerResposta('pronto').ok, true);
});
t('resumo é cortado para não estourar a tela', () => {
  assert.ok(lerResposta(JSON.stringify({ error: 'x'.repeat(900) })).resumo.length <= 200);
});

// ── limiteAtraso ─────────────────────────────────────────────────────────────
t('rotina de minuto tem folga generosa (flock segura a próxima)', () => {
  // 3× 1 min = 3 min seria alarme falso toda vez que uma execução demora.
  assert.equal(limiteAtraso(1), 21);
});
t('rotina de 15 min alarma só depois de 45', () => assert.equal(limiteAtraso(15), 45));
t('rotina diária alarma só depois de 3 dias', () => assert.equal(limiteAtraso(1440), 4320));

// ── avaliarRotina ────────────────────────────────────────────────────────────
t('sem arquivo = sem leitura, nunca "parado"', () => {
  // Diretório não montado não pode virar 25 alarmes falsos.
  const r = avaliarRotina(defMinuto, { execucaoEm: null, corpo: null, rastroEm: null }, AGORA);
  assert.equal(r.estado, 'sem_leitura');
  assert.equal(r.ultimaExecucao, null);
});
t('sem leitura mas com rastro recente diz que está produzindo', () => {
  // Rotina nova: o .last só nasce na primeira passada do cron.
  const r = avaliarRotina({ ...defDiaria, rastro }, { execucaoEm: null, corpo: null, rastroEm: atras(120) }, AGORA);
  assert.equal(r.estado, 'sem_leitura');
  assert.match(r.motivo, /está produzindo/);
});
t('sem leitura e sem rastro recente não inventa diagnóstico', () => {
  const r = avaliarRotina({ ...defDiaria, rastro }, { execucaoEm: null, corpo: null, rastroEm: atras(40 * 60) }, AGORA);
  assert.equal(r.estado, 'sem_leitura');
  assert.match(r.motivo, /Ainda sem leitura/);
});
t('execução velha = parado, com o tempo no motivo', () => {
  const r = avaliarRotina(defMinuto, { execucaoEm: atras(600), corpo: '{"ok":true}', rastroEm: AGORA }, AGORA);
  assert.equal(r.estado, 'parado');
  assert.match(r.motivo, /10 h/);
});
t('parado VENCE resposta boa — cron morto com último corpo ok', () => {
  // O arquivo guarda a última resposta boa para sempre; sem esta precedência,
  // cron morto apareceria como saudável.
  const r = avaliarRotina(defDiaria, { execucaoEm: atras(10 * 1440), corpo: '{"ok":true,"total":5}', rastroEm: atras(5) }, AGORA);
  assert.equal(r.estado, 'parado');
});
t('rodando + resposta de erro = erro', () => {
  const r = avaliarRotina(defMinuto, { execucaoEm: atras(1), corpo: '{"ok":false,"erro":"instância caiu"}', rastroEm: AGORA }, AGORA);
  assert.equal(r.estado, 'erro');
  assert.match(r.motivo, /instância caiu/);
});
t('rodando + corpo vazio = erro (o caso dos 5 arquivos de 0 byte)', () => {
  const r = avaliarRotina(defDiaria, { execucaoEm: atras(60), corpo: '', rastroEm: atras(60) }, AGORA);
  assert.equal(r.estado, 'erro');
});
t('rodando + rastro recente = ok', () => {
  const r = avaliarRotina({ ...defDiaria, rastro }, { execucaoEm: atras(30), corpo: '{"ok":true}', rastroEm: atras(20) }, AGORA);
  assert.equal(r.estado, 'ok');
  assert.equal(r.rastroRotulo, 'último pedido');
});
t('rodando + rastro velho em rotina que DEVE produzir = atenção', () => {
  // É o caso do Cardápio Web: cron de hora em hora, pedido parou.
  const r = avaliarRotina({ ...defDiaria, rastro }, { execucaoEm: atras(30), corpo: '{"ok":true}', rastroEm: atras(20 * 60) }, AGORA);
  assert.equal(r.estado, 'atencao');
  assert.match(r.motivo, /último pedido/);
});
t('rodando + rastro velho em rotina ociosa = ocioso, não alarme', () => {
  // Disparo sem campanha ativa não é defeito.
  const r = avaliarRotina({ ...defMinuto, ocioso: true, rastro }, { execucaoEm: atras(1), corpo: '{"ok":true}', rastroEm: atras(40 * 60) }, AGORA);
  assert.equal(r.estado, 'ocioso');
  assert.match(r.motivo, /Sem trabalho/);
});
t('rotina ociosa que NUNCA produziu também é ocioso', () => {
  const r = avaliarRotina({ ...defMinuto, ocioso: true, rastro }, { execucaoEm: atras(1), corpo: '{"ok":true}', rastroEm: null }, AGORA);
  assert.equal(r.estado, 'ocioso');
  assert.match(r.motivo, /nunca/);
});
t('rotina sem rastro declarado só depende da execução', () => {
  const r = avaliarRotina(defMinuto, { execucaoEm: atras(2), corpo: '{"ok":true}', rastroEm: null }, AGORA);
  assert.equal(r.estado, 'ok');
  assert.equal(r.rastroRotulo, null);
});

// ── catálogo ─────────────────────────────────────────────────────────────────
t('nenhum id repetido', () => {
  assert.equal(new Set(ROTINAS.map(r => r.id)).size, ROTINAS.length);
});
t('nenhum arquivo .last repetido', () => {
  // Dois crons gravando no mesmo arquivo faria um mascarar o outro.
  assert.equal(new Set(ROTINAS.map(r => r.arquivo)).size, ROTINAS.length);
});
t('todo arquivo termina em .last', () => {
  for (const r of ROTINAS) assert.match(r.arquivo, /\.last$/, r.id);
});
t('todo grupo declarado existe na lista de grupos', () => {
  const ok = new Set(['crm', 'integracoes', 'anuncios', 'envios', 'relatorios']);
  for (const r of ROTINAS) assert.ok(ok.has(r.grupo), `${r.id}: ${r.grupo}`);
});
t('tolerância do rastro é sempre maior que o intervalo', () => {
  // Tolerância menor que a cadência acusaria atraso em rotina saudável.
  for (const r of ROTINAS) if (r.rastro) assert.ok(r.rastro.toleranciaMin > r.intervaloMin, r.id);
});
t('todo SQL de rastro devolve a coluna t', () => {
  for (const r of ROTINAS) if (r.rastro) assert.match(r.rastro.sql, /\bAS t\b/, r.id);
});
t('SQL de rastro é somente leitura', () => {
  for (const r of ROTINAS) {
    if (!r.rastro) continue;
    assert.match(r.rastro.sql.trim(), /^SELECT /i, r.id);
    assert.doesNotMatch(r.rastro.sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i, r.id);
  }
});
t('25 rotinas mapeadas da crontab', () => assert.equal(ROTINAS.length, 25));

// ── ordenação ────────────────────────────────────────────────────────────────
t('problema aparece antes de saudável', () => {
  assert.ok(PESO_ESTADO.parado < PESO_ESTADO.erro);
  assert.ok(PESO_ESTADO.erro < PESO_ESTADO.atencao);
  assert.ok(PESO_ESTADO.atencao < PESO_ESTADO.ok);
  assert.ok(PESO_ESTADO.ocioso < PESO_ESTADO.ok);
});

// ── helpers ──────────────────────────────────────────────────────────────────
t('minutosDesde aceita Date e ISO, e recusa lixo', () => {
  assert.equal(minutosDesde(atras(90), AGORA), 90);
  assert.equal(minutosDesde(atras(90).toISOString(), AGORA), 90);
  assert.equal(minutosDesde('nao-e-data', AGORA), null);
  assert.equal(minutosDesde(null, AGORA), null);
});
t('humanizar vira min, h e dias', () => {
  assert.equal(humanizar(0.2), 'menos de 1 min');
  assert.equal(humanizar(45), '45 min');
  assert.equal(humanizar(120), '2 h');
  assert.equal(humanizar(1440), '1 dia');
  assert.equal(humanizar(4320), '3 dias');
});

console.log(`✅ ${n} asserts`);
