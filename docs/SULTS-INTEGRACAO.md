# Integração SULTS — envio de leads (CondoStore)

Ciclo completo, nos dois sentidos:

- **Ida** — todo lead novo do reports vira negócio no CRM de Expansão do SULTS.
- **Volta** — as etapas e o ganho/perdido do SULTS voltam para o reports.

⚠️ A volta é **varredura, não push**: a API de Expansão não publica webhook de
saída, e a listagem de negócios não aceita filtro por data de alteração. Cada
rodada lê o funil inteiro e compara com o snapshot anterior.

## Peças

| Arquivo | Papel |
|---|---|
| `src/lib/sults.ts` | Mapeamento puro lead → negócio. Testes: `scratchpad/test-sults.mjs` (55 asserts) |
| `src/lib/sults-server.ts` | Schema, conexão por cliente, cliente HTTP |
| `src/lib/sults-motor.ts` | Ida: fila + POST |
| `src/lib/sults-sync.ts` | Volta: varredura do funil + diff |
| `src/app/api/sults/worker/route.ts` | Cron da ida, 1 min (em `CRON_PREFIXES`) |
| `src/app/api/sults/sync/route.ts` | Cron da volta, 10 min (em `CRON_PREFIXES`) |

Nenhuma rota de ingestão foi alterada. O worker varre `crm_leads` — então LP,
Meta Lead Ads e WhatsApp entram de graça, e uma queda do SULTS não derruba a
recepção de lead de nenhum cliente.

## Ativar um cliente

1. **Pegar o token v1** com o suporte do SULTS. ⚠️ O token **v2 não funciona**
   nos endpoints de Expansão (v1). Se o cliente mandar o token da tela de
   integração com o Make, confirme a versão.

2. **Copiar os IDs** no SULTS do cliente, em **Expansão > Parâmetros**:
   - `responsavel_id` → Equipe > Equipe de Expansão *(obrigatório)*
   - `etapa_id` → Funis > Etapas — a etapa de ENTRADA *(obrigatório)*
   - `origem_id` → Origens de Negócio
   - `campanha_id` → Campanhas

3. **Inserir a conexão** (ainda não há tela — uma linha por cliente):

```sql
INSERT INTO public.sults_connections
  (client_id, api_token, enabled, responsavel_id, etapa_id, origem_id, mapa_origem, desde)
VALUES
  ('<client_id>', '<token_v1>', TRUE, 12, 25, 2,
   '{"meta lead ads": 9, "landing page": 4, "whatsapp": 3}'::jsonb,
   NOW());
```

⚠️ **`desde` nasce em `NOW()` de propósito.** Recuar essa data despeja o
histórico de leads do cliente no CRM dele, e a API de Expansão **não publica
DELETE de negócio** — a limpeza é manual, um a um. Para importar histórico,
recue **um dia por vez** e confira o resultado.

4. **Cron na VPS** (`root@2.25.144.71`), a cada minuto — nunca GitHub Actions,
   que é throttleado neste repo:

```
* * * * * curl -s "https://reports.onmid.app/api/sults/worker?secret=<REPORTS_CRON_SECRET>" > /tmp/onmid-sults.last 2>&1 # onmid-cron
```

5. **Cron da volta**, a cada 10 minutos. Cadência maior de propósito: cada
   rodada lê o funil inteiro, então varrer de minuto em minuto só repetiria as
   mesmas centenas de leituras.

```
*/10 * * * * curl -s "https://reports.onmid.app/api/sults/sync?secret=<REPORTS_CRON_SECRET>" > /tmp/onmid-sults-sync.last 2>&1 # onmid-cron
```

Opcional: preencher `sults_connections.funil_id` para varrer só um funil
(`sync_ativo = FALSE` desliga a volta sem mexer na ida).

## Conferência (o cruzamento em planilha)

```sql
SELECT e.negocio_id, l.nome, l.numero, l.canal, l.campaign_name, e.enviado_em
  FROM public.sults_envios e
  JOIN public.crm_leads l ON l.id = e.lead_id
 WHERE e.client_id = '<client_id>' AND e.status = 'enviado'
 ORDER BY e.enviado_em DESC;
```

