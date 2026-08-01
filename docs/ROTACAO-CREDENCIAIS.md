# Rotação de credenciais — pós-exposição pública

**Contexto.** Até o deploy da autenticação server-side, o app respondia a qualquer
pessoa com a URL. Confirmado por leitura de código, não por suposição: as rotas
abaixo devolviam credenciais sem exigir login algum.

Hoje todas respondem **401** (verificado em produção). Fechar a porta, porém,
**não desfaz o que já saiu**. Quem baixou os dados enquanto estavam abertos
continua com eles — e alguns desses segredos não expiram sozinhos.

Não há como saber se alguém acessou: não existia log de acesso nessas rotas.
A postura correta é tratar tudo como vazado.

---

## Ordem recomendada

Do que dá mais poder a um invasor para o que dá menos.

### 1. Google — `refresh_token` (URGENTE)

**Por quê primeiro:** era devolvido inteiro por `/api/google/connections`, e
`refresh_token` do Google **não expira**. Quem tem um pode gerar `access_token`
novo indefinidamente e operar o Google Ads dos seus clientes — inclusive gastar
orçamento.

**Como:** em [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
remova o acesso do app; depois reconecte cada conta em Integrações. Isso invalida
os refresh tokens antigos.

### 2. Meta — tokens de acesso (URGENTE)

Devolvidos por `/api/meta/connections` e, no caso do pixel, por
`/api/whatsapp-pixel` (campo `meta_token`).

**Como:** em [Configurações de Segurança do Business](https://business.facebook.com/settings/security),
remova o app; reconecte em Integrações. Se houver System User token, gere novo e
invalide o anterior.

### 3. Supabase — chave `service_role` (URGENTE)

`/api/upload` fazia um diagnóstico que expunha o project ref e as claims do JWT
da chave service-role. **Essa chave ignora RLS** — quem a tem lê e escreve o
banco inteiro.

**Como:** painel Supabase → Settings → API → *Rotate* na `service_role`. Atualize
`SUPABASE_SERVICE_ROLE_KEY` na Vercel e faça redeploy.

### 4. Senhas do Cofre — credenciais dos seus CLIENTES

`/api/vault` devolvia o cofre inteiro: título, URL, login e senha, **em texto
puro**, de todos os clientes.

São credenciais de terceiros (painéis, hospedagens, redes sociais dos clientes),
não suas. Trocar exige avisar cada cliente.

**Como:** priorize por dano — o que dá acesso a dinheiro, domínio ou conta de
anúncio primeiro; login de ferramenta secundária depois.

> Depois de trocar, grave as novas no Cofre **já com `VAULT_KEY` configurada**
> (ver seção final), senão elas entram em texto puro de novo.

### 5. Senhas dos usuários do sistema

`/api/users?login=1` devolvia todos os usuários **com a senha em texto puro**.

**Como:** cada pessoa troca a senha em Configurações → Usuários. A partir do
deploy da autenticação, a senha entra hasheada com scrypt e a antiga é convertida
no primeiro login bem-sucedido.

⚠️ **O risco real aqui é fora do sistema:** senha reaproveitada em e-mail, banco
ou rede social. Peça a cada um que troque **onde mais usava a mesma senha**.

### 6. Evolution / Webshare / Anthropic — avaliar, não presumir

Estas **não eram devolvidas por nenhuma rota aberta** — vivem só como variável de
ambiente. Não constam como vazadas.

Rotacione apenas se houver outro motivo (chave compartilhada por fora, ex-membro
da equipe com acesso à Vercel). Trocar sem necessidade custa downtime: a chave da
Evolution derruba o WhatsApp de todos os clientes até ser atualizada.

---

## O que NÃO precisa rotacionar

- **`CRON_SECRET` / `REPORTS_CRON_SECRET`** — nunca foram devolvidos por rota
  alguma. Estão na crontab da VPS (acesso root) e nos secrets do GitHub.
- **`SESSION_SECRET`** — criado depois da correção; nunca esteve exposto.
  Trocá-lo desloga todo mundo e invalida o token de chamadas internas.
- **`DATABASE_URL`** — não era exposta. Mas confira se o Postgres aceita conexão
  de qualquer IP; se sim, restrinja.

---

## Depois de rotacionar: ligue a cifragem do Cofre

A coluna `password_enc` **nunca cifrou nada** — o nome mentia. Agora cifra de
verdade (AES-256-GCM), mas depende de uma chave:

1. Gere: `openssl rand -base64 48`
2. Cadastre na Vercel como **`VAULT_KEY`** (Production e Preview) e faça redeploy.
3. Migre o que já existe: `POST /api/vault/migrar` (só administrador). O `GET` da
   mesma rota mostra quantas ainda estão em texto puro, sem alterar nada.

⚠️ **`VAULT_KEY` não é derivada do `SESSION_SECRET` de propósito.** Se fosse,
rotacionar a chave de sessão — coisa rotineira — tornaria o Cofre inteiro
indecifrável. Guarde-a onde você guardaria uma chave mestra; perdê-la significa
perder as senhas gravadas.

Sem `VAULT_KEY` configurada: leitura do que já existe continua funcionando, mas
**gravar senha nova é recusado** (erro 503). É deliberado — sem chave, gravar
seria voltar a produzir texto puro.

---

## Estado verificado em produção

| Rota que vazava | Hoje |
|---|---|
| `/api/vault` | 401 |
| `/api/google/connections` | 401 |
| `/api/meta/connections` | 401 |
| `/api/users?login=1` | 401 |
| `/api/whatsapp-pixel` | 401 |
| `/api/upload` | 401 |
| `/api/permissions` | 401 |
| `/api/admin/instances` | 401 |

⚠️ **Fechado para anônimo, não para usuário logado.** Qualquer sessão válida —
inclusive um Visualizador — ainda lê o Cofre inteiro e os tokens de todos os
clientes. Restringir por dono é a fase seguinte, ainda pendente. Enquanto isso,
trate cada login criado como acesso total.
