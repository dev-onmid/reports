/* Testa a régua que decide se utm_campaign é ID do ValueTrack ou nome escrito.
   Rodar: node scratchpad/test-google-nome.mjs */
let n = 0;
const ok = (c, msg) => { if (!c) { console.error('FALHOU:', msg); process.exit(1); } n++; };

// cópia da regra de google-ad-resolver.ts (função pura, sem dependência)
const pareceIdGoogle = v => !!v && /^\d{6,}$/.test(String(v).trim());

// ID do ValueTrack: sempre numérico e longo
ok(pareceIdGoogle('22334455'), 'id de campanha e ID');
ok(pareceIdGoogle('  22334455  '), 'espaço em volta não atrapalha');
ok(pareceIdGoogle('123456789012'), 'id longo e ID');

// nome escrito à mão NUNCA pode ser confundido com ID — senão o sistema
// tentaria "traduzir" um nome que já está certo e poderia sobrescrevê-lo
ok(!pareceIdGoogle('Revenda-Londrina-Search'), 'nome com hífen não é ID');
ok(!pareceIdGoogle('revenda 2026'), 'nome com número no fim não é ID');
ok(!pareceIdGoogle('2026'), 'ano solto é curto demais para ser ID');
ok(!pareceIdGoogle('12345'), '5 dígitos é curto demais');
ok(!pareceIdGoogle(''), 'vazio não é ID');
ok(!pareceIdGoogle(null), 'nulo não é ID');
ok(!pareceIdGoogle(undefined), 'indefinido não é ID');
ok(!pareceIdGoogle('camp_22334455'), 'prefixo textual não é ID');
ok(!pareceIdGoogle('{campaignid}'), 'macro NÃO substituída não é ID');

console.log(`OK — ${n} asserts`);
