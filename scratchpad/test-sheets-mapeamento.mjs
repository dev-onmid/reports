// Recompilar antes de rodar:
//   npx esbuild src/lib/sheets-mapeamento.ts --bundle --format=esm --platform=node --outfile=scratchpad/build/sheets-mapeamento.mjs
import { CAMPOS, CHAVES, normalizarMapeamento, camposPreenchidos, avisosDoMapeamento } from './build/sheets-mapeamento.mjs';
import assert from 'node:assert/strict';

let n = 0;
const t = (nome, fn) => { fn(); n++; };

const COLS = ['DATA', 'NOME', 'TELEFONE', 'CANAL', 'OBSERVAÇÃO', 'STATUS', 'DATA DE CONTATO', 'Compareceu', '1º CONTATO', '2º CONTATO', '3º CONTATO'];

// ── catálogo ─────────────────────────────────────────────────────────────────
t('nenhuma chave repetida', () => assert.equal(new Set(CAMPOS.map(c => c.chave)).size, CAMPOS.length));
t('clinic NÃO é oferecido', () => {
  // Mandar a coluna de clínica faz a rota tentar um de-para que não existe aqui.
  assert.ok(!CHAVES.has('clinic'));
});
t('todo campo tem rótulo e ajuda em português', () => {
  for (const c of CAMPOS) {
    assert.ok(c.rotulo.length > 2, c.chave);
    assert.ok(c.ajuda.length > 10, c.chave);
  }
});
t('só contact é lista', () => {
  assert.deepEqual(CAMPOS.filter(c => c.lista).map(c => c.chave), ['contact']);
});
t('essenciais são data, nome e telefone', () => {
  assert.deepEqual(CAMPOS.filter(c => c.essencial).map(c => c.chave), ['date', 'name', 'phone']);
});

// ── normalizarMapeamento ─────────────────────────────────────────────────────
t('mapeamento normal passa inteiro', () => {
  const m = normalizarMapeamento({ date: 'DATA', name: 'NOME', phone: 'TELEFONE' }, COLS);
  assert.equal(m.date, 'DATA');
  assert.equal(m.phone, 'TELEFONE');
});
t('campo fora do catálogo é DESCARTADO', () => {
  // Chave inventada viraria `<chave>Column`, um campo que ninguém lê.
  const m = normalizarMapeamento({ date: 'DATA', inventado: 'NOME' }, COLS);
  assert.ok(!('inventado' in m));
});
t('coluna que não existe no cabeçalho vira null', () => {
  // Deixar passar derruba a aba inteira na rodada do dia seguinte.
  const m = normalizarMapeamento({ date: 'DATA', revenue: 'COLUNA QUE NAO EXISTE' }, COLS);
  assert.equal(m.revenue, null);
  assert.equal(m.date, 'DATA');
});
t('sem cabeçalho, só o formato é validado', () => {
  const m = normalizarMapeamento({ date: 'QUALQUER COISA' }, null);
  assert.equal(m.date, 'QUALQUER COISA');
});
t('espaço sobrando casa com a coluna real', () => {
  const m = normalizarMapeamento({ date: ' DATA ' }, COLS);
  assert.equal(m.date, 'DATA');
});
t('string vazia vira null, não string vazia', () => {
  assert.equal(normalizarMapeamento({ date: '' }, COLS).date, null);
  assert.equal(normalizarMapeamento({ date: '   ' }, COLS).date, null);
});
t('contact aceita array e tira duplicata', () => {
  // A mesma coluna duas vezes contaria a tentativa em dobro.
  const m = normalizarMapeamento({ contact: ['1º CONTATO', '2º CONTATO', '1º CONTATO'] }, COLS);
  assert.deepEqual(m.contact, ['1º CONTATO', '2º CONTATO']);
});
t('contact aceita CSV (formato que a importação usa)', () => {
  const m = normalizarMapeamento({ contact: '1º CONTATO,2º CONTATO' }, COLS);
  assert.deepEqual(m.contact, ['1º CONTATO', '2º CONTATO']);
});
t('contact filtra coluna inexistente e vira null se sobrar nada', () => {
  assert.equal(normalizarMapeamento({ contact: ['NAO EXISTE'] }, COLS).contact, null);
});
t('contact com string solta no lugar de lista não explode', () => {
  assert.equal(normalizarMapeamento({ contact: null }, COLS).contact, null);
  assert.equal(normalizarMapeamento({ contact: 42 }, COLS).contact, null);
});
t('entrada que não é objeto devolve null', () => {
  assert.equal(normalizarMapeamento(null, COLS), null);
  assert.equal(normalizarMapeamento('DATA', COLS), null);
  assert.equal(normalizarMapeamento(['DATA'], COLS), null);
});

