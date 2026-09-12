// Testes do mapeamento lead → negócio do SULTS.
//
// Compilar antes (a lib é TS e o Node não lê TS direto):
//   npx tsc src/lib/sults.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   for f in sults importacao-origem; do mv -f scratchpad/build/$f.js scratchpad/build/$f.mjs 2>/dev/null; done
//   sed -i '' "s#'@/lib/importacao-origem'#'./importacao-origem.mjs'#" scratchpad/build/sults.mjs
//   node scratchpad/test-sults.mjs

import assert from 'node:assert';
import {
  montarPayloadSults, telefoneSults, temperaturaSults, origemSults,
  descricaoAtribuicao, tituloNegocio,
  normalizarNegocio, diffNegocio, entradaNaEtapa, agregarCatalogo,
} from './build/sults.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const CONF = {
  responsavelId: 12, etapaId: 25, origemId: 2, campanhaId: 7,
  mapaOrigem: { 'meta lead ads': 9, 'landing page': 4 },
};

const LEAD = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  nome: 'Maria Souza', numero: '5534999998888', email: 'maria@x.com',
  canal: 'Meta Lead Ads', origin: 'paid', temperatura: 'Quente', valor_rs: 3500,
  regiao_cidade: 'Uberaba', regiao_uf: 'mg',
  utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'condostore-set',
  utm_content: 'criativo-a', utm_term: null,
  campaign_name: 'CondoStore | Expansão', adset_name: 'Interesses', ad_name: 'Vídeo 01',
  source_url: 'https://condostore.com.br/lp', created_at: '2026-09-11T12:00:00Z',
};

// ---- telefone: SULTS quer 11 dígitos SEM o 55
eq(telefoneSults('5534999998888'), '34999998888', 'tira o DDI 55');
eq(telefoneSults('(34) 99999-8888'), '34999998888', 'tira máscara');
eq(telefoneSults('999'), null, 'curto demais vira null');
eq(telefoneSults(null), null, 'null');

// ---- temperatura: texto livre nosso → 1..5 do SULTS
eq(temperaturaSults('Gelado'), 1, 'gelado');
eq(temperaturaSults('frio'), 2, 'frio');
eq(temperaturaSults('Morno'), 3, 'morno');
eq(temperaturaSults('QUENTE'), 4, 'quente');
eq(temperaturaSults('Ardente'), 5, 'ardente');
eq(temperaturaSults('4'), 4, 'número cru');
eq(temperaturaSults('roxo'), null, 'não reconhecido não chuta');
eq(temperaturaSults(''), null, 'vazio');
eq(temperaturaSults('9'), null, 'fora de 1-5');

// ---- origem: mapa por canal vence o padrão
eq(origemSults(LEAD, CONF), 9, 'canal casa no mapa');
eq(origemSults({ ...LEAD, canal: 'Whatsapp' }, CONF), 2, 'sem casar, cai no origemId padrão');
eq(origemSults({ ...LEAD, canal: 'Whatsapp' }, { ...CONF, origemId: null }), null, 'sem padrão, null');
eq(origemSults({ ...LEAD, canal: null, origin: 'landing page' }, CONF), 4, 'origin também casa');

// ---- payload completo
{
  const r = montarPayloadSults(LEAD, CONF);
  ok(r.ok, 'monta');
  const p = r.payload;
  eq(p.negocio.responsavelId, 12, 'responsavelId');
  eq(p.negocio.etapaId, 25, 'etapaId');
  eq(p.negocio.situacaoId, 1, 'nasce ABERTO');
  eq(p.negocio.temperatura, 4, 'temperatura mapeada');
  eq(p.negocio.origemId, 9, 'origem do mapa');
  eq(p.negocio.campanhaId, 7, 'campanha da conexão');
  eq(p.negocio.cidade, 'Uberaba', 'cidade');
  eq(p.negocio.uf, 'MG', 'uf em maiúscula');
  eq(p.pessoa.phone, '34999998888', 'telefone sem DDI na pessoa');
  eq(p.pessoa.email, 'maria@x.com', 'email');
  eq(p.pessoa.nome, 'Maria Souza', 'nome');
  eq(p.sendNotificationToResponsavel, true, 'notifica o responsável');
}

// ---- valor_rs NUNCA vira valor (receita fechada ≠ ticket estimado)
{
  const p = montarPayloadSults(LEAD, CONF).payload;
  eq(p.negocio.valor, undefined, 'valor_rs não vaza pro valor do negócio');
}

