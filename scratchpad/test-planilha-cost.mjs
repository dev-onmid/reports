// Prova com o arquivo REAL do Matheus (Cost Odonto, relatório de orçamentos) pelo caminho da tela.
import { readFileSync } from 'node:fs';
import { lerArquivoContatos, linhasDaPlanilha } from './build/contatos-arquivo.mjs';
import { formatPhone, deduplicarContatos, parsePhoneList } from './build/phone-formatter.mjs';
import { montarMensagem } from './build/disparos-mensagem.mjs';
const caminho = '/Users/matheuscampos/Downloads/Relatorio_orcamentos_por_status-cost_odontologia-2026-09-30 3.xlsx';
const contatos = await lerArquivoContatos(new File([readFileSync(caminho)], 'cost.xlsx'));
const lidos = contatos.map(c => ({ phone: formatPhone(c.telefone) ?? '', name: (c.nome ?? '').replace(/[,;\t]/g, ' ').trim() })).filter(c => c.phone);
const { unicos, repetidos } = deduplicarContatos(lidos);
const texto = unicos.map(c => (c.name ? `${c.phone},${c.name}` : c.phone)).join('\n');
const final = deduplicarContatos(parsePhoneList(texto)).unicos; // o que o POST grava
console.log(`linhas lidas: ${contatos.length} | únicos: ${unicos.length} | repetidas juntadas: ${repetidos} | sem nome: ${unicos.filter(c => !c.name).length} | no POST: ${final.length}`);
for (const c of final.slice(0, 6)) console.log(' ', c.phone, '|', c.name.padEnd(32), '|', montarMensagem('Oi {primeiro_nome}, tudo bem?', c));
let falhas = 0; const ok = (c, m) => { if (!c) { falhas++; console.log('❌', m); } };
ok(unicos.length === 198, '198 pacientes únicos (inclui os 2 do DDD 55)');
ok(formatPhone('55996817357') === '5555996817357', 'DDD 55 sem país vira 55+55+número');
ok(formatPhone('5555996817357') === '5555996817357', 'DDD 55 com país fica igual');
ok(formatPhone('5543999991111') === '5543999991111', 'número com país continua');
ok(formatPhone('43999991111') === '5543999991111', 'número sem país continua');
ok(formatPhone('5543999') === null, 'curto demais continua inválido');
ok(unicos.filter(c => !c.name).length === 0, 'todos com nome');
ok(final.length === unicos.length, 'POST não perde nem duplica');
ok(final[0].name === 'Patricia Zielke', 'Paciente reconhecido');
// cabeçalho sem rótulo conhecido → inferência pelo conteúdo, ignorando status repetido e e-mail
const inferido = linhasDaPlanilha([
  ['Data', 'Beneficiário', 'Celular', 'E-mail', 'Situação'],
  ['01/10', 'Ana Paula Souza', '43999990001', 'ana@x.com', 'Em aberto'],
  ['01/10', 'Bruno Lima', '43999990002', 'b@x.com', 'Em aberto'],
  ['02/10', 'Carla Dias', '43999990003', 'c@x.com', 'Em aberto'],
  ['02/10', 'Diego Rocha', '43999990004', 'd@x.com', 'Aprovado'],
]);
ok(inferido.map(c => c.nome).join('|') === 'Ana Paula Souza|Bruno Lima|Carla Dias|Diego Rocha', 'inferência escolhe Beneficiário, não Situação');
// 'Código do cliente' não pode virar nome
const codigo = linhasDaPlanilha([['Código do cliente', 'Nome do cliente', 'Telefone'], ['123', 'Eva', '43999990005']]);
ok(codigo[0].nome === 'Eva', '"Código do cliente" não é nome');
// nono dígito: com e sem o 9 são a mesma pessoa
ok(deduplicarContatos([{ phone: '5548991234567', name: '' }, { phone: '554891234567', name: 'Zé' }]).unicos.length === 1, 'nono dígito deduplica');
ok(deduplicarContatos([{ phone: '5548991234567', name: '' }, { phone: '554891234567', name: 'Zé' }]).unicos[0].name === 'Zé', 'repetido com nome preenche o sem nome');
console.log(falhas ? `\n❌ ${falhas} falha(s)` : '\n✅ planilha real + 8 checagens');
if (falhas) process.exit(1);