// ── camposPreenchidos ────────────────────────────────────────────────────────
t('só devolve o que tem valor, na ordem do catálogo', () => {
  const m = normalizarMapeamento({ phone: 'TELEFONE', date: 'DATA', notes: null }, COLS);
  assert.deepEqual(camposPreenchidos(m).map(c => c.chave), ['date', 'phone']);
});
t('contact vazio não conta como preenchido', () => {
  assert.deepEqual(camposPreenchidos({ contact: [] }).map(c => c.chave), []);
});

// ── avisosDoMapeamento ───────────────────────────────────────────────────────
t('sem data avisa sobre o mês errado', () => {
  const a = avisosDoMapeamento({ name: 'NOME', phone: 'TELEFONE' });
  assert.ok(a.some(x => /data/i.test(x)));
});
t('sem telefone avisa que não junta com o WhatsApp', () => {
  const a = avisosDoMapeamento({ date: 'DATA', name: 'NOME' });
  assert.ok(a.some(x => /WhatsApp/i.test(x)));
});
t('mapeamento completo não gera aviso', () => {
  assert.deepEqual(avisosDoMapeamento({ date: 'DATA', name: 'NOME', phone: 'TELEFONE' }), []);
});
t('mesma coluna em dois campos é apontada', () => {
  // Erro clássico da IA: receita = orçamento, e o efeito é silencioso.
  const a = avisosDoMapeamento({ date: 'DATA', name: 'NOME', phone: 'TELEFONE', revenue: 'VALOR', budget: 'VALOR' });
  assert.ok(a.some(x => x.includes('"VALOR"')), JSON.stringify(a));
});
t('faturamento sem data é apontado', () => {
  const a = avisosDoMapeamento({ name: 'NOME', phone: 'TELEFONE', revenue: 'VALOR' });
  assert.ok(a.some(x => /receita não vai cair/i.test(x)));
});
t('mapeamento nulo pede a análise', () => {
  assert.ok(avisosDoMapeamento(null)[0].includes('analise'));
});

// ── compatibilidade com o que a IA devolve ───────────────────────────────────
t('o de-para do print real sobrevive à normalização', () => {
  const daIa = {
    date: 'DATA', name: 'NOME', channel: 'CANAL', phone: 'TELEFONE',
    notes: 'OBSERVAÇÃO', status: 'STATUS', updatedDate: 'DATA DE CONTATO',
    attended: 'Compareceu', contact: ['1º CONTATO', '2º CONTATO', '3º CONTATO'],
    clinic: 'CLINICA', revenue: null,
  };
  const m = normalizarMapeamento(daIa, COLS);
  assert.equal(m.date, 'DATA');
  assert.equal(m.attended, 'Compareceu');
  assert.deepEqual(m.contact, ['1º CONTATO', '2º CONTATO', '3º CONTATO']);
  assert.ok(!('clinic' in m));
  assert.deepEqual(avisosDoMapeamento(m), []);
});

console.log(`✅ ${n} asserts`);