// ---- descrição carrega a atribuição que o SULTS não tem campo pra guardar
{
  const d = descricaoAtribuicao(LEAD);
  ok(d.startsWith(`Lead reports: ${LEAD.id}`), 'primeira linha é a chave de cruzamento');
  ok(d.includes('utm_campaign: condostore-set'), 'utm_campaign');
  ok(d.includes('Anúncio: Vídeo 01'), 'criativo');
  ok(d.includes('Telefone: 34999998888'), 'telefone normalizado');
  ok(!d.includes('utm_term'), 'campo vazio não vira linha');
}

// ---- título
eq(tituloNegocio(LEAD), 'Maria Souza — Meta Lead Ads', 'nome + canal');
eq(tituloNegocio({ ...LEAD, nome: null }), '34999998888 — Meta Lead Ads', 'sem nome cai no telefone');
eq(tituloNegocio({ ...LEAD, nome: null, numero: null }), 'maria@x.com — Meta Lead Ads', 'depois o e-mail');
eq(tituloNegocio({ ...LEAD, nome: null, numero: null, email: null, canal: null }),
  'Lead sem identificação', 'último recurso');
ok(tituloNegocio({ ...LEAD, nome: 'M'.repeat(300) }).length <= 120, 'título truncado');

// ---- recusas: config incompleta e lead sem contato
{
  const r = montarPayloadSults(LEAD, { ...CONF, responsavelId: null });
  eq(r.ok, false, 'sem responsavelId recusa');
  ok(r.motivo.includes('responsavelId'), 'motivo diz o campo');
}
{
  const r = montarPayloadSults(LEAD, { ...CONF, etapaId: 0 });
  eq(r.ok, false, 'etapaId 0 recusa');
  ok(r.motivo.includes('etapaId'), 'motivo diz o campo');
}
{
  const r = montarPayloadSults({ ...LEAD, numero: null, email: null }, CONF);
  eq(r.ok, false, 'sem telefone e sem e-mail recusa');
  ok(r.motivo.includes('contato'), 'motivo explica');
}
{
  // só e-mail basta — formulário de LP sem telefone é caso real
  const r = montarPayloadSults({ ...LEAD, numero: null }, CONF);
  ok(r.ok, 'só e-mail passa');
  eq(r.payload.pessoa.phone, undefined, 'sem phone no payload');
}

// ---- campos opcionais ausentes não viram chave no JSON
{
  const magro = {
    id: 'x', nome: 'João', numero: '34988887777', email: null, canal: null, origin: null,
    temperatura: null, valor_rs: null, regiao_cidade: null, regiao_uf: null,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    campaign_name: null, adset_name: null, ad_name: null, source_url: null, created_at: null,
  };
  const p = montarPayloadSults(magro, { ...CONF, origemId: null, campanhaId: null }).payload;
  eq(p.negocio.cidade, undefined, 'sem cidade');
  eq(p.negocio.origemId, undefined, 'sem origem');
  eq(p.negocio.campanhaId, undefined, 'sem campanha');
  eq(p.negocio.temperatura, undefined, 'sem temperatura');
  eq(p.negocio.titulo, 'João', 'título só com nome');
  ok(JSON.stringify(p).length < 400, 'payload enxuto');
}


// ═══ VOLTA: SULTS → reports ═══════════════════════════════════════════════

// Negócio REAL da doc de "Listando Negócios"
const REMOTO = {
  id: 4, titulo: 'Negocio teste', dtCadastro: '2026-01-18T14:45:47Z',
  dtConclusao: '2026-03-09T12:59:05Z', valor: 1500.5,
  situacaoPerdaMotivo: { id: 16, nome: 'Outros' },
  situacao: { id: 1, nome: 'ABERTO' },
  etapa: { id: 25, nome: 'Leads Novos', funil: { id: 5, nome: 'Funil teste' } },
  campanha: { id: 1, nome: 'Campanha das Mães' },
  origem: { id: 2, nome: 'Facebook' },
  temperatura: { id: 5, nome: 'Ardente' },
  responsavel: { id: 1, nome: 'SULTS' },
  duracaoEtapa: [
    { etapa: { id: 25, nome: 'Leads Novos' }, duracaoMinuto: 71893,
      dtPrimeiraVez: '2026-01-18T14:45:47Z', dtUltimaVez: '2026-01-18T14:45:47Z' },
  ],
};

