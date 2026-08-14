/**
 * Assistente de preenchimento do .env.coolify.
 *
 * Existe porque editar o arquivo à mão é a parte mais fácil de errar da
 * migração: uma aspa a mais, um espaço depois do `=`, uma linha colada no
 * lugar errado — e o sistema sobe quebrado sem dizer por quê.
 *
 * Aqui o usuário só cola o valor e aperta Enter. A gravação é feita em JS
 * (não com sed), porque chave de API tem `/`, `+` e `=` no meio, que
 * quebrariam a substituição por expressão regular.
 *
 * Rodar:  node preencher.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const ARQUIVO = '.env.coolify';

const CAMPOS = [
  { chave: 'SUPABASE_DB_PASSWORD', obrigatorio: true,
    titulo: 'Senha do banco de dados',
    onde: 'Supabase → (engrenagem) Settings → Database → botão "Reset database password"',
    dica: 'Ela aparece UMA vez só. Copie antes de fechar a janela.' },
  { chave: 'NEXT_PUBLIC_SUPABASE_URL', obrigatorio: true,
    titulo: 'Endereço do projeto Supabase',
    onde: 'Supabase → Settings → API → campo "Project URL"',
    dica: 'Começa com https:// e termina com .supabase.co' },
  { chave: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', obrigatorio: true,
    titulo: 'Chave pública do Supabase (anon)',
    onde: 'Supabase → Settings → API → "Project API keys" → a marcada anon / public',
    dica: 'É um texto bem longo. Use o botão de copiar do site.' },
  { chave: 'SUPABASE_SERVICE_ROLE_KEY', obrigatorio: false,
    titulo: 'Chave secreta do Supabase (service_role)',
    onde: 'Supabase → Settings → API → a marcada service_role / secret' },
  { chave: 'ANTHROPIC_API_KEY', obrigatorio: false,
    titulo: 'Chave da IA (Luna e relatórios)',
    onde: 'console.anthropic.com → API keys → Create Key',
    dica: 'A antiga não pode ser lida de novo; crie uma nova.' },
  { chave: 'GOOGLE_CLIENT_ID', obrigatorio: false,
    titulo: 'Google — ID do cliente OAuth',
    onde: 'Google Cloud → APIs e serviços → Credenciais' },
  { chave: 'GOOGLE_CLIENT_SECRET', obrigatorio: false,
    titulo: 'Google — segredo do cliente OAuth',
    onde: 'Google Cloud → APIs e serviços → Credenciais (mesma tela)' },
  { chave: 'GOOGLE_API_KEY', obrigatorio: false,
    titulo: 'Google — chave de API',
    onde: 'Google Cloud → APIs e serviços → Credenciais → Chaves de API' },
  { chave: 'META_APP_SECRET', obrigatorio: false,
    titulo: 'Meta — chave secreta do app',
    onde: 'developers.facebook.com → seu app → Configurações → Básico' },
  { chave: 'TLDV_API_KEY', obrigatorio: false,
    titulo: 'TLDV (gravação de reuniões)',
    onde: 'tldv.io → configurações → API' },
  { chave: 'WEBSHARE_API_KEY', obrigatorio: false,
    titulo: 'Webshare (alerta do proxy do WhatsApp)',
    onde: 'painel Webshare → API',
    dica: 'Sem ela o alerta do proxy continua desligado, como já está hoje.' },
  { chave: 'WEBSHARE_ALERT_EMAIL', obrigatorio: false,
    titulo: 'E-mail que recebe o alerta do Webshare',
    onde: 'é só digitar o e-mail que deve receber o aviso' },
];

/**
 * Põe aspas quando o valor tem caractere que o leitor de .env interpretaria.
 *
 * ⚠️ Pego na prática: uma senha do Supabase começando com `#` era lida como
 * VAZIA — em arquivo .env, `#` inicia comentário. O sistema subiria sem senha
 * de banco e o erro ("client password must be a string") não diria a causa.
 * Espaço e aspas dão problemas parecidos. Só aspeamos quando precisa: valor
 * simples fica limpo, do jeito que a maioria dos painéis espera.
 */
function escapar(valor) {
  if (!/[#\s"'`$]/.test(valor)) return valor;
  return `"${valor.replace(/(["\\$`])/g, '\\$1')}"`;
}

/** Troca só a linha da chave, preservando o resto do arquivo (comentários inclusive). */
function gravar(texto, chave, valor) {
  const linha = `${chave}=${escapar(valor)}`;
  const linhas = texto.split('\n');
  const i = linhas.findIndex(l => l.startsWith(`${chave}=`));
  if (i === -1) return `${texto.replace(/\n?$/, '\n')}${linha}\n`;
  linhas[i] = linha;
  return linhas.join('\n');
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

/**
 * `rl.question` NÃO rejeita quando a entrada fecha — a promessa fica pendente
 * pra sempre e o Node imprime um aviso técnico no lugar de terminar. A corrida
 * com o evento `close` faz o programa encerrar limpo se o terminal for fechado
 * no meio do preenchimento.
 */
let entradaFechada = false;
rl.once('close', () => { entradaFechada = true; });

async function perguntar(prompt) {
  if (entradaFechada) return '';   // perguntar depois de fechado LANÇA (ERR_USE_AFTER_CLOSE)
  return Promise.race([
    rl.question(prompt),
    new Promise(resolve => rl.once('close', () => resolve(''))),
  ]);
}
let texto = readFileSync(ARQUIVO, 'utf8');
let preenchidos = 0, pulados = 0;

console.log('\n═══ Preenchendo as chaves do sistema ═══');
console.log('Cole o valor e aperte Enter. Para pular, só aperte Enter.');
console.log('Nada é enviado pra lugar nenhum — só gravado no arquivo aqui.\n');

for (const c of CAMPOS) {
  const atual = (texto.split('\n').find(l => l.startsWith(`${c.chave}=`)) ?? '').split('=').slice(1).join('=');
  if (atual.trim()) { console.log(`✓ ${c.titulo} — já preenchido, pulando\n`); continue; }

  console.log(`${c.obrigatorio ? '🔴 OBRIGATÓRIO' : '⚪ opcional'} — ${c.titulo}`);
  console.log(`   Onde achar: ${c.onde}`);
  if (c.dica) console.log(`   Dica: ${c.dica}`);

  const v = (await perguntar('   Cole aqui: ')).trim();
  if (!v) {
    console.log(c.obrigatorio ? '   ⚠️  Pulado — o sistema NÃO sobe sem este.\n' : '   pulado\n');
    pulados++;
    continue;
  }
  texto = gravar(texto, c.chave, v);
  writeFileSync(ARQUIVO, texto);   // grava a cada passo: fechar no meio não perde o que já foi feito
  console.log(`   ✓ guardado (${v.length} caracteres)\n`);
  preenchidos++;
}

rl.close();
const faltamObrig = CAMPOS.filter(c => c.obrigatorio)
  .filter(c => !(texto.split('\n').find(l => l.startsWith(`${c.chave}=`)) ?? '').split('=').slice(1).join('=').trim());

console.log('═══════════════════════════════════════');
console.log(`Preenchidos agora: ${preenchidos} | pulados: ${pulados}`);
console.log(faltamObrig.length === 0
  ? '✅ Os 3 obrigatórios estão prontos. Pode avisar o Claude.'
  : `⚠️  Ainda faltam obrigatórios: ${faltamObrig.map(c => c.titulo).join(', ')}`);