// ── Casamento POR ABA (2026-10-07) ───────────────────────────────────────────
// "Cada coluna é individual": a de data pode estar em A num mês e em C no
// outro, e chamar-se DATA agora e "Data Entrada" em 2024.
{
  const { casarColunasDaAba, abaUtilizavel } = await import('./build/sheets-mapeamento.mjs');
  const PADRAO = { date:'DATA', name:'NOME', phone:'TELEFONE', channel:'CANAL', status:'STATUS',
                   notes:'OBSERVAÇÃO', updatedDate:'DATA DE CONTATO', contact:['1º CONTATO','2º CONTATO','3º CONTATO'] };

  // Aba do mês: tudo igual ao padrão.
  {
    const c = casarColunasDaAba(['DATA','NOME','TELEFONE','CANAL','STATUS','OBSERVAÇÃO','DATA DE CONTATO','1º CONTATO'], PADRAO);
    t('padrão casa consigo mesmo', () => {
      assert.equal(c.mapa.date, 'DATA');
      assert.equal(c.origem.date, 'padrao');
      assert.deepEqual(c.faltam, []);
    });
  }

  // Caso REAL da Romanza: posição diferente, caixa diferente.
  {
    const c = casarColunasDaAba(['','NOME','TELEFONE','Canal','Link Criativo','1º Contato','Data de Contato','STATUS','DATA'], PADRAO);
    t('coluna em outra posição e com outra caixa é encontrada', () => {
      assert.equal(c.mapa.date, 'DATA');
      assert.equal(c.mapa.channel, 'Canal');
      assert.equal(c.mapa.updatedDate, 'Data de Contato');
    });
  }

  // Caso REAL de 2024: "Data Entrada" em vez de "DATA" — era por isso que 12
  // abas da Romanza (quase um ano) eram descartadas.
  {
    const c = casarColunasDaAba(['','Data Entrada','Nome','Telefone','Canal','1º Contato','Data de Contato'], PADRAO);
    t('sinônimo resolve "Data Entrada" como a data do lead', () => {
      assert.equal(c.mapa.date, 'Data Entrada');
      assert.equal(c.origem.date, 'sinonimo');
      assert.equal(c.mapa.name, 'Nome');
      assert.equal(c.mapa.phone, 'Telefone');
    });
    t('o que a aba não tem é reportado, não derruba', () => {
      assert.ok(c.faltam.includes('status'));
      assert.equal(c.mapa.status, null);
      assert.equal(abaUtilizavel(c).ok, true, 'falta só campo opcional: a aba entra');
    });
  }

  // A escolha do gestor vence tudo.
  {
    const cab = ['Data Entrada','DT','Nome','Telefone'];
    const c = casarColunasDaAba(cab, PADRAO, { date: 'DT' });
    t('ajuste manual da aba vence o sinônimo', () => {
      assert.equal(c.mapa.date, 'DT');
      assert.equal(c.origem.date, 'manual');
    });
  }

  // ⚠️ Uma coluna nunca serve a dois campos.
  {
    const c = casarColunasDaAba(['DATA','NOME','TELEFONE'], { date:'DATA', updatedDate:'DATA' });
    t('a mesma coluna não é usada em dois campos', () => {
      const usados = [c.mapa.date, c.mapa.updatedDate].filter(Boolean);
      assert.equal(new Set(usados).size, usados.length);
    });
  }

  // Essenciais
  {
    const semData = casarColunasDaAba(['NOME','TELEFONE'], PADRAO);
    t('sem data a aba é recusada', () => assert.equal(abaUtilizavel(semData).ok, false));
    const semNomeNemFone = casarColunasDaAba(['DATA','CANAL'], PADRAO);
    t('sem nome E sem telefone a aba é recusada', () => assert.equal(abaUtilizavel(semNomeNemFone).ok, false));
    const soNome = casarColunasDaAba(['DATA','NOME'], PADRAO);
    t('nome OU telefone basta para identificar', () => assert.equal(abaUtilizavel(soNome).ok, true));
    // Planilha que é fonte de faturamento: aba sem receita entraria com R$ 0 e
    // o mês mentiria na dashboard.
    const semReceita = casarColunasDaAba(['DATA','NOME','TELEFONE'], { ...PADRAO, revenue: 'VALOR FECHADO' });
    t('fonte de faturamento exige a coluna de receita', () => {
      assert.equal(abaUtilizavel(semReceita, false).ok, true);
      assert.equal(abaUtilizavel(semReceita, true).ok, false);
    });
  }

  // A fileira de tentativas encolhe de um mês para o outro, sem reprovar nada.
  {
    const c = casarColunasDaAba(['DATA','NOME','TELEFONE','1º Contato','2º Contato'], PADRAO);
    t('fileira de contato aceita o que existir naquela aba', () => {
      assert.deepEqual(c.mapa.contact, ['1º Contato', '2º Contato']);
      assert.equal(abaUtilizavel(c).ok, true);
    });
  }
}

console.log(`✅ ${n} asserts (com casamento por aba)`);