// ---- normalização
{
  const s = normalizarNegocio(REMOTO);
  eq(s.negocioId, 4, 'id');
  eq(s.etapaId, 25, 'etapa');
  eq(s.etapaNome, 'Leads Novos', 'etapa nome');
  eq(s.funilId, 5, 'funil aninhado na etapa');
  eq(s.situacaoId, 1, 'situação');
  eq(s.responsavelNome, 'SULTS', 'responsável');
  eq(s.origemNome, 'Facebook', 'origem');
  eq(s.valor, 1500.5, 'valor');
  eq(s.duracaoEtapas.length, 1, 'duração por etapa');
  eq(s.duracaoEtapas[0].minutos, 71893, 'minutos na etapa');
  eq(s.entrouNaEtapaEm, '2026-01-18T14:45:47Z', 'entrada na etapa');
}
eq(normalizarNegocio({ titulo: 'sem id' }), null, 'sem id vira null');
eq(normalizarNegocio({ id: 0 }), null, 'id 0 vira null');
{
  const s = normalizarNegocio({ id: '77', valor: '250.75' });
  eq(s.negocioId, 77, 'id string vira número');
  eq(s.valor, 250.75, 'valor string vira número');
  eq(s.etapaId, null, 'sem etapa não quebra');
  eq(s.duracaoEtapas, [], 'sem duracaoEtapa vira lista vazia');
}

// ---- entrada na etapa: dtUltimaVez vence dtPrimeiraVez (negócio que VOLTOU)
{
  const voltou = {
    ...REMOTO,
    etapa: { id: 25, nome: 'Leads Novos', funil: { id: 5 } },
    duracaoEtapa: [
      { etapa: { id: 25 }, duracaoMinuto: 900,
        dtPrimeiraVez: '2026-01-01T10:00:00Z', dtUltimaVez: '2026-03-20T09:00:00Z' },
      { etapa: { id: 30 }, duracaoMinuto: 400,
        dtPrimeiraVez: '2026-02-01T10:00:00Z', dtUltimaVez: '2026-02-01T10:00:00Z' },
    ],
  };
  eq(entradaNaEtapa(voltou), '2026-03-20T09:00:00Z', 'usa a ÚLTIMA passagem, não a primeira');
}
eq(entradaNaEtapa({ etapa: { id: 9 }, duracaoEtapa: [{ etapa: { id: 25 } }] }), null,
  'etapa atual sem linha em duracaoEtapa');
eq(entradaNaEtapa({ id: 1 }), null, 'sem duracaoEtapa');
{
  // só dtPrimeiraVez preenchido → serve de fallback
  const r = entradaNaEtapa({ etapa: { id: 3 }, duracaoEtapa: [{ etapa: { id: 3 }, dtPrimeiraVez: '2026-05-05T00:00:00Z' }] });
  eq(r, '2026-05-05T00:00:00Z', 'cai em dtPrimeiraVez quando não há última');
}

// ---- diff
const AGORA = '2026-09-11T18:00:00Z';
const snap = (etapaId, etapaNome, situacaoId = 1, situacaoNome = 'ABERTO', entrou = null) => ({
  negocioId: 4, titulo: 't', funilId: 5, funilNome: 'F',
  etapaId, etapaNome, situacaoId, situacaoNome,
  responsavelNome: null, origemNome: null, campanhaNome: null, motivoPerda: null,
  valor: null, dtCadastro: null, dtConclusao: null,
  entrouNaEtapaEm: entrou, duracaoEtapas: [],
});

// ⚠️ a regra que mais importa: primeira vez NÃO é movimento
eq(diffNegocio(null, snap(25, 'Leads Novos'), AGORA), null,
  'primeira varredura não inventa movimento');

eq(diffNegocio(snap(25, 'Leads Novos'), snap(25, 'Leads Novos'), AGORA), null, 'nada mudou');