`negocio_id` é a chave para casar com o export do SULTS. A mesma chave viaja
na descrição do negócio (primeira linha: `Lead reports: <uuid>`), então dá para
cruzar pelos dois lados.

## Estados da fila

`pendente` → `enviando` → `enviado` · `erro` (vai repetir) · `falha` (desistiu
após 6 tentativas ou erro 4xx) · `descartado` (lead sem contato, ou removido).

### ⚠️ Envio preso em `enviando`

Acontece quando o processo morre entre o POST e a gravação da resposta — e daí
**não dá para saber se o negócio foi criado**. O worker **não reprocessa
sozinho**: reenviar criaria um negócio duplicado que a API não deixa apagar.
O campo `presos` na resposta do worker conta essas linhas.

Recuperação manual: procurar o lead em Expansão (a listagem aceita filtro por
`titulo`) e então
- **achou** → `UPDATE sults_envios SET status='enviado', negocio_id=<id> WHERE id='<envio>';`
- **não achou** → `UPDATE sults_envios SET status='pendente', proximo_em=NOW() WHERE id='<envio>';`

## O que NÃO é enviado

- **`valor_rs`** — no reports é receita de venda fechada; no SULTS `valor` é
  ticket estimado de negócio abrindo. Copiar inverteria o significado.
- **Leads com `time_interno = true`**.
- **Atribuição em campo próprio** — o SULTS não tem. UTM, campanha, conjunto e
  criativo vão no `descricao` do negócio.

## A volta — etapas e ganho/perdido

Duas tabelas:

- **`sults_negocios`** — foto atual de cada negócio (etapa, situação, responsável,
  valor, `duracao_etapas` em JSONB). Uma linha por negócio.
- **`sults_movimentos`** — histórico imutável. Uma linha por mudança de etapa ou
  de situação, com `ocorrido_em`.

⚠️ **A etapa do SULTS NÃO é escrita em `crm_leads.status`.** O funil interno tem
dono — Kanban, follow-up, análise de IA e disparo de conversão por status leem e
escrevem nele. Dois sistemas brigando pela mesma coluna de texto livre já
produziu lead sumido do Kanban antes. A etapa do cliente vive ao lado; quem quer
as duas faz JOIN por `lead_id`.

⚠️ **Primeira varredura não gera movimento.** Um funil que já existe seria visto
inteiro pela primeira vez e viraria centenas de "mudou de etapa" com a data de
hoje. O estado inicial fica no snapshot; movimento só quando algo muda.

`ocorrido_em` vem de `duracaoEtapa[].dtUltimaVez` — quando o vendedor arrastou o
card, não quando o cron reparou. **Última** passagem, não a primeira: negócio que
regrediu e voltou contaria tempo desde o início. Troca só de situação cai no
relógio da varredura (`duracaoEtapa` não registra isso).

Negócio cadastrado à mão no SULTS entra com `lead_id` nulo — o funil do cliente
aparece inteiro, não só a parte que saiu daqui.

### Movimentação de um lead

```sql
SELECT m.ocorrido_em, m.etapa_de_nome, m.etapa_para_nome, m.situacao_para_nome,
       l.nome, l.canal, l.campaign_name
  FROM public.sults_movimentos m
  LEFT JOIN public.crm_leads l ON l.id = m.lead_id
 WHERE m.client_id = '<client_id>'
 ORDER BY m.ocorrido_em DESC;
```

### Funil por etapa, com origem do lead

```sql
SELECT n.etapa_nome, COUNT(*) AS negocios,
       COUNT(n.lead_id) AS vindos_do_reports,
       SUM(COALESCE(n.valor, 0)) AS valor
  FROM public.sults_negocios n
 WHERE n.client_id = '<client_id>' AND n.situacao_id = 1
 GROUP BY n.etapa_nome ORDER BY negocios DESC;
```

## Próximo passo natural

Tela em `/integracoes` para editar a conexão sem SQL, no molde de
`/integracoes/leadlovers`, e um painel de funil na aba do cliente lendo
`sults_negocios` + `sults_movimentos`.
