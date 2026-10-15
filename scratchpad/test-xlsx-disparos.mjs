import * as XLSX from 'xlsx';
import { lerArquivoContatos } from './build/contatos-arquivo.mjs';
import { parsePhoneList } from './build/phone-formatter.mjs';
import { montarMensagem } from './build/disparos-mensagem.mjs';
const ws = XLSX.utils.aoa_to_sheet([
  ['Código', 'Nome do cliente', 'CPF', 'Celular', 'Cidade'],
  [101, 'MARIA APARECIDA DA SILVA', '123.456.789-00', '(43) 99999-1111', 'Londrina'],
  [102, 'joão pedro', '', '43 9 8888-7777', 'Cambé'],
  [103, '', '', '+55 43 97777-6666', 'Ibiporã'],
  [104, 'Sem, Telefone', '', '', ''],
]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const file = new File([buf], 'clientes.xlsx');
const contatos = await lerArquivoContatos(file);
const linhas = contatos.map(c => { const nome = (c.nome ?? '').replace(/[,;\t]/g, ' ').replace(/\s+/g, ' ').trim(); return nome ? `${c.telefone},${nome}` : c.telefone; });
const lista = parsePhoneList(linhas.join('\n'));
console.log('lidos do xlsx:', contatos.length, '| na lista final:', lista.length);
for (const c of lista) console.log(c.phone.padEnd(14), '|', (c.name || '(sem nome)').padEnd(26), '|', montarMensagem('Oi {primeiro_nome}, tudo bem? 😊', c));
const ok = lista.length === 3 && lista[0].name === 'MARIA APARECIDA DA SILVA' && montarMensagem('Oi {primeiro_nome}, tudo bem? 😊', lista[2]) === 'Oi, tudo bem? 😊';
console.log(ok ? '\n✅ xlsx real: colunas achadas, CPF/código ignorados, mensagens certas' : '\n❌ FALHOU'); if (!ok) process.exit(1);