{
  const m = diffNegocio(
    snap(25, 'Leads Novos'),
    snap(30, 'Reunião marcada', 1, 'ABERTO', '2026-09-11T14:30:00Z'),
    AGORA,
  );
  eq(m.etapaDeId, 25, 'etapa de');
  eq(m.etapaDeNome, 'Leads Novos', 'etapa de (nome)');
  eq(m.etapaParaId, 30, 'etapa para');
  eq(m.etapaParaNome, 'Reunião marcada', 'etapa para (nome)');
  eq(m.ocorridoEm, '2026-09-11T14:30:00Z', 'data do SULTS vence o relógio da varredura');
}
{
  // mudou de etapa mas o SULTS não deu a data → cai no relógio
  const m = diffNegocio(snap(25, 'A'), snap(30, 'B'), AGORA);
  eq(m.ocorridoEm, AGORA, 'sem entrouNaEtapaEm usa o agora');
}
{
  // ganho: etapa igual, situação muda
  const m = diffNegocio(snap(30, 'B', 1, 'ABERTO'), snap(30, 'B', 2, 'GANHO'), AGORA);
  ok(m, 'mudança só de situação é movimento');
  eq(m.situacaoDeNome, 'ABERTO', 'situação de');
  eq(m.situacaoParaNome, 'GANHO', 'situação para');
  eq(m.etapaDeId, m.etapaParaId, 'etapa inalterada nos dois lados');
  eq(m.ocorridoEm, AGORA, 'troca de situação usa o relógio — duracaoEtapa não registra isso');
}
{
  // ⚠️ situação mudou E etapa também: a data da etapa manda
  const m = diffNegocio(snap(25, 'A'), snap(30, 'B', 3, 'PERDA', '2026-09-10T08:00:00Z'), AGORA);
  eq(m.ocorridoEm, '2026-09-10T08:00:00Z', 'etapa+situação juntas usam a data da etapa');
  eq(m.situacaoParaNome, 'PERDA', 'situação para');
}
{
  // edição que NÃO é movimentação de funil
  const a = snap(30, 'B');
  const b = { ...snap(30, 'B'), titulo: 'outro', valor: 9999, responsavelNome: 'Fulano' };
  eq(diffNegocio(a, b, AGORA), null, 'editar título/valor/responsável não vira movimento');
}
{
  // regressão de etapa é movimento legítimo
  const m = diffNegocio(snap(30, 'B'), snap(25, 'A'), AGORA);
  ok(m, 'voltar de etapa conta');
  eq(m.etapaParaId, 25, 'etapa para (regressão)');
}


// ═══ catálogo deduzido ════════════════════════════════════════════════════

{
  const negs = [
    { id: 1, etapa: { id: 16, nome: 'Novo lead', funil: { id: 4, nome: 'Comercial' } },
      responsavel: { id: 125, nome: 'Daniele' }, origem: { id: 2, nome: 'Facebook' } },
    { id: 2, etapa: { id: 50, nome: 'Reunião Agendada', funil: { id: 4, nome: 'Comercial' } },
      responsavel: { id: 125, nome: 'Daniele' }, campanha: { id: 7, nome: 'Set' } },
    { id: 3, etapa: { id: 16, nome: 'Novo lead', funil: { id: 4, nome: 'Comercial' } },
      responsavel: { id: 49, nome: 'João' }, origem: { id: 1, nome: 'Instagram' } },
    { id: 4, etapa: { id: 27, nome: 'Mapeamento', funil: { id: 6, nome: 'Maringá' } },
      responsavel: { id: 125, nome: 'Daniele' } },
  ];
  const c = agregarCatalogo(negs);
  eq(c.amostra, 4, 'amostra');
  eq(c.funis[0].id, 4, 'funil de maior volume vem primeiro');
  eq(c.funis[0].qtd, 3, 'contagem do funil');
  eq(c.funis[1].id, 6, 'segundo funil');
  eq(c.funis[0].etapas.map(e => e.id), [16, 50],
    'etapas ordenadas por ID (ordem do funil), não por volume');
  eq(c.funis[0].etapas[0].qtd, 2, 'etapa repetida conta');
  eq(c.responsaveis[0], { id: 125, nome: 'Daniele', qtd: 3 }, 'responsável mais ativo primeiro');
  eq(c.responsaveis.length, 2, 'dois responsáveis');
  eq(c.origens.map(o => o.id).sort(), [1, 2], 'origens');
  eq(c.campanhas, [{ id: 7, nome: 'Set', qtd: 1 }], 'campanhas');
}

// ⚠️ etapa sem funil não pode sumir do menu
{
  const c = agregarCatalogo([{ id: 1, etapa: { id: 99, nome: 'Solta' } }]);
  eq(c.funis.length, 1, 'pseudo-funil criado');
  eq(c.funis[0].id, 0, 'id 0 = sem funil');
  eq(c.funis[0].etapas[0].id, 99, 'etapa preservada');
}

// lixo não quebra e não polui
{
  const c = agregarCatalogo([
    {}, { id: 5 }, { id: 6, responsavel: { id: 0, nome: 'zero' } },
    { id: 7, origem: { id: null } }, { id: 8, etapa: { nome: 'sem id' } },
  ]);
  eq(c.responsaveis, [], 'id 0 é descartado');
  eq(c.origens, [], 'id nulo descartado');
  eq(c.funis, [], 'etapa sem id não cria funil');
  eq(c.amostra, 5, 'amostra conta as linhas mesmo assim');
}
eq(agregarCatalogo([]).funis, [], 'lista vazia');
eq(agregarCatalogo(undefined).amostra, 0, 'undefined não quebra');

// nome ausente vira rótulo legível em vez de vazio
{
  const c = agregarCatalogo([{ id: 1, responsavel: { id: 42 } }]);
  eq(c.responsaveis[0].nome, '#42', 'sem nome vira #id');
}

console.log(`ok — ${n} asserts`);
