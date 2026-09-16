// Recompilar antes: npx esbuild src/lib/email-envio.ts src/lib/vault-crypto.ts \
//   --bundle --format=esm --platform=node --packages=external --alias:@=./src --outdir=scratchpad/build
process.env.VAULT_KEY = 'chave-de-teste-com-mais-de-32-caracteres-aqui';
const { lerConfigSmtp, salvarConfigSmtp, enviarEmail } = await import('./build/email-envio.js');

let n = 0, falhas = 0;
const ok = (c, m) => { n++; if (!c) { falhas++; console.error('  ✗', m); } };

/** Pool de mentira que guarda system_settings em memória e conta as consultas. */
function poolFake(inicial = {}, gmail = []) {
  const store = { ...inicial };
  const vistas = [];
  return {
    store, vistas,
    async query(sql, params) {
      vistas.push(sql.replace(/\s+/g, ' ').trim().slice(0, 60));
      if (/CREATE TABLE/i.test(sql)) return { rows: [] };
      if (/FROM public.system_settings/i.test(sql)) {
        const chaves = params[0];
        return { rows: chaves.filter(k => store[k] != null).map(k => ({ key: k, value: store[k] })) };
      }
      if (/INSERT INTO public.system_settings/i.test(sql)) { store[params[0]] = params[1]; return { rows: [] }; }
      if (/DELETE FROM public.system_settings/i.test(sql)) { for (const k of params[0]) delete store[k]; return { rows: [] }; }
      if (/google_connections/i.test(sql)) return { rows: gmail };
      return { rows: [] };
    },
  };
}
const msg = { to: 'a@x.com', subject: 's', html: '<p>h</p>', text: 't' };

// --- gravação da senha ---
const p1 = poolFake();
await salvarConfigSmtp(p1, { host: 'smtp.titan.email', port: 465, secure: true,
  user: 'leads@onmid.com.br', senha: 'SenhaSecreta123', fromNome: 'ONMID' });
const guardada = p1.store['email_smtp_senha_enc'];
ok(typeof guardada === 'string' && guardada.startsWith('gcm.v1:'), 'senha é gravada cifrada');
ok(!JSON.stringify(p1.store).includes('SenhaSecreta123'), 'senha em texto puro não fica no banco');

// ⚠️ sem VAULT_KEY a gravação é RECUSADA — nunca grava texto puro
const chave = process.env.VAULT_KEY; delete process.env.VAULT_KEY;
const p2 = poolFake();
const r2 = await salvarConfigSmtp(p2, { host: 'h', user: 'u', senha: 'x' });
ok(!r2.ok && /VAULT_KEY/.test(r2.erro ?? ''), 'sem VAULT_KEY recusa gravar a senha');
ok(p2.store['email_smtp_senha_enc'] === undefined, 'recusada, não grava nada');
process.env.VAULT_KEY = chave;

// --- leitura para a tela ---
const cfg = await lerConfigSmtp(p1);
ok(cfg?.user === 'leads@onmid.com.br' && cfg.port === 465, 'config volta para a tela');
ok(cfg?.temSenha === true, 'tela sabe que existe senha');
ok(!JSON.stringify(cfg).includes('gcm.v1') && !('senha' in (cfg ?? {})),
  'a senha NUNCA volta para o navegador, nem cifrada');
ok((await lerConfigSmtp(poolFake())) === null, 'sem config devolve null');

// --- escolha do remetente ---
const semNada = poolFake();
const r3 = await enviarEmail(semNada, msg);
ok(!r3.ok && r3.via === 'nenhum', 'sem SMTP e sem Gmail: via "nenhum", não finge que enviou');

const soGmail = poolFake({}, [{ email: 'g@x.com', refresh_token: 'tok' }]);
const r4 = await enviarEmail(soGmail, msg);
ok(r4.via === 'gmail', 'sem SMTP configurado usa o Gmail de reserva');

// SMTP pela metade (sem senha) ainda é "não configurado" → reserva
const meio = poolFake({ email_smtp_host: 'h', email_smtp_user: 'u' }, [{ email: 'g@x.com', refresh_token: 'tok' }]);
ok((await enviarEmail(meio, msg)).via === 'gmail', 'SMTP sem senha não conta como configurado');

// ⚠️ O CASO QUE IMPORTA: SMTP configurado mas com senha ilegível (VAULT_KEY trocada)
// NÃO pode cair no Gmail — silenciar isso esconderia a configuração quebrada.
const quebrado = poolFake(
  { email_smtp_host: 'h', email_smtp_user: 'u', email_smtp_senha_enc: 'gcm.v1:lixo:invalido' },
  [{ email: 'g@x.com', refresh_token: 'tok' }]);
const r5 = await enviarEmail(quebrado, msg);
ok(!r5.ok && r5.via === 'smtp', 'SMTP com senha ilegível falha como smtp, não como gmail');
ok(!quebrado.vistas.some(s => /google_connections/.test(s)),
  'e nem chega a consultar o Gmail — a falha fica visível');

console.log(falhas ? `\n${falhas} de ${n} falharam` : `\n${n} asserts OK`);
process.exit(falhas ? 1 : 0);
