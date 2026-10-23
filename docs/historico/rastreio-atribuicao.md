# Histórico — Rastreio de leads, atribuição, conversões, formulários Meta, aviso de lead no grupo e landing pages

Movido do CLAUDE.md em 2026-10-22 (conteúdo original, sem edição). Entrada nova deste setor entra aqui, no topo, não no CLAUDE.md.

## Conversão Meta — `page_id` da Página do ANÚNCIO, não fixo por cliente (2026-10-23)

Pergunta do Matheus ("estamos enviando para o Meta?") → `conversion_log` da Cost: envio saudável desde 16/10 (10–16 Lead/dia, Purchase ok), mas 6 Leads recusados com **subcode 2804072 "page_id e ctwa_clid não correspondentes"**. Todos do anúncio `120251591497360751` (Implantes, Página da **Dra. Tayná** `1320410274483948`), enquanto `client_conversion_config.meta_page_id` é a Página da **Cost** (`1980619558831070`).

- **Regra da Meta**: em evento de mensagem (`business_messaging`), o `ctwa_clid` é gerado pela Página do anúncio e o `page_id` enviado tem de ser essa mesma Página. Um `meta_page_id` fixo por cliente só serve para quem anuncia por uma Página.
- **Correção**: `resolverPaginaDoAnuncio` (`meta-ad-resolver.ts`) lê a Página do criativo do anúncio (`object_story_spec.page_id` → `actor_id` → prefixo de `effective_object_story_id`) com o token de Ads do cliente, cache em `meta_ad_page_cache` (DDL memoizado; a Página de um anúncio não muda). `enviarEventoMeta`: **com `ctwa_clid`**, usa a Página do anúncio do lead (`leadData.sourceId` ou `crm_leads.source_id` pelo id) e cai no `meta_page_id` do config se não resolver. Sem `ctwa_clid`, nada muda.
- Os 6 recusados **não foram reenviados** (retroativo nunca dispara conversão).
- ✅ 13 asserts (`scratchpad/test-pagina-anuncio.mjs`: pura, cache, Graph, payload com a Página da Tayná, fallback) + Graph conferida em produção (Implantes → Tayná, Protocolo → Cost).


## Formulário da Meta — 276 leads pagos perdidos porque o webhook não entrega, e nada na API diz por quê (2026-10-15)

Queixa do Matheus (print do Kanban do SULTS do CondoStore): "no sults não consta todos os leads que chegaram. Só no meta ads temos 75 formulários".

- **Confirmado e muito maior que a queixa**: o formulário ativo `[ON] [65_100] [NOVO] [JUNHO26]` tem **276 respostas** (jul 29 · ago 40 · set 131 · **out 76**), **275 com telefone**, e **nenhuma jamais chegou ao CRM**. Os 76 de outubro são exatamente os que ele viu no Meta Ads.
- **⚠️ A configuração está TODA correta — não há nada a consertar nela.** Medido: Página `112045230489360` assinada no nosso app com `leadgen`; app com `object=page active=true fields=[leadgen] url=https://reports.onmid.app/api/meta/webhook`; mapa Página→cliente presente; formulário registrado; `leadgen_tos_accepted: true`; `is_published: true`; `tasks` inclui `MANAGE_LEADS` **e `MANAGE`** (mais que a Incorpast, que funciona). Comparei lado a lado com Incorpast e SorriLeve, que recebem normalmente pelo MESMO endpoint no MESMO período (Incorpast 163 leads, último no dia da investigação): **as três páginas são idênticas na configuração**. A entrega da Meta para aquela Página simplesmente não acontece, e **falha calada** — nenhum campo da API explica.
- **⚠️ Lição que generaliza: webhook de terceiro não é fonte confiável de lead.** Quando ele falha, falha em silêncio, e o prejuízo é lead de anúncio PAGO que ninguém atende por meses. A API entrega as respostas sob demanda, então a varredura é a rede de segurança — e, no cron, a garantia para qualquer cliente.
- **`src/lib/meta-leadgen-recuperar.ts` + `GET /api/social-monitor/refresh/leadgen-recuperar`** (`?clientId=&dias=&dry=1`): reusa **`processLeadgenEvent`**, o MESMO caminho do webhook. A dedupe por `leadgen:{id}` em `lead_tracking_events` é o que deixa as duas portas conviverem sem criar lead em dobro, e **nem `processLeadgenEvent` nem `upsertLeadFromConversation` disparam follow-up ou conversão** (conferido na fonte) — é isso que torna seguro varrer meses de histórico sem mandar WhatsApp para quem falou semanas atrás nem reenviar venda velha para Meta/Google.
- **⚠️ A lista de formulários é a UNIÃO de TRÊS fontes, e isso não é redundância decorativa**: `GET /{page}/leadgen_forms` devolve **lista vazia com o token de USUÁRIO** e 23 formulários **com o token de PÁGINA** — a mesma credencial lê `GET /{form}/leads` nos dois casos. Depender de uma fonte só faria a recuperação "rodar com sucesso" sem achar nada, a pior falha possível aqui. Entram: a listagem da Meta, `meta_leadgen_forms` e o `lead_gen_form_id` dos **criativos** (o formulário que está de fato rodando hoje).
- **⚠️ O corte por data depende da ordem** — medido: `/{form}/leads` devolve **novo→velho**, então ao cruzar a janela a paginação para. Se a Meta inverter, a varredura passa a devolver menos do que existe.
- **⚠️ Mora debaixo de `/api/social-monitor/refresh`** de propósito (mesma razão da rota irmã `leadgen`): o proxy libera cron por PREFIXO e esse já está em `CRON_PREFIXES` — a rota nasce sem tocar no `proxy.ts`, que estava com trabalho de outra sessão.
- ✅ **76 leads de outubro recuperados em produção** (dry 76 → real 76, zero falhas, 49s), com nome, telefone, campanha, conjunto e criativo. A distribuição por campanha bate com a da Meta (NACIONAL 38 · BAURU 12 · DIRETO 10 · RIBEIRÃO 6 · JOINVILLE 3 · CAMPO MOURÃO 3 · MARINGÁ 2 · CWB 1 · +1), e os **2 que já existiam no CondoStore casaram por telefone mantendo o canal original** (`LP | CondoStore`, `Indicação`) — identidade é de quem viu o lead primeiro.
- **Cron na VPS, `*/15` com `dias=2`** (backup em `/root/crontab-backup-antes-leadgen-recuperar.txt`). ⚠️ **A janela curta é deliberada**: com `dias=30` o cron despejaria retroativo de 30 dias no CRM do cliente a cada vez que alguém assinasse uma Página nova. Retroativo é decisão humana, uma rodada manual com `dias=` maior.
- **⚠️⚠️ A Ida do SULTS filtra por `created_at` do lead, que é o de AGORA** — então **todo lead recuperado vira negócio no SULTS**, e **a API deles não apaga negócio** (só criar/listar/timeline). Recuperar 276 significa 276 negócios irreversíveis no CRM do cliente. Por isso só outubro foi executado; jul–set (200 leads) ficou como decisão do Matheus.
- ⚠️ **A varredura da carteira achou a MESMA falha na Sorrifácil Itapema: 12 leads de formulário perdidos** (e mais 24 do CondoStore em setembro). **Não executados** — recuperar lead de até 30 dias em cliente de clínica é decisão dele. O dry da carteira estoura o orçamento de 240s em 36 de 39 clientes (`semTempo: true`), então pode haver mais escondido nos que não foram varridos.
- **⚠️⚠️ A ORIGEM SAI DA PLATAFORMA REAL, e eu errei isso primeiro.** Mapeei "Formulário Meta" → **Facebook** porque a Página que hospeda o formulário é do Facebook; fui conferir antes de entregar a lista e **dos 76 leads de outubro, 68 vieram do INSTAGRAM e 8 do Facebook** — o carimbo erraria 89%, bem na coluna que o cliente usa para decidir onde investir. O nó Lead traz **`platform` (`'ig'` | `'fb'`)**, que nem pedíamos no `fields`. Agora `origin` vira `'instagram'` ou `'meta'` conforme o lugar em que a pessoa preencheu — e `'instagram'` já é valor que o resto do sistema entende (a Biblioteca de Criativos separa `ig_leads` por ele), então o conserto vale em duas telas, não só no espelho do SULTS. O mapa do CondoStore ficou `{lp:12, meta:2, facebook:2, instagram:1}`; **`'formulário meta'` foi REMOVIDO do mapa de propósito** — como o canal é testado ANTES do origin, deixá-lo lá faria o rótulo vencer a plataforma e todo lead voltaria a nascer Facebook. Provado com 8 asserts sobre o mapa real (LP continua Landing Page mesmo com tráfego do Instagram; WhatsApp orgânico não vira Facebook).
- **⚠️ A API do SULTS não edita negócio — reconfirmado com 8 variações** (`PUT`/`PATCH`/`POST`, id na URL e no corpo, campo `origem` e `origemId`, corpo mínimo e completo): 404 ou `{"error":"Request Errado"}`, e a origem seguiu nula. Então os **74 negócios já criados ficam sem origem** e só se corrigem no painel; a lista com a origem certa de cada um (66 Instagram · 8 Facebook) foi entregue em `scratchpad/sults-condostore-origem-74-negocios.csv`. ⚠️ O `400 "Request Errado"` é genérico e **não significa "quase lá"** — gastei uma rodada tentando achar o corpo certo de um endpoint que não existe.
- **⚠️ A varredura da carteira é em RODÍZIO, não alfabética** (`meta_leadgen_paginas.recuperado_em`, ordem `NULLS FIRST`). A primeira rodada do cron gravou saída **vazia**: a carteira não cabe nos 240s. Ordenada por nome, varreria sempre os mesmos primeiros clientes e quem está no fim do alfabeto (justamente a **Sorrifácil Itapema**, onde achei a mesma falha) nunca seria olhado — a mesma falha invisível que estávamos consertando, agora do nosso lado. E formulário com `leads_count = 0` deixou de ser consultado: no CondoStore isso tira **22 das 23** chamadas. O zero só é obedecido quando vem da listagem da Meta, que é quem sabe o número.
- **⚠️⚠️ REPETI o erro do `ALTER TABLE` em caminho quente** (o mesmo que causou o apagão do CRM em 16/09/2026): criei a coluna do rodízio com um `ALTER TABLE ... IF NOT EXISTS` a cada chamada da rota. Ele pede lock **ACCESS EXCLUSIVE mesmo quando é no-op**, e a rota é chamada pelo cron de 15 em 15 min — duas execuções que se cruzam se enfileiram no lock e a requisição morre: a carteira passou a devolver **502 depois de 70s** enquanto um cliente sozinho respondia em 8s. Memoizado por processo. **Regra: rota chamada por cron nunca roda DDL sem memoização.**
- ✅ **Estado final medido**: carteira inteira em **140s com `semTempo: false`** (antes estourava os 240s em 36 de 39), **41 clientes varridos** — 23 com formulário, 18 sem lead ads. CondoStore sozinho em **8,2s** varrendo 1 formulário em vez de 23, com `novos: 0 · jaTinha: 11` nos últimos 2 dias: a recuperação já está acompanhando os leads novos sozinha.
- ⚠️ Os 36 eventos de "formulário" que o CondoStore já tinha eram **todos da LP** (34 + 2 da LP Mercado), nenhum de leadgen — não confundir as duas portas ao medir.

## CondoStore — os 3 canais da mesma landing page viraram um (2026-09-30)

Decisão do Matheus, fechando a pergunta dele de ontem ("LP | CondoStore, Landing Page (Google) e Google Ads é tudo a mesma coisa"): **unificar em "Landing Page (Google)", só para o CondoStore.**

- **`FUSOES_CANAL` em `src/lib/canal-lead.ts`** — mapa `client_id → [{destino, origens}]` que vira branches no TOPO do `CASE` de `canalSql`. Mora na lib porque o donut (`/api/crm/por-canal`) e a lista de leads do funil (`/api/crm/funil-leads`) leem dela: fundir num só lugar é o que impede o gráfico e a lista de discordarem sobre o mesmo lead.
- **⚠️ A fusão casa contra a coluna `canal` CRUA e entra ANTES da leitura de click id** — ou seja, para o cliente listado o canal declarado VENCE o `gclid`. Não é detalhe: os 4 leads que apareciam como "Google Ads" no CondoStore **eram todos de landing page** (3 com `canal='LP | CondoStore'`, 1 da `/mercado`) — o `gclid` só sobreviveu neles. Fundir pelo rótulo DERIVADO teria arrastado o lead da outra LP junto.
- **⚠️ A LP `/mercado` ficou FORA da fusão, com entrada própria de um item só** (`destino: 'LP | CondoStore Mercado'`). As duas páginas foram criadas em 13/09 para níveis de consciência diferentes; juntá-las apagaria justamente a medição que justifica existirem duas. A entrada de um item não funde nada — serve só para o canal declarado vencer o `gclid` ali também, senão aquele lead **reaparecia como "Google Ads"**, o rótulo genérico que a fusão veio tirar da tela.
- **⚠️ Fusão é POR CLIENTE, nunca global**: em outras contas "Google Ads" e uma landing page são canais legitimamente distintos, e juntá-los apagaria a medição de quem paga por clique.
- **Nada foi escrito no banco.** É derivação na leitura, então reverter é apagar a entrada do mapa — e a coluna `canal` continua guardando o rótulo que o CRM do cliente mandou.
- ✅ **Provado contra produção comparando a expressão NOVA × a do HEAD** (as duas compiladas da lib real, não replicadas — a réplica é o erro clássico aqui), varrendo a base inteira: **17 linhas mudam de rótulo, TODAS do CondoStore** (14 `LP | CondoStore` + 3 `Google Ads` → `Landing Page (Google)`; 1 `Google Ads` → `LP | CondoStore Mercado`), **0 clientes afetados fora dele**, e total de leads/receita idênticos (1.997 / R$ 689.000 — nada perdido nem duplicado). Estado final: 818 Landing Page (Google) · 589 Indicação · 321 Instagram · 150 Facebook · 106 Whatsapp · 10 sults · 1 LP | CondoStore Mercado · 1 Recompra · 1 sem canal, e **"Google Ads" não existe mais nesse cliente**. tsc + `next build` + eslint limpos.
- ⚠️ A cor da fatia vem de hash do NOME do canal (decisão de 2026-08-16), então "Landing Page (Google)" mantém o tom que já tinha — comparar dois períodos continua possível.
- ⚠️ **Unificar na FONTE segue sendo o melhor caminho** e não foi feito: as duas origens estão cadastradas assim no SULTS do CondoStore, e enquanto existirem lá todo lead novo continua nascendo com um dos dois rótulos. Isto é a correção na exibição; mesclar as origens no painel do cliente é decisão do CondoStore.


## Biblioteca de Anúncios — galeria do que RODOU no Meta, todas as contas (2026-09-30)

Pedido do Matheus depois da auditoria da CondoStore ("tem criativo falando de Curitiba indo para Joinville"): a galeria que montei como artefato virou aba do produto — "quero idêntico ao que criou". Aba **Anúncios** no Radar (`/resultados/anuncios`, 4ª aba de `results-tabs.tsx`, herda a flag `radar`).

- **É outra coisa que a aba Criativos**: aquela ranqueia pelo CRM (lead/venda por criativo); esta mostra o que ENTREGOU no Meta, conta a conta — capa, campanha, gasto, leads, status, prévia oficial (`preview_shareable_link`) e o alerta de cidade. Só entra anúncio com impressão no período (insights `level=ad`); anúncio criado e nunca veiculado não aparece, de propósito.
- **`src/lib/biblioteca-anuncios-ui.ts` (pura, 42 asserts em `scratchpad/test-biblioteca-anuncios.mjs`)**: `cidadesCitadas` casa por palavra inteira, sem acento, MAIS LONGO primeiro ("São José do Rio Preto" não vira "São José"; "curitibano" não é Curitiba); `alertaDeCidade` → `cidade` (campanha mira cidade X, criativo cita Y) ou `cidade_fraco` (campanha nacional/estadual citando cidade). Catálogo = `CIDADES_BASE` + tudo que a própria conta segmenta (cidade nova entra sozinha).
- **⚠️ Pin de raio (`custom_locations`) não traz nome de cidade, só `primary_city_id`** — resolvido em lote por `search?type=adgeolocationmeta&cities=[ids]`. Sem isso, toda campanha com pin (Panino "10KM", CondoStore "CONDOMÍNIOS_SELECIONADOS") virava "alerta fraco" falso: medido ANTES 10 e 8 alertas ruidosos nas duas contas, DEPOIS 0. Pin que não resolve = alvo indeterminável = alerta mudo (`alvoIndefinido`), nunca alerta.
- **⚠️ O alerta lê TEXTO** (legenda, título, nome do anúncio, nome do criativo). Cidade falada no áudio ou escrita DENTRO do vídeo (o caso real "Atenção Curitiba" do "DARK - VÍDEO 01") NÃO é detectada — a tela diz isso no banner. Conferência visual continua manual.
- **Cache `biblioteca_anuncios_cache` por (cliente, conta, dias), TTL 6h**; coleta que falha guarda o erro e PRESERVA o último payload bom. A rota (`GET /api/biblioteca-anuncios?days&clientId&refresh=1`) coleta o que falta dentro de um orçamento de 50s (concorrência 3) e devolve `pendentes`; a tela chama de novo a cada 1,5s até zerar e a galeria cresce na frente do usuário. Medido: CondoStore 61 anúncios em ~7s, Panino Curitiba 40 em ~5s (4–8 chamadas por conta). Carteira inteira na 1ª abertura = alguns minutos em rodadas; depois abre do cache. Capa = `picture` do vídeo (a `thumbnail_url` do creative tem 64px) — URL do fbcdn expira, o TTL cobre.
- **⚠️ Duas lições de código**: (1) `react-hooks/set-state-in-effect` — em vez do `useEffect(() => { void load() })` da aba vizinha (que carrega o erro pré-existente), o fetch mora dentro do efeito e os setState só na resposta; `pedido` (contador) é o gatilho do Atualizar e das rodadas, `AbortController` cancela o pedido anterior (trocar período no meio da coleta não empilha nem trava). (2) Paginação da Graph com `let url` reatribuída a partir da resposta dá TS7022 (tipo circular) — `const atual: string = proxima` antes da chamada resolve.
- **⚠️ Receita de preview atualizada**: mock de `window.fetch` no login com `?next=/resultados/anuncios` (o login faz `router.push(next)` sem reload e o mock sobrevive). O patch PRECISA tratar `input` como `URL` (`input instanceof URL ? input.href : input.url`) — sem isso a navegação RSC do Next quebra e cai em reload completo, matando o mock. E o `/api/ai-usage` mockado precisa de `month.{cost_brl,calls,input_tokens,output_tokens}`, senão o `AIUsagePill` do shell derruba a página inteira. Dev server de worktree: entrada temporária no `.claude/launch.json` do repo principal com `bash -lc "cd <worktree> && npx next dev -p 3017"` (revertida depois).
- **⚠️ Dois consertos que só a produção mostrou** (1ª coleta da carteira deu 500): (1) legenda com emoji cortada por `slice` deixava surrogate órfão e o Postgres recusava o JSON da carteira INTEIRA (`22P02`) — a mesma lição do relatório de 1 ano (2026-08-06); `cortarTexto` corta por code point e limpa órfãos, e falha no INSERT vira erro da conta, não 500 da rota. (2) Cidade que também é palavra comum ("**vitória** de Mauro Ribeiro" virou Vitória/ES; canela, gramado, bauru, santos…) — `CIDADES_AMBIGUAS` não conta no texto livre do anúncio (`textoLivre: true`), mas segue valendo como alvo (vem da segmentação ou do nome da campanha).
- ✅ Verificado: tsc + eslint limpos; `next build` com rota e página registradas; 58 asserts; browser com mock dos 81 anúncios reais — filtros de alerta e cidade, mobile 375px sem overflow. **Em produção (`c711008b`)**: 401 sem cookie; CondoStore 61 anúncios em 6,9 s e 33 ms do cache; **carteira inteira: 37 contas, 2.222 anúncios, 0 erros, em 2 rodadas (56 s + 34 s)**. ⚠️ O que parecia o 1º achado real (**Atibaia Imóveis** mirando **Apucarana**) era a MARCA no texto: a imobiliária se chama Atibaia e fica em Apucarana ("casa em Apucarana… Atibaia Imóveis"). Regra: `ignorar = [nome do cliente, ...cidades contidas no nome]` é apagado do texto antes da busca — só o nome exato não bastava, os anúncios assinam "Atibaia **Corretora de** Imóveis". Cidade que dá nome ao cliente é marca, nunca destino (mesma lição do `termoTemMarca` das negativas do Google). Conta que falha na coleta (Romanza estourou o timeout da Graph numa rodada) tenta de novo em **10 min** (`CACHE_TTL_ERRO_MS`), não em 6h; timeout da Graph subiu para 40 s.

## Rastreio do Google — a palavra-chave chegava e era JOGADA FORA (2026-09-29)

Print do Matheus (lead "Samara Assalin", CondoStore): "não está rastreando via UTM. Era para termos ali a campanha, a palavra-chave". A campanha estava lá; **palavra-chave, dispositivo e correspondência, não** — e o dado CHEGAVA.

- **⚠️ O defeito era uma LISTA DE CHAVES curta demais.** `extractTrackingFromText` lê a URL da LP com `TEXT_PARAM_KEYS`, que tinha só os 5 `utm_*` + os click ids. O `final_url_suffix` das contas manda `keyword={keyword}&matchtype={matchtype}&device={device}` — tudo isso era lido e **descartado em silêncio**, porque a chave não estava na lista. Nenhum erro, nenhum log: o parâmetro simplesmente não existia para o código.
- **`URL_PARAM_KEYS` (nova) é deliberadamente MAIOR que `TEXT_PARAM_KEYS`**: a URL é fonte estruturada (veio do Google), texto solto de conversa não é. Ler `device=` de uma frase digitada por humano seria inventar rastreio. Assert cobre as duas pontas.
- **⚠️ `keyword` NUNCA cai de `utm_term`** (regressão coberta por assert): o template Meta usa `utm_term={{adset.name}}` — o fallback poluiria a coluna com nome de conjunto.
- **Alcance medido antes de corrigir**: 43.782 leads/90d, e só **5** tinham `keyword` recuperável — não porque o bug fosse pequeno, mas porque pouquíssimo lead entra por formulário de LP. **16 das 19 contas** mandam `keyword` no sufixo, então o bug valia para a carteira quase inteira, só esperando volume.
- ✅ **Backfill: 5 de 5** recuperados do `source_url` já gravado (fill-blanks) — "dentista" (Sorrifácil São José), "franquia de supermercado", "franquias", "franquia para investir", "franquia mercado autonomo" (CondoStore). Estado final: 19 leads com palavra-chave, **0 pendentes**.

### Grupo de anúncios: o Google não tem macro de NOME, só de id

- **`adgroupid` + `gad_campaignid` entraram no rastreio** e o NOME do grupo é resolvido depois pelo `resolverNomesGoogle`, que já existia (era usado só para campanha). `gad_campaignid` é o id que o Google acrescenta sozinho pelo auto-tagging — serve de campanha em conta **sem** sufixo.
- **⚠️ Na rota da LP, o corpo do POST é o fallback errado**: a LP raramente manda `adgroupid`; quem traz é a URL. A ordem passou a ser corpo → URL (`tracking.adgroupid`), e não o contrário.
- **`&adgroupid={adgroupid}` aplicado nas 16 contas** que já tinham sufixo, e **conferido relendo da API** (16 com o parâmetro, 3 sem sufixo nenhum). ⚠️ **Sufixo NÃO manda anúncio para revisão** (confirmado de novo: CondoStore seguiu 8 aprovados, 0 reprovado) — `tracking_url_template` manda. É por isso que toda UTM de conta vai no SUFIXO.
- **⚠️ `customers:mutate` NÃO existe**: o endpoint é `POST /v24/customers/{cid}:mutate` (dois-pontos colado no id, sem segmento extra). Com o caminho errado a API devolve corpo vazio e o script imprime "ERRO: null" — **nenhuma conta foi alterada** e é fácil confundir com erro de permissão. Sempre imprimir `await r.text()` antes do `JSON.parse`.
- ⚠️ **3 contas seguem sem sufixo nenhum** (Sorrifácil ingleses, Panino77 Curitiba, Leandro Ary) — não ligado, é decisão do Matheus. Ingleses tem de brinde um `tracking_url_template` de conta com `gad_source={gclid}`, e **`{gclid}` não é macro ValueTrack** — esse parâmetro sempre chegou vazio lá.

### ⚠️ O botão de WhatsApp na web continua CEGO (medido, não corrigido)

- Em 90 dias: **0 leads com `click_code`**. Os links `/r/` tiveram 152 cliques e **nenhum casou** com lead. Os 8 `lp-implantes-*` criados em 24/09 só registram os meus cliques de teste — foram construídos e **nunca instalados**.
- O link de maior volume (`ughmny`, Itapema, **10.684 cliques**) recebe tráfego **sem UTM, sem gclid e sem referer**: está colado cru em algum lugar (bio/QR). Mesmo que o código chegasse, não haveria campanha para atribuir.
- ⚠️ 4 mensagens com "COD:" no período eram clientes da Incorpast citando código de produto do catálogo, **não** o nosso código. Falso positivo — conferir o texto antes de comemorar casamento.
- A correção não é de código: é **trocar os botões de WhatsApp (anúncio e LP) por links `/r/`**, cliente a cliente. Não feito.

## Aviso no grupo: negrito no rótulo e na identificação (2026-09-29, 5ª rodada)

Pedido do Matheus depois de ver os dois primeiros avisos reais: nome, telefone, e-mail, `Campanha:`, `Conjunto:`, `Criativo:`, `Região:` e as perguntas do formulário em **negrito**.

- **Negrito no RÓTULO, valor normal** — é o rótulo que guia o olho descendo a mensagem; pôr os dois em negrito não destacaria nada. A identificação (nome, telefone, e-mail) vai inteira em negrito porque é o que a pessoa procura primeiro e o que ela copia para ligar.
- **⚠️ `*` é o marcador de negrito do WhatsApp, então ele não pode sobreviver dentro de um VALOR**: um asterisco solto num nome de campanha pareia com o `*` que abre o rótulo seguinte e deixa metade da mensagem em negrito. `semMarcacao` remove o `*` de todo texto interpolado — em nome de campanha e resposta de formulário ele não carrega significado nenhum. Assert conta os asteriscos e exige número **par**, que é o que garante que nenhum negrito fica aberto.
- Pergunta que já termina em `?`/`!`/`:` **não ganha dois-pontos**: "Qual nome da empresa?:" é pontuação em cima de pontuação. Assert proíbe `?:` na mensagem.
- ✅ Verificado: **90 asserts** (negrito em cada peça, `?:` proibido, asteriscos pareados, dado sujo com `*` não desalinha e preserva o texto); tsc + `next build` limpos; prévia do lead REAL do Incorpast renderizada com e sem os marcadores.
- ⚠️ Vale para os PRÓXIMOS avisos. Os dois já entregues (Incorpast e Romanza, 13:35) ficam como foram — `lead_aviso_envios.texto` guarda o texto exato de então, e é assim que o histórico não mente.

## Aviso de lead: nasce LIGADO e ganhou fila de reenvio visível (2026-09-29, 4ª rodada)

Pedido do Matheus depois de testar o formulário da Romanza e o aviso não chegar: *"deixa como padrão, assim que configurar a integração, deixar como ativo. E se por algum acaso os disparos não forem, precisa criar uma fila de envios para quando retomar enviar todos os pendentes. Inclusive essa relação de pendência, tem que estar mostrando."*

- **O diagnóstico da Romanza fechou em `ativo=false`, e a cadeia toda estava certa**: lead no CRM ✓, evento `formulario` com prefixo `lp:` ✓, grupo configurado ✓, fontes ✓, `desde` anterior ao lead ✓. O worker via **1 evento elegível parado**. ⚠️ Configurar e não ligar era um passo INVISÍVEL — 16 clientes ficaram com grupo definido e nada saindo, sem nada na tela explicando. Por isso o padrão mudou.
- **Nasce ligado na TRANSIÇÃO sem grupo → com grupo**, não em qualquer PATCH: quem desligou de propósito e depois mexe nas fontes não é religado pelas costas. E o `desde` é reposicionado também nessa ligação automática — senão ligar por tabela despejaria o histórico que o marco existe para conter.
- **A fila trocou a ordem do motor: ENFILEIRAR → DESTRAVAR → ENVIAR.** Antes o envio e o registro eram o mesmo passo, e falha virava `erro` para sempre (o LEFT JOIN nunca mais olhava aquele evento). Agora a intenção de avisar fica gravada como `pendente` com o texto já montado, e o envio é um passo separado que pode falhar e ser repetido. Backoff 1/2/5/15/30/60 min, teto de 60, **`MAX_TENTATIVAS=24`** (mais de 12 h insistindo).
- **⚠️ Desistir NÃO é perder**: no teto a linha vira `falha` e **continua na tela**, com o motivo e um botão "Tentar agora" que a devolve para a fila (mesma linha, preservando o texto — criar outra inflaria a contagem a cada tentativa, lição de `fidelidade_envios`).
- **⚠️⚠️ Linha presa em `enviando` VOLTA para a fila depois de 10 min — e isso contraria o SULTS de propósito.** Lá, envio preso não é reprocessado porque criaria um negócio duplicado que só sai na mão. Aqui a contrapartida é outra: duplicata é barulho num grupo, silêncio é um lead que ninguém liga — e foi exatamente isso que o Matheus pediu para não acontecer. A causa dominante, aliás, é **redeploy no meio do tick** (visto em 29/09: o cron gravou `Bad Gateway` às 15:50 porque o container reiniciou naquele minuto), e nesse caso o request morre antes de sair. A linha carrega `tentativas > 0`, então a tela explica uma eventual repetição em vez de parecer defeito.
- **Cliente desligado: a fila ESPERA, não perde e não acumula.** O worker filtra `ativo = TRUE`, então pendente fica parado — e evento novo **não é enfileirado** enquanto estiver desligado, senão religar despejaria tudo de uma vez.
- **A fila aparece no card** (faixa laranja com "N na fila · N enviando · N desistiram · próxima tentativa …"), porque aviso que não saiu e não aparece em lugar nenhum é indistinguível de aviso que nunca existiu. Status em português (`Na fila`/`Enviando`/`Entregue`/`Desistiu`) — `pendente` cru não diz nada a quem olha.
- ⚠️ **Crase em comentário SQL dentro de template literal me pegou pela TERCEIRA vez hoje** (depois de `e8fe88b` e do LATERAL do alerta de saldo). Passei uma varredura no arquivo inteiro procurando o padrão; os comentários do SQL agora avisam na própria linha.
- ✅ Verificado: **78 asserts** puros (backoff satura, nunca agenda no passado, índice negativo não quebra) + **12 asserts do MOTOR contra o banco REAL**, numa transação com ROLLBACK: falha → volta para a fila com `tentativas=1` e horário futuro; segunda rodada respeita o backoff; na retomada entrega e limpa o erro; entregue não é reenviado; preso em `enviando` volta e é entregue; desligado espera sem perder e sem enfileirar evento novo. tsc + `next build` limpos; **browser** com as três linhas (`NA FILA · 3ª TENTATIVA`, `DESISTIU · 24ª TENTATIVA`, `ENTREGUE`), botão só nas duas não entregues e o PATCH saindo como `{"reenviar":"e1"}`.

## O aviso no grupo passou a levar o criativo e as respostas do formulário (2026-09-29, 3ª rodada)

Pergunta do Matheus: *"Quero que inclua a parte de criativos nos disparos de leads nos grupos. e também as respostas dos formulários, isso já está em vigor?"* — **o criativo já estava no código e as respostas não.** E ele só não viu o criativo porque **a mensagem de TESTE mandava `anuncio: null`**: o exemplo mostrava Campanha e Região e nada mais, então o teste mentia sobre o que um lead real carrega. Exemplo corrigido junto.

- **Medido antes de escrever** (é o que decidiu o desenho): nos 60 dias, **253 eventos de Meta Forms com campanha, conjunto, criativo e `source_id` — 100% preenchidos**; e **37 de landing page com ZERO** desses campos no evento. Mas o nome da campanha da LP **existe**, gravado em `crm_leads` pelo `google-ad-resolver` (18 de 37) — nunca no evento.
- **⚠️ Por isso a consulta faz `COALESCE(e.campo, l.campo)`, nesta ordem.** Só o evento deixaria toda LP sem campanha; só o lead mentiria em quem já era lead, porque `crm_leads` é first-touch e guarda a PRIMEIRA campanha. O evento descreve esta submissão e vence; o lead é a rede.
- **As respostas saem do `raw` do EVENTO, não de `crm_leads.observacao`** — a observação é fill-blanks, então em quem já era lead ela descreve um formulário antigo e o aviso falaria da submissão errada. Dois formatos, porque as duas portas gravam diferente: Meta em `field_data: [{name, values}]`, LP em `observacao` de texto (`"Pergunta: resposta"` separado por quebra de linha ou ` | `) mais `cidade` em campo próprio.
- **⚠️⚠️ O Meta entrega pergunta E resposta como SLUG** — e eu só tinha tratado a pergunta. A prévia sobre dados reais mostrou `implante_unitário_` e `tarde_—_das_14h_às_18h` indo para o grupo do cliente; foi a prévia que pegou, não o teste. `humanizarValor` só desfaz o slug quando o valor **parece** um (tem `_`, não tem espaço) e **nunca** toca e-mail, url ou caminho: trocar `_` por espaço em `joao_silva@x.com` estragaria justamente o dado que a equipe vai copiar.
- Campos de identidade (`full_name`, `phone_number`, `email`, `nome_completo`, `número_do_whatsapp`…) **não entram no bloco de respostas** — já estão no topo. O e-mail ganhou linha própria embaixo do telefone. Caps: 8 respostas, pergunta 60, resposta 140.
- **O rótulo virou `Criativo:`, não `Anúncio:`** — é a palavra que a equipe usa e a pergunta que o grupo faz ao ver o lead. `Conjunto:` é linha nova.
- ⚠️ **Lead de landing page continua sem criativo, e é limite de DADO**: o ValueTrack do Google entrega `utm_content` como ID numérico e não existe macro de nome; resolver isso é o mesmo trabalho que o `google-ad-resolver` já faz para campanha, ainda não estendido a anúncio. Mostrar `Criativo: 826380994688` seria pior que omitir.
- ✅ Verificado: **65 asserts** (payloads copiados LITERALMENTE de eventos reais de produção — se o formato mudar, o teste cai antes do grupo ver); tsc + `next build` limpos; **prévia sobre a base real renderizando 6 clientes** (Incorpast, IGA Barney, Sorrifácil São José, CondoStore, Romanza, SorriLeve) e **varredura das 508 respostas dos últimos 60 dias: 0 com underscore sobrando**.

## O aviso no grupo perdeu o link, e o remetente da ONMID virou lei (2026-09-29, mesma rodada)

Print do Matheus com o primeiro aviso chegando no grupo: uma **logo gigante do WhatsApp** ocupando 80% da tela e o lead espremido embaixo. *"vai vir sempre com essa imagem de link?"* — vinha, e a decisão dele foi direta: *"tira o link, e deixa só o número com 55(DDD)número, o whatsapp já reconhece para iniciar conversa."*

- **A mensagem não carrega NENHUMA url.** O WhatsApp pré-visualiza o primeiro link que encontra, e a miniatura do `wa.me` era maior que o conteúdo inteiro do aviso. ⚠️ **Não adiantava desligar a pré-visualização no provedor** (`linkPreview: false` existe na Evolution e na Z-API): seria plumbing novo em quatro assinaturas para resolver um problema que some tirando a url. O telefone em `+55 (43) 99999-8888` **já é tocável** — o próprio print prova, ele aparece sublinhado e clicável —, então o atalho não entregava nada que o número não entregue.
- Assert virou `!/https?:\/\//.test(mensagem)` em vez de procurar `wa.me`: qualquer url nova que alguém acrescente amanhã derruba o teste, não só aquela.

### Quem envia em nome da ONMID não é mais escolha

Na mesma rodada, vendo o seletor "Escolha a instância…" oferecer **PicoLocos Guanabara** ao lado de **Onmid Assistente**: *"deixa padrão e de forma oficial... Não deixa nem a possibilidade de poder escolher outro."*

- **`instanciaOnmid(pool)` + `sendTextOnmid(pool, destino, texto)` em `whatsapp-send.ts`** são a régua única: `system_settings['onmid_instancia_oficial']` se existir, senão pelo NOME (`ILIKE '%onmid%assistente%'`, ativa). ⚠️ Id configurado que não resolve mais **cai no nome em vez de virar silêncio** — instância apagada não pode deixar a agência muda.
- **⚠️ A regra é de SERVIDOR, não de tela.** Quem envia não recebe id de instância: pede a oficial. Aplicado em **seis** caminhos — aviso de lead no grupo, monitor de redes, rotina de termos do Google, alerta de crédito de IA, alerta de instância parada nos Disparos e a Luna (`getLunaSendInstance` parou de ler `luna_zapi_client_id`). No alerta de saldo o próprio `BALANCE_CONFIG_SELECT` deixou de dar JOIN em `bac.zapi_client_id` e passa a juntar a oficial por LATERAL.
- **E os seletores sumiram das telas**, porque menu que o servidor ignora é pior que menu nenhum: o card do cliente virou uma linha fixa ("Onmid Assistente · OFICIAL"), `alert-config` e `whatsapp-config` devolvem **uma opção só**, Pagamentos já entra com ela escolhida e a Luna mostra um selo. `PUT /api/agent/tasks` foi **selado com 409 explicando o motivo** em vez de apagado — apagar devolveria 404 e pareceria bug de rota.
- **Medido antes de mexer** (é o que dimensiona o risco): só existem **4 instâncias ativas**, e **3 são de CLIENTE** (PicoLocos ×2, SAAC). Os avisos já configurados — monitor social e Luna — **já apontavam para a Onmid Assistente**, então a mudança não desligou nada; ela fecha a porta para o erro que ainda não tinha acontecido: mandar recado da ONMID pelo WhatsApp de um cliente, que não tem desfazer.
- ⚠️ **Crase dentro de comentário SQL em template literal quebra o build** — reincidi nisso escrevendo o `LATERAL` do alerta de saldo, o MESMO bug do commit `e8fe88b`. O comentário do SQL agora avisa, na própria linha, que ali não entra crase.
- ✅ Verificado: **32 asserts**; tsc + `next build` limpos com a rota `/api/whatsapp/oficial` registrada; eslint comparado contra `origin/main` **na mesma config** (7 erros antes, 7 depois — nenhum novo); **browser** com o card real bundlado — **zero `<select>` na tela**, "Quem envia: Onmid Assistente · OFICIAL", a lista de grupos pedida com o id da oficial (`whatsapp-groups?zapiClientId=64cc7d27…`), o PATCH saindo como `{"ativo":true}` sem instância nenhuma, e o texto do aviso sem link.

## Lead de formulário avisa no grupo do cliente — fim do Make (2026-09-29)

Pedido do Matheus: *"quando criar um lead que chega via formulário de meta ads ou landingpage, enviar também no grupo do whatsapp, mas configurado a nível de cliente. Hoje faço isso com o Make, mas não quero mais pagar por isso."*

- **O gatilho é `lead_tracking_events.event_type='formulario'`, NÃO a coluna `canal`** — `canal` é texto livre por cliente e mudaria de grafia sem aviso. A FONTE sai do **prefixo do `external_id`**: `leadgen:` → Meta Forms, `lp:` → landing page (`fonteDoEvento`). O **webhook genérico fica de fora de propósito**: ele não carrega prefixo, então não dá para dizer de qual porta veio, e prometer "só formulário" mandando qualquer coisa seria pior que não avisar.
- **⚠️ Worker SEPARADO da ingestão** (`/api/lead-aviso/worker`, cron de 1 min) — é a lição do SULTS: uma queda do WhatsApp não pode derrubar a recepção de lead de nenhum cliente da carteira. Nenhuma rota de recepção foi tocada.
- **⚠️ `lead_aviso_config.desde` reseta em NOW() quando o aviso é LIGADO** (só na transição desligado→ligado): ligar num cliente antigo despejaria o histórico inteiro de formulários no grupo dele, e no WhatsApp não há desfazer. Mesma lição do `sults_connections.desde`.
- **⚠️ A linha é RESERVADA ANTES do envio**: `INSERT ... status='enviando' ON CONFLICT DO NOTHING` contra a UNIQUE `(client_id, evento_id)`, e só depois manda. Dois ticks cruzados (ou um retry) não conseguem mandar a mesma mensagem duas vezes — mesma defesa das publicações e de `sults_envios`.
- **⚠️ A mensagem NÃO leva link do nosso sistema.** O grupo é a equipe do CLIENTE, que não tem login aqui — um link para o CRM seria uma porta fechada na cara de quem recebe. Vai nome, telefone formatado (`+55 (14) 99635-8710`), fonte e um atalho **`wa.me`**, que é o que a pessoa realmente vai clicar.
- **Uma mensagem por lead, sem lote** — decisão medida, não estimada: os clientes com mais formulário fazem **SorriLeve 5,7/dia (pico 2 na mesma hora), Incorpast 4,6/dia (pico 3), IGA Barney 3,3/dia (pico 3)**. Agrupar economizaria nada e atrasaria o aviso, que é o produto. Teto de `TETO_POR_RODADA = 20` por tick contra surto.
- Envio pelo helper canônico `sendTextByInstanceId` (ramifica Evolution/Z-API por `provider`) — automação nova nunca chama `zapi.sendText` cru. O picker de grupo do card escolhe o endpoint pelo provider (`/api/otimizador/whatsapp-groups` para Evolution, `/api/disparos/extract/chats` para Z-API).
- **Tela**: card em Cliente → Integrações → **Fontes de Captura** (`lead-aviso-card.tsx`), com instância, grupo, quais fontes avisar, "Salvar e enviar teste" e as últimas recepções.
- **Cron na VPS**: `* * * * *` com `flock -n`, saída em `/tmp/onmid-lead-aviso.last`; backup em `/root/crontab-backup-antes-lead-aviso.txt`. ⚠️ Cron novo = SEMPRE conferir o `CRON_PREFIXES` do proxy (`/api/lead-aviso/worker` foi acrescentado) — senão o cron recebe `{"error":"Não autenticado."}` do PROXY, não da rota.
- ✅ Verificado: **31 asserts** (`scratchpad/test-lead-aviso.mjs`: prefixo da fonte, `parseFontes` com lixo caindo em "todas", telefone em todos os formatos do banco, reserva idempotente); tsc + `next build` limpos; **worker em produção** respondendo `{"ok":true,...}` com segredo e **401 sem**; cron rodou no primeiro minuto.
- ⚠️ **O PRIMEIRO ENVIO REAL ainda não aconteceu** — nenhum cliente configurado (`clientes:0` nas rodadas). O teste que fecha o caso é configurar instância + grupo num cliente com formulário ativo e esperar um lead de verdade.

## Janela de atribuição aceita lead que VOLTA + o alerta abre a lista (2026-09-28, mesma rodada)

Duas correções que o Matheus apontou olhando o que tinha acabado de subir.

### 1. Reentrada — buraco meu na janela

Pergunta dele: "e se for um lead que já passou pelo sistema algum período do ano e cai novamente depois de um tempo?". Estava certo: a janela só aceitava lead **NOVO**, então quem voltava ficava de fora — e as duas pontas ficavam **incoerentes**, porque pelo CÓDIGO esse retorno era atribuído normalmente (`matchClickByCode` não olha se o lead existe).

- **`DORMENCIA_REENTRADA_DIAS = 7`**: lead antigo volta a ser candidato se estava em silêncio. O corte veio da medição, não de palpite — 30 dias de mensagens RECEBIDAS: **conversa em andamento (<1d) 9.961** · primeira mensagem 1.852 · **voltou 1–7d 429** · **voltou 7+d 18**. Aceitar 7+ dias custa **1% a mais de candidatos** (18 sobre 1.852) e resolve o caso real; aceitar conversa em andamento poria ~10 mil mensagens/mês disputando clique — **é dela que a guarda protege**. Dos candidatos, **85,4% ficam sem concorrente** na janela de 2 min.
- **⚠️ A régua olha a última mensagem em QUALQUER direção**, não só as recebidas: se o atendente falou há 3 dias e a pessoa responde hoje, isso é resposta a follow-up, não reentrada por anúncio.
- **⚠️ A leitura acontece ANTES do upsert** — depois dele `whatsapp_last_message_at` já carrega o carimbo desta mensagem e TODO lead pareceria ativo.
- **⚠️ RESÍDUO DOCUMENTADO na trava 2**: ela conta lead **CRIADO** na janela, não lead que **voltou** da dormência (depois do upsert ele fica indistinguível de quem está no meio de uma conversa). Cobrir isso exigiria uma régua que não consigo tornar sólida. Tamanho medido: 0,6 reentrada/dia, então duas no MESMO cliente dentro de 2 minutos é ruído estatístico — e a combinação perigosa de verdade (retornante + lead novo juntos) **segue coberta**, porque o lead novo é contado.

### 2. O alerta "N leads de anúncio não estão no CRM" virou clicável

Pedido do Matheus (print): "tinha que ser possível clicar em algum 'Saiba mais' para vermos quais são esses leads, e questionar o cliente o que houve". **Alerta sem a lista é acusação sem prova** — para cobrar o cliente é preciso nome, telefone, data e a campanha de cada um.

- Botão **"Ver os N leads"** abre o **MESMO** `FunilLeadsModal` pela **MESMA** rota (`/api/crm/funil-leads`), agora com **`recorte=fora_do_crm`**, que aplica o **MESMO predicado** (`rastreadoForaDoCrmSql`) que o alerta conta. ⚠️ Lista com consulta própria divergiria do número na primeira mudança de régua — foi por isso que não criei rota nova.
- ⚠️ Nesse recorte **a etapa não filtra** (o conjunto já É o recorte, e a etapa segue sendo calculada só para exibir) e o par **"Chegaram aqui / Parados aqui" SOME** — é conversa de degrau, e aqui não há degrau.
- **⚠️ Bug pego pelo teste em produção**: a rota validava `etapa` **ANTES** de olhar o recorte e devolvia `400 etapa inválida` para a chamada legítima do alerta (commit `269729b`). Sem o teste com sessão real, o botão iria para produção morto.
- A linha da lista traz nome/telefone/canal/data/etapa; **campanha, conjunto e anúncio aparecem ao clicar no lead** (o detalhe já existia, `GET /api/crm/[id]`).
- ✅ Verificado em produção (`269729b7`, sessão forjada): `recorte=fora_do_crm` na Sorrifácil Londrina Bandeirantes devolve **16 leads — exatamente os 16 do alerta do print** (Madalena, Yasmim, Sandra… com telefone e canal Meta Ads/WhatsApp).
- ⚠️ **Não visto renderizado**: a dashboard não monta em bundle isolado e o dev não tem banco. O botão é markup simples com dados provados pela rota, mas o primeiro clique real é do Matheus.

⚠️ Receita de teste que vale registrar: a sessão forjada falha com **401 silencioso se o `uid` não existir na tabela `users`** — o primeiro script usou um filtro de status que devolveu vazio e o 401 parecia erro de assinatura. Conferir o uid ANTES de culpar o HMAC.

## Rastreio do `/r/` — código invisível, mensagem na URL e atribuição por janela (2026-09-28)

Pedido do Matheus: tirar o atrito do rastreio ("o código precisa ser invisível") e, se o lead apagar a mensagem pré-preenchida, "calibrar por meio da janela de tempo".

- **⚠️⚠️ MEDIDO ANTES, e mudou a ordem do trabalho**: nos últimos 30 dias o `/r/` teve **21 cliques e ZERO casaram**, e `click_code` está preenchido em **0 dos 44.812 leads** da base inteira. Dos 21, oito vinham com `utm_source=teste_onmid` e um com `gclid=GCLIDREAL42` — varredura de teste. Enquanto isso os mesmos clientes recebem lead normalmente (Cambé 260/30d, Itapema 163). **O tráfego real não passa pelo redirecionador** — o problema nunca foi o código sumir da mensagem. Por isso a troca do formato visível pôde ser feita **sem período de transição**: não existe link no mundo carregando código antigo (o código nasce a cada clique, não no link).
- **1. CÓDIGO INVISÍVEL** (`encodeClickCodeInvisible`/`decodeClickCodeInvisible` em `lead-tracking.ts`): os 6 símbolos viram **30 bits** em caracteres de largura zero colados no fim da mensagem. **⚠️ ZWSP (U+200B)=0 e ZWNJ (U+200C)=1, só esses dois** — o **ZWJ (U+200D) ficou de fora de propósito**: é o que une sequências de emoji, e um código que caísse dentro de um emoji seria remontado pelo cliente de WhatsApp e voltaria corrompido. **⚠️ O decodificador lê do FIM** (última sequência, últimos 30 bits): o código é colado no fim, então caractere de largura zero grudado antes não desloca o recorte em um bit. **A leitura do `"Cód: XXXXXX"` continua** — custa nada e cobre quem clicou antes do deploy e só mandou a mensagem depois.
- **2. MENSAGEM NA URL**: `/r/slug?text=...` **vence** a mensagem cadastrada no link. Um link só passa a servir portfólio, peça e produto sem cadastrar um link por mensagem. ⚠️ O `text` **não** entrou em `KNOWN_PARAMS` de propósito: continua indo para `extra_params`, como registro de qual texto aquele clique carregava. Exposto no construtor de link personalizado da aba (campo "Mensagem (opcional)") — capacidade que ninguém descobre é capacidade que não existe.
- **3. JANELA DE TEMPO** (`matchClickByWindow`): sem código, casa clique↔lead por proximidade. **⚠️⚠️ É INFERÊNCIA, e atribuir errado é PIOR que não atribuir** — Biblioteca de Criativos, funil por canal e decisão de verba saem todos daqui, e um palpite silencioso contamina os três sem deixar rastro. Por isso **recusa ambiguidade em vez de escolher a mais provável**, com três travas:
  1. **exatamente UM** clique sem dono na janela (dois = dois candidatos, impossível saber qual é este lead);
  2. **nenhum OUTRO lead** do cliente nascido na janela (o clique pode ser do outro);
  3. **⚠️ a mensagem não pode trazer sinal melhor.** Sem esta, um lead de **CTWA** (que nunca tem código) receberia o clique de outra pessoa que passou pelo `/r/` no mesmo minuto — trocando atribuição certa (Meta) por inventada. Foi o furo mais perigoso da rodada, achado relendo o próprio código.
  - **"Conversa nova" usa a MESMA régua do upsert** (`resolverLeadExistente`): duas réguas de identidade divergentes fariam a janela disparar em lead antigo que a régua boa reconheceria.
  - **Evento gravado como `link_click_janela`**, tipo próprio — auditar depois "quais leads foram atribuídos por inferência" tem de ser uma consulta, não arqueologia.
- **Janela padrão de 2 min** (`JANELA_ATRIBUICAO_MIN`), com risco de colisão medido por cliente em 28/09: **1,2%** em Cambé (9 leads/dia), **4,6%** na Londrigifts (34/dia), **8,4%** no CondoStore (63/dia). Acima disso a janela vira loteria — por isso o teto de 60 min no parâmetro é só defesa contra chamada errada, não sugestão.
- ✅ Verificado: **814 asserts** do código invisível (`scratchpad/test-codigo-invisivel.mjs`: ida e volta com o alfabeto inteiro, emoji antes, largura zero solta E grudada, legado visível em maiúscula/minúscula, nada inventado de texto limpo) + **13 da janela** (`test-janela-atribuicao.mjs`: as duas travas, curto-circuito que nem consulta concorrente quando já há ambiguidade, limites/piso/teto, data inválida); tsc + `next build` limpos; **em produção** (`c4c2a838`) dois cliques reais — o lead vê só `"Olá, vim pelo google…"` e `"Quero saber o preço do item 12 do portfólio"`, cada um com 30 invisíveis decodificando para códigos distintos (`9695PN`, `PVV26C`), zero `"Cód:"`, os dois gravados e sem dono no banco.
- ⚠️ **A janela nunca disparou de verdade** — não há tráfego no `/r/` para exercitá-la. A prova real é: pôr o `/r/` no caminho de uma LP com volume, apagar a mensagem de propósito e conferir se o lead sai com `link_click_janela` no histórico.
- ⚠️ Os 2 cliques de teste (`utm_source=teste_invisivel`, 28/09 13:06) ficam no banco como qualquer outro; somam aos 21 anteriores se alguém medir volume do redirecionador.

## Landing page sem sessão vira caixa MINIMIZADA (caso Tapeçaria Chic) (2026-09-28)

Print do Matheus: seção Landing page da Tapeçaria Chic inteira em zeros (KPIs, mini-cards, "sem eventos configurados") — "lembra da regra de quando não houver dados é para ficar com a box minimizada?".

- **Medido**: a Tapeçaria TEM propriedade GA4 vinculada (`ga4:514338956` em `client_account_links`) e a rota devolve o consolidado normalmente, só que com **0 sessões e 0 dias** no mês — tag fora do ar, LP sem o GA4 ou propriedade errada. Como `secaoVisivel.lp` só olha se existe `ga4`, a seção aparecia com o painel inteiro zerado.
- **Correção** (`blocoGa4` no `page.tsx`): propriedade com `atual.sessoes === 0` renderiza `<Superficie vazio>` com "Nenhuma sessão registrada na landing page no período." — a MESMA caixa minimizada dos cards Google Ads sem veiculação. O título "Landing page" com o período continua (igual a "Mídia paga" com os cards do Google minimizados). ⚠️ Nunca durante o carregamento (`!ga4Loading`), senão a caixa pisca antes dos dados chegarem.
- ⚠️ A regra vale por CLIENTE: com vários selecionados, cada um com sessão zero vira sua própria caixa minimizada; os demais seguem com o painel completo.
- ⚠️ Vale conferir por que a propriedade da Tapeçaria não recebe sessão — é dado real faltando, não só apresentação.

## Landing page — 5º mock: Cidades com MAPA do Brasil, canal em rosca, páginas e blocos de evento em barras (2026-09-24, noite)

Quinto mock do Matheus ("várias tabelas com barras… só as últimas 2 mudam por cliente… e gostaria de simular o mapa do país nas cidades"). **Substitui o 2º mock** (os `CardRanking` de Cidades/Qualidade por canal/Página de entrada foram apagados — o Matheus mandou o layout novo poucas horas depois).

- **Mapa do Brasil** (`src/lib/estados-br.ts` + `MapaBrasil`): 27 estados em SVG, geometria da **SimpleMaps** (livre para uso comercial, https://simplemaps.com/resources/svg-license — atribuição registrada no cabeçalho do arquivo), simplificada por Douglas-Peucker (`scratchpad/simplify-br.mjs`, 260 KB → 21 KB). Estado ganha verde proporcional às sessões; sem dado fica apagado. ⚠️ **O GA4 precisou passar a devolver o estado**: `cidades` virou dims `['city', 'region']` (o `region` vem em inglês, "State of Parana"/"Federal District" → `ufDaRegiao` mapeia os 27). Payload antigo/cacheado não tem `sub` → o card explica que o mapa aparece na próxima atualização.
- **Cards compactos** (`CabecalhoMini` com título em caixa alta + sub + link "Ver todas →"; `LinhaCompacta` = posição/tile, rótulo, barra, número + %): `CardCidades` (mapa + ranking, % = participação nas sessões do PERÍODO, não da lista), `CardCanalRosca` (rosca top 4 + Outros com sessões e %), `CardPaginasEntrada` (tile de iniciais no lugar do screenshot — não existe captura de página no sistema).
- **⚠️ Container queries, não breakpoints de tela**: mapa ao lado da lista só quando o CARD tem ≥ 30rem (`@container` + `@[30rem]:`), rosca ao lado da legenda com ≥ 26rem. Em 3 colunas a largura do card depende da tela; breakpoint de viewport erraria dos dois lados.
- **`BlocoEventos`** substitui `BlocoContagem` para "Onde clicam para falar", os `detalhes` por cliente (peça/veículo/material/espessura/palestra/cta_id — título e existência variam, o desenho não), Seções vistas e Vídeos: **barras verticais** (`BarrasVerticais`, top 6, valor em cima e rótulo embaixo — contagem em "Onde clicam", % nos demais) quando os 6 primeiros rótulos têm ≤ 22 caracteres; senão **ranking com tile** (peças). O `FunilForm` entrou na mesma grade.
- Ordem dentro de Audiência (atualizada a pedido do Matheus, mesma noite): donuts (Dispositivo/Novos) → **mapa dia/hora → "Até onde rolam"** → linha Cidades/Canal/Páginas → grade de blocos de evento → Idade/Gênero. O grupo Comportamento ficou só com o fallback origem/mídia (`temComportamento = temOrigem`); `temAudiencia` passou a incluir `temExtras || temRolagem`, senão cliente só com eventos/rolagem perderia a seção inteira.
- ✅ Verificado: tsc + eslint limpos; 25 asserts do GA4; harness com o **payload REAL da Cinfel** (baixado da produção, com o estado das cidades preenchido à mão porque a produção ainda não pedia `region`): mapa com SP/PR/MG/DF/RS, rosca 464/396/290/134/145, páginas com tile, "Onde clicam" e Materiais em barras, Peças em ranking com tile, "Top 6 de 7" no sub. ⚠️ Mapa com dado real do GA4 só depois deste deploy.

## Landing page — "Campanhas na página" e "Campanhas: custo por contato" no 4º mock (2026-09-24, noite)

Quarto mock do Matheus ("Quero essa parte da Lp… Seguir a risca"). Só `ga4-landing-panel.tsx`.

- **`BarraGrupo`**: a faixa de grupo virou um card fino com caixa de ícone, título VERDE em caixa alta, divisor vertical e o sub ao lado ("CAMPANHAS NA PÁGINA | o que o GA4 viu…"). Só esse grupo usa; "Comportamento" segue com `GrupoTitulo`.
- **`Campanhas` refeita como GRADE de linhas em caixa** (não `<table>`): caixa de ícone de 72px (`CircleDollarSign`) com contorno verde, título 24px em caixa alta; cabeçalho com ícone por coluna (`#`, Campanha, Custo, Cliques, Sessões, Connect, Contatos, Custo/contato); cada campanha numa linha `rounded-xl` com a posição em quadrado, nome + barra de custo, connect em **pílula** (verde/âmbar/vermelho pelo `statusConnect`) e custo/contato em pílula de contorno verde ou "SEM CONTATO" em vermelho.
- **Melhor desempenho = menor custo por contato** (entre campanhas com custo E contato) marcado **só com uma estrelinha** no canto da pílula de custo/contato, em posição absoluta. ⚠️ A 1ª versão tinha borda verde na linha, número preenchido e selo "MELHOR DESEMPENHO" com troféu numa 9ª coluna — o Matheus pediu para tirar: a coluna extra desalinhava os dados da linha vencedora em relação às outras. Regra: destaque de linha em tabela NÃO pode mexer em coluna nem espaçamento. Colunas: `56px | minmax(220px,1fr) | 6 × minmax(104px,auto)`, `min-w-[960px]` com rolagem horizontal.
- "Outras campanhas (UTM)" continuam abaixo, esmaecidas, com ponto no lugar da posição.
- ✅ Verificado: tsc + eslint limpos; harness com a Sorrifácil ingleses (1600px): MULTIPLAS ESPECIALIDADES vence com R$ 23,72 e recebe o troféu, pílulas de connect 88/82/90%, UTM esmaecidas. ⚠️ Não visto com a Cinfel (o mock) nem em produção logado.

## Landing page — Cidades · Qualidade por canal · Página de entrada numa linha + mapa dia/hora (2026-09-24, noite, 3º pedido)

Terceiro mock do Matheus ("em uma linha só com Cidades, Qualidade por canal e Página de entrada… aí pode jogar embaixo o dia"). Commit `5eb5233` na `main`, só em `ga4-landing-panel.tsx`.

- **`CardRanking` + `linhasRanking`**: card do mock com caixa de ícone com contorno verde (56px, 48px abaixo de `2xl`), título grande em caixa normal (NÃO o `T.cardTitulo` uppercase — o mock é "Cidades", não "CIDADES"), sub, botão **"Ver todas"** (abre a lista inteira no próprio card, vira "Ver menos"; some com ≤5 itens), divisor, linhas com **círculo** da posição (não caixa — é o que diferencia do `ListaRanking` das palavras), nome + sessões, barra e indicadores com ícone. `modo="cidade"` põe a taxa **com seta ao lado da barra** (↑ verde se >0, → cinza se 0); `modo="canal"` põe engajamento na linha de indicadores, em verde.
- **Reordenação estrutural**: Cidades saiu da linha dos donuts; a linha Dispositivo / Novos × recorrentes voltou a 2 colunas; **Qualidade por canal e Página de entrada saíram do bloco Comportamento** para a linha de 3 (`xl:grid-cols-3`, `items-stretch`) dentro de Audiência, e o mapa de dia/hora vem logo abaixo. Comportamento ficou com o fallback "De onde vêm as conversões/sessões" (só quando o GA4 não devolve canal), rolagem e eventos extras — `temOrigem` agora é `canais.length === 0 && origens.length > 0`, e `temAudiencia` inclui canais/páginas para a linha aparecer mesmo sem dado de audiência.
- **Mapa "Dia da semana e hora"** no 3º mock: `CabecalhoIcone` com calendário, toggle Conversões/Visitas em **pílula** (`rounded-full`, ativo verde com brilho), **todas as 24 horas** no eixo (antes só de 3 em 3), células `h-5 rounded-[5px]` com `gap-1`, `min-w-[760px]` com rolagem horizontal.
- ✅ Verificado: tsc limpo; eslint 0 no arquivo; harness (`?json=ingleses.json`, 1440px): 3 cards alinhados, "Ver todas" abrindo 12 cidades, mapa com 24 rótulos. ⚠️ A 1440px os títulos ainda quebram em 2 linhas ("Qualidade por canal") — o mock é a 1916px; acima de `2xl` fica como no mock.

## Landing page — palavras, termos e audiência no 2º mock (2026-09-24, noite)

Segundo mock do Matheus ("Quero essa parte da Lp… Seguir a risca"), commit `2d5ba0f` na `main`. Tudo em `ga4-landing-panel.tsx`; nenhuma rota/lib mudou.

- **Componentes novos do mock**: `CabecalhoIcone` (caixa de ícone 44px + título/sub + slot à direita; `CaixaIcone` ganhou `cor`/`redondo`/`tam`), `SeloContagem` (número grande colorido + texto em 2 linhas), `ListaRanking` (posição em caixa, rótulo + sub, `BarraFina`, número + unidade, chevron; `barraEmbaixo` para Cidades) e a legenda do `Empilhada` com o **% grande à direita**.
- **⚠️ O chevron das linhas TEM destino**: clicar abre o detalhe da palavra (sessões, engajamento, tempo médio, WhatsApp/formulário/telefone). Chevron decorativo que não abre nada seria mentira de UI — se remover o `detalhe`, o chevron esmaece e a linha deixa de ser botão.
- **⚠️ Selo do card vermelho = SOMA das sessões sem contato** (o mock mostra "35", que é só a 1ª linha; somar é o número honesto para "sessões sem contato").
- **"Ver mais (N)" ficou** nas listas (o mock só mostra 5 e não tem o botão): esconder as outras 17 palavras sem porta nenhuma perderia dado — mesma decisão de "Ver mais" de 5 itens do resto da dashboard.
- **Audiência**: cabeçalho com ícone + sub ("Entenda quem visita seu site…"), Dispositivo / Novos × recorrentes / Cidades na MESMA linha (`xl:grid-cols-3`); Idade/Gênero (que o mock não tem) seguem numa 2ª linha só quando o GA4 devolve.
- **Lições de largura**: em 2 colunas a 1440px o cabeçalho precisa de `md:flex-nowrap` (senão o selo cai pra 2ª linha) e a barra inline ficou em 24% + número `min-w-[84px]` para o rótulo da palavra não truncar; o sub da linha NÃO trunca (quebra em 2), porque "engajamento X · tempo médio Y" cortado não informa nada.
- ✅ Verificado: tsc limpo; eslint 0 = 0 no arquivo; harness com o payload real da Sorrifácil ingleses (`?json=ingleses.json`) — selos 22/136, ranking com barra, detalhe abrindo, "Ver termos", 3 cards de audiência com % grande. ⚠️ Não visto com o cliente do mock (Cinfel) nem em produção com login.

## Dashboard — seção Landing page refeita "à risca" no layout do mock (2026-09-24, fim da tarde)

Pedido do Matheus com o mock em anexo: "Quero essa parte da Lp, seja com esse layout que estou enviando em anexo. Seguir a risca". Commit `cf87d69` na `main`.

- **Estrutura nova de `ga4-landing-panel.tsx`** (a parte de cima; Campanhas na página / Audiência / Comportamento ficaram como estavam): título + subtítulo com **caixa de período à direita** (`TituloSecao` ganhou `direita`; `dataLonga(iso)` no `page.tsx`, mostra "Comparado com …" da `faixaPrev`); **4 KPIs** (`KpiLp`: caixa de ícone à esquerda do rótulo, número em Bebas 40px, seta + variação "vs. período anterior", sparkline nos quatro); **7 mini-cards** (`MiniLp`: Usuários, Novos usuários, Páginas vistas, Tempo médio, WhatsApp, Formulário, Telefone); **funil em SETAS** (`FunilSetas`, chevrons via `clip-path: polygon(...)`, opacidades decrescentes, % embaixo de cada etapa, botão "Ver detalhes" que abre connect rate + explicações — substituiu o `FunilClique`); **Evolução diária com seletor Diário/Semanal** (`Granularidade` + `porSemana()` em `ga4-landing-graficos.tsx`, semanas começando na segunda); **tabela "Desempenho por campanha / página"** (`DesempenhoPaginas`: busca, colunas ordenáveis, status Ativa/Sem tráfego).
- **⚠️ Sem screenshot da página**: o mock traz miniatura da LP por linha; não há captura de tela no sistema, então a linha leva um **selo com iniciais** do caminho. Não inventar thumbnail.
- **⚠️ Período anterior por página só existe em cliente MULTI-propriedade**: `Ga4Consolidado.propriedades[].anterior` (novo) alimenta a variação por linha; em cliente de uma propriedade a tabela usa `paginasEntrada` e a variação sai como "—". Guardas `p.anterior?.sessoes ?? null` são obrigatórias — payload antigo/cacheado não tem o campo.
- **`Ga4Dia.engajadas`** (novo, 3ª métrica do request diário `engagedSessions`) alimenta a sparkline da taxa de engajamento; `consolidar` soma com `?? 0` (linha diária sem o campo não pode virar `NaN` — pegou no teste).
- **Lições de layout**: os 7 mini-cards a 1440px só cabem com a variação **embaixo** do valor (lado a lado estourava a borda); os rótulos das setas ("Cliques no anúncio", "Sessões na página") precisam **quebrar em 2 linhas** (`leading-tight`, sem `truncate`) — truncar cortava em "Cliques no a…".
- ✅ Verificado: 25 asserts da lib (`scratchpad/test-ga4-landing.mjs`); tsc limpo; eslint 164 = 164 (baseline por stash); harness no browser com o payload REAL da Sorrifácil ingleses (`scratchpad/build-ga4/index.html?json=ingleses.json`, servido por `public/__ga4_test/` no dev server — removido depois): KPIs com sparkline, 7 mini-cards sem overflow, setas com rótulo inteiro, Semanal reagrupando a série, busca "onbio" filtrando a tabela para 1 linha. ⚠️ O harness só monta com o dev server do repo PRINCIPAL (`launch.json` roda em `/Users/matheuscampos/Documents/reports`) — copiar o bundle para o `public/` de LÁ, não do worktree.

## Mapa de Calor — criação automática pela rotina de rastreio das LPs (2026-09-21)

Pedido do Matheus: o Mapa de Calor (Integrações → Mapa de Calor, `tag.js` do Radar
de LP) passa a fazer parte do rastreio PADRÃO de toda LP, e a página é criada
automaticamente — ninguém clica em "Nova página".

- **`GET/POST /api/integrations/mapa-calor`** (nova; `x-onmid-secret` =
  MAKE_INTEGRATION_SECRET, em `INTEGRATION_PREFIXES`): GET `?cliente=` lista as
  páginas do cliente com `tracking_key` e snippet; POST `{cliente, url, nome?}`
  cria — **idempotente pelo host** (www. ignorado): o `tag.js` já grava o path de
  cada visita, então uma página por domínio cobre todas as rotas. Mesma tabela
  `client_landing_pages` e o mesmo `generateLpTrackingKey()` da tela.
- Consumidor: `~/Documents/lps/bin/gtag calor <cliente> <url>`; a tag entra pelo
  GTM de cada LP (Custom HTML em All Pages carregando o `tag.js?k=`). ⚠️ O
  `tag.js` se localiza por `document.currentScript` — funciona injetado pelo GTM
  (script externo criado dinamicamente tem currentScript durante a execução).
- ✅ Verificado: tsc. ⚠️ Só produção exercita o banco — validar com
  `gtag calor condostore https://www.condostore.com.br` (deve devolver a página
  criada à mão, `criada:false`, chave `4uazur859x`).
## Ferramentas → Biblioteca Meta: baixar criativos da Biblioteca de Anúncios (2026-08-07)

Pedido do Matheus: baixar vídeos/imagens da Biblioteca de Anúncios do Meta colando o link, sem o ritual de inspecionar página → achar o vídeo → abrir individual → botão direito (não escala pros gestores). Mora em `/ferramentas/biblioteca-meta`, dentro do **grupo "Ferramentas" da sidebar** (2ª rodada no mesmo dia, pedido dele: agrupar Automações, Cofre, Otimizador, Disparos e Biblioteca Meta sob "Ferramentas").

- **Grupo Ferramentas na sidebar**: `NavItem` ganhou `group?: 'ferramentas'` (nav-items.ts continua a fonte única; o grid de acesso rápido do Início segue FLAT — o grupo é só apresentação da sidebar). Sidebar renderiza os itens sem grupo na ordem e depois o botão colapsável "Ferramentas" (Wrench + chevron, estado em `localStorage['sidebar-tools-open']`; **grupo com item ativo nunca colapsa** — senão a tela atual some do menu). Menu recolhido (ícones): sem cabeçalho, só divisor + ícones flat. Mobile: nenhum item do grupo tem flag `mobile` → grupo some sozinho no drawer.
- **Permissão de cada item continua a própria** (automacoes/cofre/otimizador/disparos); Biblioteca Meta usa a flag `radar`. `auth-guard` ganhou `/ferramentas` em routeRoles (Admin+Usuário) e routeFeature (`radar`) — **ferramenta nova sob `/ferramentas` = decidir a flag lá**. A rota saiu das abas do Radar (`results-tabs.tsx` voltou a 3 abas; o `overflow-x-auto` da barra ficou, é melhoria).
- ⚠️ Mover página de rota no dev: o `.next/types/validator.ts` stale aponta pro caminho antigo e o tsc falha — `next build` regenera.

- **Como funciona (validado ao vivo em 2026-08-07)**: a página pública da Ads Library responde **403 com desafio JS** (`/__rd_verify_...`) na 1ª visita sem cookie — o servidor reproduz o fluxo do browser (POST no desafio → cookie `rd_challenge` → repete o GET; cookie cacheado em módulo 30min). O HTML que volta traz os anúncios da 1ª página **embutidos como JSON** (`{"ad_archive_id":...,"snapshot":{...}}`) com `video_hd_url`/`video_sd_url`/`original_image_url` diretos do fbcdn — sem headless browser, sem token de API. ~1s com desafio, ~0,7s com cookie.
- **`src/lib/ads-library.ts`**: `parseAdsLibraryUrl` (aceita link de página `view_all_page_id`, anúncio único `id` ou busca `q`; whitelist de params; injeta defaults `country=BR/active_status=active` só na busca por página), `fetchAdsLibraryHtml` (desafio+cookie), `extractAdsFromHtml` (scanner de JSON balanceado em cada `{"ad_archive_id"`, respeita chaves dentro de strings; dedupe por id ficando com a versão com mais mídia; cobre videos/images/cards de carrossel/extra_*), `isAllowedMediaUrl` (allowlist fbcdn/cdninstagram/facebook, https only — o proxy de download NÃO é proxy aberto), `safeFilename`.
- **Rotas**: `POST /api/ads-library {url}` (maxDuration 60; link com `?id=` põe esse anúncio primeiro — a página deeplink embute também os outros da mesma página) e `GET /api/ads-library/download?u=&name=` (maxDuration 120, **stream** do fbcdn com `Content-Disposition: attachment` — o atributo `download` do `<a>` é ignorado cross-origin, por isso o proxy existe). Auth = deny-by-default do proxy, nada a configurar.
- **UI**: cola o link → grade de cards (player de vídeo com poster/imagem, badge Ativo/Inativo, formato, data de início, link pro anúncio na Biblioteca) + filtros Todos/Vídeos/Imagens + **"Baixar todos"** (dispara `<a>` sequencial com pausa de 700ms) + botão SD quando existe. Nome de arquivo: `{pagina}-{ad_archive_id}[-n].mp4/jpg`.
- **Limite conhecido**: só os anúncios renderizados server-side (~30 primeiros na ordenação do link). Paginar além exige a chamada GraphQL da página (fora do escopo).
- **Retry de casca vazia**: visto ao vivo — logo após verificar o desafio, o Facebook às vezes responde 200 com a casca da página SEM os anúncios embutidos; `fetchAdsLibraryHtml` detecta HTML sem `"ad_archive_id"`, zera o cookie e tenta 1x de novo.
- ⚠️ Botão com `buttonVariants` tem `whitespace-nowrap` — rótulo longo + `flex-1` empurra o vizinho pra fora do card `overflow-hidden`; rótulo curto ("Baixar HD") + `min-w-0`.
- ✅ Verificado: tsc + `next build` limpos; **37 asserts** (parse de URL, scanner balanceado, 30 anúncios do HTML real, dedupe, carrossel, allowlist, filenames); **ponta a ponta real no browser** com a rota REAL do dev server (cookie de sessão FORJADO com o `SESSION_SECRET` do `.env.local` — receita nova: HMAC igual ao `session.ts`, o proxy valida sem banco; auth-guard mockado só nas 3 rotas de auth com passthrough do resto): link real do Matheus → 30 anúncios/30 vídeos/14 imagens, download via proxy 200 `video/mp4` com filename certo, anúncio do `?id=` em 1º, filtro Imagens → 14 cards, mobile 375px sem overflow, zero erros de console.
- ⚠️ Só produção valida: o fluxo do desafio saindo de **IP de datacenter da Vercel** (daqui saiu de IP residencial). Se o Facebook bloquear lá, o plano B é rotear o fetch pelo proxy Webshare (mesmo do WhatsApp) via `undici` ProxyAgent.

## Rastreio → Conversões: grade de botões + guia passo a passo (2026-07-29)

Reclamação do Matheus: a sub-aba Conversões (Clientes → Rastreio) empilhava os **4 formulários completos de uma vez** — parede de campos sem contexto de onde achar cada valor. Pedido: "só os botões, como se fosse categoria", e clicar abre o guia passo a passo "igual quando vai criar um novo cliente".

- **`src/app/(dashboard)/clientes/[id]/conversao-guias.tsx` (novo)**: `GuideStepModal` (chrome reutilizável — header, stepper clicável com ✓ verde no passo concluído, caixa "Como conseguir", rodapé Voltar / "Etapa X de N" / Avançar·Pular·Salvar, `footerExtra` que só aparece no último passo, fecha no Esc/backdrop, **reabrir sempre reseta pro passo 1**) + `ConversaoTile` (botão-categoria com selo de estado `on|partial|off`).
- **`tracking-tab.tsx`**: o bloco `activeTab === 'conversoes'` virou grade de 4 tiles + 4 modais. Passos: Rastreio por Pixel (3: Pixel ID → Token → Gatilho+eventos), Meta CAPI (4: Ativar+Pixel → Token → Page ID → Teste, com "Testar conexão" no rodapé do último), Google (3: Ativar+Customer ID → 3 ações de conversão → fallback GA4, idem) e **Eventos por Status (passo único de propósito** — é gestão de lista, cada linha grava na hora pelos próprios endpoints, não formulário linear; stepper se auto-esconde com `steps.length === 1`).
- **Zero backend**: mesmos `saveConfig`/`saveConvConfig`/`testConversion` e mesmas rotas. Salvar fecha o modal (`await save(); setGuia(null)`). Estado novo só `guia: 'pixel'|'capi'|'google'|'eventos'|null`; `showToken` foi removido (o card 1 agora usa o `SecretInput` compartilhado) e `ExternalLink` saiu dos imports (o link "Ver guia" para `/ajuda/conversoes` foi substituído pelo guia embutido).
- **Ganho de conteúdo, não só de layout**: os guias reaproveitam os textos que já existiam **escondidos nos tooltips de "?"** (`HelpBtn`) — inclusive os avisos ⚠️, que agora aparecem em destaque âmbar em vez de exigirem hover. O mais importante: Page ID ausente faz a Meta responder 200 OK e **não atribuir** na campanha (falha silenciosa).
- ✅ Verificado: tsc + `next build` limpos; componente renderizado isolado (bundle esbuild + fetch mockado) — 4 tiles com selos certos (Configurado/Ativo/Não configurado/1 evento) e **nenhum campo visível antes de abrir**, wizard do CAPI 1→4 com checks verdes e aviso do Page ID em âmbar, "Testar conexão" chamando `/conversions/test` e exibindo o retorno dentro do modal, **Salvar** fazendo POST com `meta_page_id` correto e voltando pra grade, modal de Eventos com tabela + adicionar. Screenshots conferidos.
- ⚠️ Lição de preview desta rodada: o Browser pane passou a **bloquear por política** o servidor estático da scratchpad (`:8787`) que rodadas anteriores usavam; a saída foi servir o HTML de teste pelo próprio dev server (`public/__conv_test/`, removido depois) — porta 3000 é permitida.
- **2ª rodada (mesmo dia, pós-uso real com o Cost Odonto)** — guias "anti-burro" + correções descobertas na prática:
  - **Etapa do funil vira `<select>`** no guia de Eventos por Status: carrega as etapas REAIS do CRM (`/api/crm/funnels?clientId=` → `/api/crm/funnels/{id}/stages`, dedupe por label, lazy no 1º open do guia; sem etapas → cai no input livre). Digitar o nome na mão era a maior fonte de evento morto ("proposta" ≠ "Proposta"). Evento Meta ganhou `datalist` com LeadSubmitted/Purchase.
  - **`testConversion` fala a verdade**: pré-checagem client-side de `meta_ativo`/`google_ativo` (desativado → mensagem explicando, sem chamar a rota — o envio real tem gate silencioso por ativo e saía "Erro"/"Enviado" seco); erro estruturado do servidor (`data.error`) agora aparece; 200 sem registro → "salve primeiro (o teste usa a config GRAVADA)".
  - **Guias reescritos como receita**: Pixel (mesmo Pixel ID/Token do CAPI, "Identificação do conjunto de dados"; gatilho = atendente digita "compra aprovada 297" na conversa), CAPI passo Teste (fluxo real: copiar código em Testar eventos → canal Mensagem → WhatsApp → colar → SALVAR → reabrir → testar → APAGAR; ⚠️ código esquecido = toda conversão real vira teste, Meta 200 OK e campanha zerada), Google (criar ação de conversão via Importar → CRMs/cliques quando não existe; NÃO é o rótulo do gtag).
  - **Descoberta de produção (Cost Odonto)**: a Meta agora **exige `ctwa_clid`** em evento de business_messaging — teste sintético falha com `error_subcode 2804071 "ctwa_clid ausente"`, e isso é SUCESSO de credencial (token+pixel+conexão ok). Lead real de anúncio traz o ctwa_clid e passa; lead orgânico será recusado com esse erro no Log (esperado, nada a atribuir). O comentário antigo em conversions.ts dizendo que "não há ferramenta de teste pra esse dataset" está desatualizado: Testar eventos → Mensagem → WhatsApp existe e o teste do Cost Odonto apareceu lá.

## Biblioteca de Criativos — ranking de anúncios por resultado real do CRM (2026-07-25)

Pedido do Matheus: visão compilada de "top ativos" (mais vendas/receita/leads, maior CPL, mais agendamento/negociação) em 3 lugares. Alimentada pela atribuição CTWA do CRM (destravada pelo conserto do webhook).

- **`src/lib/creative-library.ts`** — `aggregateCreatives(pool, {days, clientId?})`: agrega `crm_leads` por criativo (chave = `source_id` do anúncio; fallback nome), com leads/vendas (fechou)/receita (SUM valor_rs)/ig_leads vs fb_leads (origin instagram|meta)/breakdown `por_status` (query separada, merge em JS)/join `clients` (name, segment). LIMIT 500, janela por `created_at`.
- **`GET /api/creative-library?days=&clientId=`** — lista; erro devolve 200 com creatives vazio (tela degrada graciosa).
- **`POST /api/creative-library/enrich`** `{days, items:[{clientId, adIds}]}` — gasto (insights `time_range` como field param) + `creative{thumbnail_url}` via Graph batch `?ids=` (40/lote), token por cliente via `getClientMetaAdsToken` (EXPORTADO de meta-ad-resolver), cache `meta_ad_enrich_cache (ad_id, days)` TTL 4h, orçamento 45s best-effort. CPL calculado na UI = gasto/leads do CRM.
- **`src/components/creative-library.tsx`** (`CreativeLibrary {clientId?}`) — componente único das 3 telas: chips de período 7/30/60/90d, busca, filtros cliente/segmento (só na visão global), rede (Todas/Instagram/Facebook via ig_leads/fb_leads>0), ordenação leads/vendas/receita/**menor CPL**/gasto + **etapas DINÂMICAS do funil** (união dos `por_status`, top 8 — cobre "mais agendamento"/"mais negociação" com os nomes reais das etapas de cada funil), card com rank/thumb (fallback ImageOff)/badges cliente+segmento+IG/FB/5 métricas/chips de etapa/link "Ver anúncio" (source_url). ⚠️ lucide-react atual NÃO exporta ícones de marca (Instagram/Facebook) — usar badges de texto.
- **Telas**: (1) `/resultados/criativos` — 3ª aba do Radar (`results-tabs.tsx`, herda flag radar); (2) CRM → botão "Anúncios" no toggle de views (`CrmTab` ganhou `'ads'`, render `<CreativeLibrary clientId={clientId}/>`); (3) Início — `TopCreativesCard` (top 5 por leads 30d, link pra biblioteca).
- ✅ Verificado no preview (dev :3000, session forjada + fetch mockado): ranking, CPL sort correto, sorts por etapa dinâmicos, thumbs com fallback, card do Início com empty state. ⚠️ Dados reais (agregação SQL + Graph spend/thumbnail) exigem produção — validar abrindo a aba Criativos e conferindo gasto/CPL preenchendo ao carregar.

## CRM — webhook NUNCA salvava mensagem (causa raiz de "só atualiza abrindo o CRM" + Rastreio zerado) (2026-07-24)

Matheus reportou que o chat só atualizava ao abrir o CRM e que o Rastreio de WhatsApp não funcionava (1.032 leads/30d, ZERO atribuição, ZERO região). Diagnóstico com testes reais (payloads sintéticos na rota de produção + mensagem real via Evolution + logs da VPS por SSH `root@2.25.144.71`):

- **Causa raiz (webhook)**: o `messages.upsert` REAL da Evolution **v2.3.7** traz `status: 'DELIVERY_ACK'/'READ'` DENTRO do `data` da mensagem nova. O `extractEvolutionStatusUpdates` (webhook route) usava `item.status` como critério → **TODA mensagem recebida era classificada como atualização de ✓✓**, caía no UPDATE de status (não acha nada) e era descartada com HTTP 200 — a Evolution considerava entregue (zero retry/erro nos logs) e NADA era salvo. Payload sintético sem `status` funcionava, por isso os testes de rota passavam. Correção: gate por nome de evento no início do extractor — evento explícito que não é `MESSAGES_UPDATE` retorna `[]` (com normalização `messages.update` → `MESSAGES_UPDATE`, ponto vs underscore — o check antigo da linha do fallback nunca casava). Consequências do bug: CRM só "andava" pelos imports do navegador, atribuição/CTWA/região nunca rodavam (vivem no caminho do upsert), conversões nunca disparavam.
- **Bug 2 (import do inbox)**: chat `@lid` SEM `remoteJidAlt` usava os dígitos do LID como telefone (passa no filtro 8-15 dígitos) → 416 dos 500 leads recentes com LID no campo `numero`, e o upsert (numero = COALESCE(phone,…)) **sobrescrevia telefones reais com LID** a cada import. Correção: LID nunca vira phone; contato `@lid` sem alt entra só com `lid` (filtro aceita lid-only). Os leads corrompidos **se auto-curam**: o upsert casa por `numero == lid` OU `whatsapp_lid`, e a próxima mensagem real (webhook consertado, payload traz o fone real) grava o número certo + DDD/região via `applyLeadAttribution`.
- **Validação da máquina de rastreio** (produção, cliente Onmid/instância comercial-onmid-diego): payloads sintéticos → DDD 48→SC/Florianópolis ✓, CTWA (`externalAdReply`) → origin meta + has_ctwa + nome do anúncio ✓, LID+alt → número real + DDD ✓. O código estava saudável; o fluxo real nunca chegava nele. 3 leads de teste criados no CRM Onmid (numeros 5548999990000/1, 5543999990003 — podem ser apagados).
- **Sync de reserva no SERVIDOR** (`/api/crm/sync-cron`, GET secret-guarded, maxDuration=300): pra cada cliente com instância Evolution ativa roda webhook-heal + import do inbox (HTTP interno nas rotas canônicas, orçamento 240s, best-effort por cliente). Workflow `.github/workflows/crm-sync.yml` a cada 10min — **secret GitHub necessário: `CRM_SYNC_URL`** = `https://reports.onmid.app/api/crm/sync-cron?secret=<REPORTS_CRON_SECRET>`. O webhook é o tempo real primário; o cron garante o inbox andando mesmo sem ninguém logado.
- **Backfill CTWA retroativo** (`GET /api/crm/backfill-ctwa?secret=&days=`, mesmo family de secrets, maxDuration=300): varre o histórico armazenado da Evolution (`findMessages`, até 50 páginas × 100 msg/instância) atrás de `externalAdReply` (busca recursiva no record), re-aplica atribuição first-touch no lead (ctwa_clid/source_id/campanha via `resolveMetaAdHierarchy`/origin meta se organic/DDD/first_origin_at) e grava evento `ctwa` dedupado por key.id. Idempotente. Rodado em produção 2026-07-24: 24.782 msgs varridas, **164 mensagens de anúncio recuperadas, 87 leads atualizados + 77 criados** (leads de anúncio que nunca tinham entrado no CRM). Ingleses: 0 CTWA nos últimos 17 dias de histórico (5.000 msgs) — anúncios deles provavelmente não são de destino WhatsApp/CTWA.
- Lições de diagnóstico: Evolution NÃO loga erro de webhook por padrão (só "Erro não recuperável"/"Todas as tentativas falharam" quando há falha HTTP — silêncio = 200); logs via `docker logs` na VPS; os envs `PROXY_*` do container são só do Baileys (webhook sai direto). ⚠️ Validar pós-deploy: self-note via Evolution deve aparecer no CRM sem abrir a tela.

## Radar de LP — analytics de comportamento por landing page (2026-07-22)

Camada PRÓPRIA e leve de "mapa de calor" (Etapa 1: números agregados): cadastro de LPs por cliente + script embarcável que coleta cliques/scroll/tempo da MASSA de visitantes (decisão do Matheus: sem visão individual por lead; Clarity não integra — Data Export só agrega 3d, sem heatmap via API).

| Arquivo | Papel |
|---|---|
| `src/lib/lp-analytics.ts` | `ensureLpAnalyticsSchema` (`client_landing_pages` + `lp_sessions`, padrão memoizado), `generateLpTrackingKey` (10 chars minúsculos sem ambíguos), `TRACKING_KEY_REGEX`, tipo `LpClick` |
| `src/app/api/lp/tag.js/route.ts` | **Primeiro endpoint JS do repo** — serve o IIFE (~2.5KB, zero deps, tudo em try/catch) com `Content-Type: application/javascript` + cache 1h. Snippet: `<script src="{base}/api/lp/tag.js?k=KEY" defer>` |
| `src/app/api/lp/collect/route.ts` | POST público de ingestão — body text/plain via sendBeacon (**zero preflight; o repo segue sem nenhum handler OPTIONS**), TODA saída 204 (sem oracle de keys), sanitização campo a campo, upsert fire-and-forget |
| `src/app/api/clients/[id]/landing-pages/route.ts` | GET (lista + sessions_30d + last_session_at + `base` via `webhookOrigin`), POST (retry 3x no 23505), DELETE `?lpId=` |
| `.../landing-pages/[lpId]/stats/route.ts` | Promise.all: totais + funil de scroll (COUNT FILTER ≥25/50/75/100) + top cliques (`jsonb_array_elements`) + device/campanha/origem + série diária; days clamp 1-90 |
| `clientes/[id]/landing-pages-tab.tsx` | Aba "Landing Pages" (`TABS` id `'lps'`): lista com status de coleta (<24h = verde), modal Nova LP, snippet com copiar, painel com KPIs + **funil de scroll** (herói) + ranking "onde mais clicam" + device/campanha/série |

- **Anti-firehose (Vercel Hobby)**: 1 LINHA POR SESSÃO em `lp_sessions` — o script acumula no browser e manda snapshot (primeiro ~3s, flush 20s com dedupe, visibilitychange/pagehide); collect faz `ON CONFLICT (lp_id, session_key) DO UPDATE` com `GREATEST` em scroll/duration (beacons fora de ordem) e substitui `clicks` (snapshot é superconjunto). Cap 50 cliques/32KB.
- **Descritor de elemento** (agrupamento estável entre sessões): sobe ≤3 níveis até ancestral interativo (clique no `<span>` agrupa com o botão) → `tag#id` > `tag.classeEstável` (regex filtra hash/utility) > `tag`. **LGPD**: input/textarea/select nunca carregam texto; só cliques+scroll, nada digitado sai da página.
- **Etapa 2 destravada** (overlay visual de heatmap, não construída): coords absolutas E normalizadas (`xp`/`yp`) + viewport/doc_height já persistidos em `clicks` JSONB.
- **Lições do tag**: (1) medir scroll também DENTRO do `send()` — scroll programático nem sempre dispara evento; (2) viewport lida na hora do envio com memoização da última medida não-zero (`vwNow`/`vhNow` — aba em background lê `innerWidth=0` e derrubava o device pra "mobile"); (3) forçar 100% a ≤2px do fundo (arredondamento nunca fechava a faixa).

### Etapa 2: overlay de mapa de calor visual (2026-07-22)

Mapa de calor "igual Clarity" SEM screenshot/headless browser: o fundo é a **própria LP ao vivo** — o botão "Ver mapa de calor" (na aba, ao lado do seletor de dias) abre `{lp.url}?onmid_hm=1&onmid_days=N` em nova aba, e o MESMO tag.js já instalado detecta o parâmetro, **NÃO coleta** (a visita do analista não polui os dados) e vira renderizador:

- **`src/app/api/lp/heatmap-data/route.ts`**: GET público consumido pelo tag DIRETO do domínio da LP — **2º endpoint do repo com `Access-Control-Allow-Origin: *`** (junto com o image-proxy; GET simples = continua sem nenhum handler OPTIONS). Params `k`/`days` (clamp 1-90)/`device`. Devolve `{total, funnel, points:[[xp,yp,n]]}` — cliques agregados em bins via SQL (`ROUND(xp,2)` ≈ 1% largura × `ROUND(yp,3)`, LIMIT 4000), nunca sessão individual. Key inválida → 200 vazio (mesma filosofia sem-oracle; a key já é pública no HTML). Cache 5min.
- **Modo mapa no tag.js** (`initHeatmap`, só roda com o parâmetro): banner fixo dark ONMID com controles (Cliques/Scroll · Todos/Celular/Computador · 7/30/90d · Fechar, troca = refetch+redraw) + canvas overlay `position:absolute` sobre o documento (pointer-events:none — página continua usável). **Cliques** = técnica clássica de heatmap: acumula intensidade em alpha (gradientes radiais pretos) → colore alpha→paleta azul→verde→amarelo→vermelho via `getImageData` (canvas reduzido a ≤4M px pra ImageData não estourar; blobs viram manchas Clarity-style). **Scroll** = 4 faixas DOM sobre a página (hue 0-120 pelo % que chegou: verde=todo mundo viu, vermelho=poucos) + chips "N% chegou aqui" e "N% chegou ao fim".
- ⚠️ Guard obrigatório no draw: `vwNow()`/`docHeight()` <40px → retry 600ms (aba em background lê dims 0 → sem o guard o canvas nasce com width 1 e cada blob vira uma LISTRA horizontal esticada no `width:100%` — bug real encontrado no preview). Redesenho no resize (debounce) + retry 1.5s (lazy-load muda altura).
- ✅ Verificado no preview (página de teste com heatmap-data mockado no `<head>`): manchas vermelho/amarelo no CTA + azuis esparsas, modo scroll com gradiente verde→laranja e chips corretos (100/90/60/34/16%), filtros re-renderizam, Fechar remove tudo, e o modo coleta normal segue intacto (beacons 204). SQL real do heatmap-data exige produção.
- **`.env.local` ganhou placeholders** `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` — sem eles a página `/clientes/[id]` nem renderiza no dev local (supabase.ts exige a env; crash pré-existente que bloqueava qualquer verificação de preview das abas).
- ✅ Verificado no preview: tag.js real numa página de origem diferente (localhost:8787→3000) — beacons POST 204 **sem OPTIONS**, payload conferido interceptando sendBeacon (agrupamento, LGPD, UTMs, sp=100, device desktop); UI com fetch mockado (lista, status, snippet com base canônica, funil, ranking, modal). ⚠️ Persistência real (upsert/stats com DB) só em produção: cadastrar LP de teste, instalar snippet e conferir stats.

---

## Rastreio de Leads — Fase 1: fundação de captura (2026-07-15)

Objetivo do módulo (4 fases): saber de TODO lead o canal, campanha, conjunto, criativo, posicionamento, palavra-chave e região — em tempo real e permanente (só some se o lead for deletado), para alimentar relatórios/análises de campanha com IA. Fase 1 entregue; Fases 2 (formulários: Meta Lead Ads nativo + landing + terceiros), 3 (demografia agregada por campanha + UI rica lendo `crm_leads`/eventos em vez da legada `whatsapp_leads`) e 4 (Google offline conversions com o gclid capturado + conserto do GA4 client_id + unificação do CAPI Meta duplicado) pendentes.

| Arquivo | Papel |
|---|---|
| `src/lib/lead-tracking.ts` | Núcleo: schema (ALTERs + `lead_tracking_events`), `generateClickCode`/`extractClickCode`, `extractTrackingFromText` (fallback URL no texto), `matchClickByCode`, `mergeTracking`, `applyLeadAttribution`, `linkClickToLead`, `recordTrackingEvent`, `geoFromHeaders` |
| `src/lib/ddd-regioes.ts` | Mapa estático DDD→UF/região + `regiaoFromPhone` (sem API externa) |
| `src/app/r/[slug]/route.ts` | Captura completa no clique: utm_*, gclid/wbraid/gbraid/fbclid/ttclid/msclkid, ValueTrack (keyword/matchtype/device/network/placement/loc), geo via headers `x-vercel-ip-*`, params desconhecidos em `extra_params` JSONB; gera `click_code` |
| `src/app/api/webhook/whatsapp/[instanceId]/route.ts` | Casa `Cód: XXXXXX` com o clique, herda atribuição server-side, deriva região (IP do clique > DDD), grava evento imutável |
| `capture-links-tab.tsx` | Templates de UTM atualizados (Meta: macros por NOME + placement + site_source_name; Google: ValueTrack completo) + snippet JS pra landing repassar params ao botão `/r/` |

### Decisões arquiteturais

- **Ponte clique↔lead por código curto, não por URL no texto.** O `/r/[slug]` grava o clique com TODOS os parâmetros server-side e injeta `Cód: A7X2K9` (6 chars, alfabeto sem 0/O/1/I/L) na mensagem — substituiu a linha `Origem: <URL>` (spam visual e frágil). O webhook extrai o código (`extractClickCode`, regex `c[óo]d(igo)?[.:]`), casa via `matchClickByCode` (janela 90 dias) e a atribuição do clique **vence** a do texto (`mergeTracking`). `extractTrackingFromText` continua como fallback para links antigos/URLs coladas. Depois do casamento, `linkClickToLead` grava `lead_id`/`matched_at` no clique — clique e lead deixam de ser mundos separados.
- **`lead_tracking_events` = histórico IMUTÁVEL de toques** (não de mensagens): grava o primeiro contato (snapshot completo) + qualquer mensagem posterior com identificador novo (ctwa/link_click/utm_texto). `event_type`: `ctwa | link_click | utm_texto | contexto | organico` (Fase 2 adiciona `formulario`). FK `ON DELETE CASCADE` p/ `crm_leads` (some só com o lead). Dedup de retry por índice único parcial `(lead_id, external_id)` + `ON CONFLICT DO NOTHING`.
- **First-touch protegido em `crm_leads`**: colunas novas (gclid/wbraid/gbraid/fbclid/ttclid, keyword/matchtype/device/network/placement, click_code, ddd/regiao_uf/regiao_cidade/regiao_fonte) preenchidas via `applyLeadAttribution` com `COALESCE(NULLIF(col,''), novo)` — UPDATE separado do upsert gigante de `crm-conversation-sync.ts` (de propósito: não mexer nos 26 params posicionais).
- **Região sem API externa**: geo do clique via headers `x-vercel-ip-country/-region/-city` (prioridade, localização real) com fallback DDD do telefone (`regiao_fonte='ip'|'ddd'`). Idade/gênero por lead NÃO existe via WhatsApp — virá de formulário (Fase 2) ou agregado da campanha (Fase 3).
- **`detectOrigin` agora entende click IDs**: gclid/wbraid/gbraid → google (ANTES do utm_source), fbclid → meta, ttclid → tiktok; `adwords` também mapeia p/ google. Antes, lead do Google com auto-tagging puro caía como `organic`.
- **keyword NUNCA cai de `utm_term`**: o template Meta usa `utm_term={{adset.name}}` — fallback keyword←utm_term poluiria a coluna com nome de conjunto. O template Google envia `keyword={keyword}` explícito.
- **Schema via `ensureLeadTrackingSchema`** (memoizada por processo, padrão CREATE/ALTER IF NOT EXISTS inline do projeto — não tem .sql). FK da events table via DO $$ block (Postgres não tem ADD CONSTRAINT IF NOT EXISTS).
- ⚠️ Não verificável no preview local (sem DB/instância Evolution) — funções puras validadas por teste transpilado (27 asserts: round-trip do código, extração de texto, merge, DDD). Validar em produção: clicar num `/r/` com `?utm_source=google&gclid=X&keyword=Y`, mandar a mensagem com o código e conferir `crm_leads` + `lead_tracking_events`.

### Fase 2: formulários (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/lib/meta-leadgen.ts` | `processLeadgenEvent`: busca o lead na Graph (`/{leadgen_id}` — o nó Lead já traz `campaign_name`/`adset_name`/`ad_name` direto), resolve o cliente, upsert no CRM + evento `formulario`. `parseLeadgenFields` normaliza field_data (full_name/first+last, phone/whatsapp, email, city/state, date_of_birth; custom → extras) |
| `src/app/api/meta/webhook/route.ts` | Branch `object=page, field=leadgen` → `processLeadgenEvent` (page token via `getPageToken`), log em `meta_automation_logs` (event_type `leadgen`) |
| `src/app/api/webhooks/[token]/route.ts` | `lead.create` aceita utm_*/gclid/wbraid/gbraid/fbclid/ttclid/keyword/matchtype/device/network/placement/email/cidade/estado OU só `page_url` (extrai tudo da URL via `extractTrackingFromText`); grava atribuição + evento `formulario` |

- **Resolução página→cliente** (leadgen): 1º `meta_leadgen_page_map` (page_id→client_id, criada em `meta-leadgen.ts`; cadastrar manualmente p/ leads orgânicos de form); 2º via `ad_id` → `GET /{ad_id}?fields=account_id` → `client_account_links` (platform meta_ads/meta, aceita `act_` prefixado ou não) — e memoriza no mapa. Não resolvido → log de erro em `meta_automation_logs` com a page_id.
- **Dedup leadgen**: `external_id = 'leadgen:{id}'` em `lead_tracking_events` — checado ANTES de buscar na Graph (Meta reenvia webhooks).
- **Lead sem telefone** (form só-email): INSERT direto em `crm_leads` (upsert exige phone/lid). Com telefone: upsert — junta com a conversa futura do mesmo número no WhatsApp.
- **`crm_leads.email`** (coluna nova) + `regiao_fonte='form'`: cidade/UF declaradas no formulário têm prioridade sobre DDD. Respostas custom viram `observacao` legível + raw completo no evento (é a única fonte de demografia POR LEAD — idade/cidade declaradas).
- **`originFromTracking`** (lead-tracking.ts): helper único de origem por identificadores (gclid→google, fbclid→meta, ttclid→tiktok, utm_source mapeado) — usado pelo webhook WhatsApp (via `detectOrigin`), leadgen e webhook genérico.
- ⚠️ Setup necessário no app Meta p/ Lead Ads nativo: permissão `leads_retrieval` + subscrever o campo `leadgen` no webhook do app + página assinada (`/{page_id}/subscribed_apps`). Sem isso a Meta não manda o evento.
- ⚠️ Validado por teste transpilado (19 asserts: parseLeadgenFields + originFromTracking); fluxo completo precisa de produção (Graph API + DB). Testar com o Lead Ads Testing Tool da Meta (developers.facebook.com/tools/lead-ads-testing).

### Fase 3: demografia agregada + UI rica (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/app/api/tracking/leads/route.ts` | GET consolidado (`clientId?`, `days`, `limit`) — lê a atribuição REAL de `crm_leads` (origem, campanha/conjunto/anúncio, keyword, placement, região, flags has_ctwa/has_gclid/click_code) + summary (porOrigem/porCampanha/porRegiao/porKeyword/porPlacement, % com atribuição/região). Substitui a leitura da legada `whatsapp_leads` nas telas |
| `src/app/api/tracking/demografia/route.ts` | GET `clientId` — breakdowns agregados últimos 30d: Meta insights `breakdowns=age,gender` + `region` (level=account, mesmos action_types do metrics — nunca somar famílias); Google GAQL `age_range_view`/`gender_view` + `geographic_view` com resolução de nomes via `geo_target_constant` em lote. Cache 4h (reusa `mccmap:{connId}` do metrics). Tudo best-effort: resultado parcial > 500 |
| `rastreamento/page.tsx` | Seção "Rastreio WhatsApp → Meta Ads" virou **"Leads Rastreados"**: KPIs (total/% atribuição/% região), 4 cards de breakdown, painel de demografia (só com cliente selecionado — precisa da conta de anúncio), tabela rica (Lead, Origem+badges CTWA/gclid/link, Campanha›Conjunto›Anúncio, Keyword/Posição, Região c/ fonte) |
| `clientes/[id]/tracking-tab.tsx` | Tabela de leads da sub-aba WhatsApp agora lê `/api/tracking/leads?clientId=` com as mesmas colunas ricas; status de envio de conversão continua na sub-aba Log (`conversion_log`) |

- **Demografia é AGREGADO, não por lead** — o painel deixa isso explícito no texto. Idade por lead só via formulário (Fase 2).
- **Rotas legadas (`/api/whatsapp-leads`, `/api/clients/[id]/tracking/leads`) não foram removidas** — a tabela `whatsapp_leads` ainda alimenta a dedup do CAPI legado no webhook. Só as TELAS migraram de fonte.
- ✅ Verificado no preview com `window.fetch` mockado (screenshots: KPIs, breakdowns, badges, tabela, hierarquia de campanha, região com fonte ddd/ip) + degradação graciosa confirmada (API 500 → estado vazio, sem crash). SQL real e chamadas Meta/Google não verificáveis localmente (sem DB) — validar em produção.

### Fase 4: feedback loop pra Meta/Google (2026-07-15)

| Arquivo | Papel |
|---|---|
| `src/lib/google-offline-conversions.ts` | `resolveGoogleAdsAccess` (config `google_customer_id` > `client_account_links`; token cru via OAuth fetch com fallback — espelha report-builder, NUNCA googleapis refreshAccessToken), `resolveConversionAction` (aceita resource name, ID numérico ou NOME da ação — resolve via GAQL c/ cache 4h), `uploadClickConversion` (`:uploadClickConversions`, só UM click id por conversão, `partialFailure:true` — 200 c/ `partialFailureError` conta como falha) |
| `src/lib/conversions.ts` | `enviarEventoGoogle` reescrito: caminho 1 = **offline click conversion** (lead com gclid/wbraid/gbraid da Fase 1 → credita campanha/keyword exata, alimenta Smart Bidding); caminho 2 = fallback GA4 MP com `client_id` sintético determinístico no formato `_ga` (`{int32}.{int32}` do hash do telefone — o hash cru de antes nem era client_id válido; GA4 = contagem, não atribuição). `enviarEventoMeta` ganhou fallback pra `client_tracking_config` (pixel/token legados) quando não há `client_conversion_config`. `hasSuccessfulConversion` exportado |
| `webhook/whatsapp/[instanceId]/route.ts` | **CAPI legado removido** (`sendMetaEvent` com `action_source:'other'` — duplicava Purchase e a Meta não atribuía). FLOW 1 não reenvia Lead (o CAPI novo já mandou no 1º inbound; `whatsapp_leads.evento_lead_enviado` lido do `conversion_log`); FLOW 2 envia Purchase UMA vez pelo caminho novo |
| `tracking-tab.tsx` | Card Google renomeado ("Google — Conversões"): campo Customer ID (opcional), campos de ação de conversão agora pedem NOME ou ID (não mais o gtag label), Measurement ID/API Secret rebaixados a "fallback GA4" |

- **Config semântica mudou**: `google_conversion_label_*` deixou de ser o gtag label e passou a ser NOME ou ID da ação de conversão do Google Ads (necessário pro upload via API). Configs antigas com label gtag caem no log com "ação não encontrada" + fallback GA4 — reconfigurar pelos nomes.
- **Dedup**: continua nos callers (`dispararEventos*`/`dispararEventoFechamento` via `hasSuccessfulConversion`; webhook gate por 1º/2º inbound e `evento_compra_enviado`).
- ⚠️ Validado por teste transpilado (19 asserts: endpoint/headers/payload do upload, precedência gclid>wbraid>gbraid, formato conversionDateTime, partialFailureError, resolução de ação por nome/ID/cache). Chamada real ao Google Ads exige produção — testar com lead real com gclid e conferir `conversion_log` (`[offline_click_conversion]`) + Google Ads → Metas → Conversões (aparece em ~3h).

---

## Rastreio — os UTMs chegavam e se perdiam entre o histórico e o cadastro (2026-09-13)

Print do Matheus (lead de teste da LP do CondoStore) + diagnóstico de outra sessão: a tela "Fonte de captura" mostrava Campanha/Conjunto/Anúncio/UTM como "Não recebido" mesmo com a URL certa. **O diagnóstico da outra sessão estava correto** e foi confirmado no banco: `lead_tracking_events` tinha os quatro UTMs; `crm_leads` (que é o que a tela lê) tinha tudo nulo.

- **`applyLeadAttribution` gravava gclid/fbclid/keyword/região/e-mail, mas NÃO os `utm_*` nem `source_url`.** As portas que fazem INSERT próprio em `crm_leads` (LP e Datalytics) dependem dela para o rastreio inteiro — o dado chegava, ia para o histórico e nunca para o cadastro. O webhook genérico e o WhatsApp não sofriam porque passam por `upsertLeadFromConversation`, que já gravava.
- **⚠️ Era maior que o print**: medido antes do conserto, **80 leads** nessa condição — **79 REAIS da Cost Odonto via Datalytics** (12/08 → 11/09) + o teste da LP. Sem medir, teria parecido bug só da LP nova.
- Correção na função, uma vez para todas as 7 portas: 6 colunas em fill-blanks (`COALESCE(NULLIF(col,''), NULLIF($n,''))`, first-touch vence) + `ADD COLUMN IF NOT EXISTS` no ensure. A rota de LP também passou a carregar `source_url` do `page_url` (montava o tracking sem ela).
- **Backfill aplicado em produção**: os 80 leads receberam os UTMs do toque MAIS ANTIGO do histórico (first-touch), só onde o cadastro estava vazio. Ids tocados guardados no log da sessão.
- ✅ Verificado: 25 asserts exercitando a função REAL com pool stub (6 colunas em fill-blanks, valores nas posições certas, `undefined`→`null`, contagem de placeholders = nº de parâmetros — o erro clássico ao estender UPDATE posicional); tsc + `next build` limpos; lead do print conferido no banco depois do backfill.
- ⚠️ Lição: **toda porta que faz INSERT próprio em `crm_leads` precisa de `applyLeadAttribution` COMPLETA** — se um campo de rastreio nascer, é aqui que ele entra, não em cada rota.

## Fontes de captura — "Meta Forms" lista os formulários nativos da Página e conecta com um clique (2026-09-13)

Pedido do Matheus: "forms meta nas formas de captura deveria puxar todos os forms nativos vinculados à página e IG, só selecionar". O tipo "Meta Forms" do wizard só gerava um webhook para Make/Zapier e prometia "conexão nativa: próxima etapa".

- **`src/lib/meta-leadgen-forms.ts`** (server) + **`GET/POST/DELETE /api/clients/[id]/meta-forms`**: resolve a Página do cliente (snapshot do monitor → vínculo `facebook` → vínculo `instagram` via `me/accounts`; **nunca chuta a 1ª Página da conexão** — lição de 04/08), pega o token da Página, lista `/{page}/leadgen_forms` (nome, status, `leads_count`, perguntas), e "conectar" faz TRÊS coisas: mapa `meta_leadgen_page_map` (o webhook resolve o dono do lead por ele), **assinatura da Página no app com `leadgen`** e registro em `meta_leadgen_forms` (form_id PK, contador `leads_recebidos` que o `processLeadgenEvent` incrementa).
- **⚠️ A ingestão já existia e NUNCA tinha recebido nada**: medido em 13/09 — a Página do CondoStore tinha **zero** assinaturas no app, e **no nível do app só existia `object=instagram`** (comments, messages). Sem `object=page`+`leadgen` a Meta não entrega evento de formulário para Página nenhuma. **Criada por API** (`POST /{app}/subscriptions`, verify_token de `meta_webhook_config`): agora `object=page active=true fields=leadgen`. Conferir com `GET /{app_id}/subscriptions?access_token={app_id}|{app_secret}` — o App ID mora em `meta_integration.app_id` (banco), não em env; `META_APP_SECRET` é env.
- **⚠️ `subscribed_apps` POST SUBSTITUI a lista de campos** — mandar só `leadgen` desligaria `feed`/`messages` de outra automação. `mesclarCamposAssinados` lê o que existe e soma (assert cobre).
- **⚠️ Página é PK do mapa página→cliente**: se já pertence a OUTRO cliente, conectar recusa com o nome do dono em vez de roubar em silêncio (o webhook passaria a entregar todos os leads da Página no cliente errado). Caso real: Cinfel/Cinfel Filial compartilham conta.
- **Wizard**: o tipo Meta Forms abre direto na lista (busca, ativos primeiro, "N leads na Meta", perguntas, já-conectado desabilitado), checkbox múltiplo, "Conectar N formulários"; o caminho Make/Zapier virou link secundário. A aba ganhou a seção "Formulários Meta conectados" (leads recebidos por aqui, último lead, desconectar). Cliente sem Página/IG vinculado vê o motivo e o que fazer.
- ✅ Verificado: 12 asserts (normalização do shape REAL da Graph, ordenação ativo→leads→nome, mescla idempotente); tsc + `next build` limpos; **Graph real**: 23 formulários da Página do CondoStore listados com o token atual (`leads_retrieval` + `pages_manage_ads` concedidas).
- ⚠️ **Não provado ponta a ponta**: nenhum lead real de formulário chegou ainda por esse caminho. Teste definitivo = conectar um formulário pela tela e disparar um lead pelo **Lead Ads Testing Tool** da Meta (developers.facebook.com/tools/lead-ads-testing) — deve aparecer no CRM com `canal='Formulário Meta'` e o contador do card subir.

## Meta Forms — virou AUTOMÁTICO por Página, sem escolher formulário (2026-09-13, 2ª decisão do dia)

Matheus, logo depois da tela de seleção: "deixa automático qualquer formulário vinculado à página ou à conta do cliente e já integrar no CRM, sem selecionar qual form". A lista com checkbox de horas antes morreu.

- **A unidade é a PÁGINA, não o formulário**: a assinatura `leadgen` é da Página, então TODO formulário (atual e futuro) já chega pelo webhook. `conectarPaginaDoCliente` = resolver Página → mapa página→cliente → assinar → registrar todos os formulários (só para contadores). Idempotente, roda sozinha em dois gatilhos: **o GET da aba** (abrir Fontes de Captura já conecta) e a **rotina diária da carteira** (`garantirLeadgenParaTodos`).
- **⚠️ A rotina mora em `/api/social-monitor/refresh/leadgen`**: o proxy libera cron por PREFIXO e `/api/social-monitor/refresh` já está em `CRON_PREFIXES` — nasceu sem tocar no `proxy.ts`, que estava com trabalho de outra sessão. Cron na VPS diário.
- **⚠️ Página que já pertence a OUTRO cliente é RECUSADA** (`meta_leadgen_paginas.erro` com o nome do dono) em vez de roubada — o mapa é PK por página; roubar entregaria todos os leads daquela Página no cliente errado (caso real Cinfel/Cinfel Filial, que compartilham conta).
- **Formulário desconhecido entra no evento**: `processLeadgenEvent` faz `INSERT … ON CONFLICT DO UPDATE` em `meta_leadgen_forms` — formulário criado na Meta depois da rotina já conta desde o 1º lead; o nome chega na próxima passada.
- **"Desligar"** tira `leadgen` da assinatura (mantendo os outros campos assinados), solta o mapa e apaga o status; os formulários ficam como histórico.
- ✅ Verificado: 12 asserts da lib (puros), tsc + `next build` limpos (2 rotas), eslint sem erro nos 5 arquivos. ⚠️ Ainda sem lead real de ponta a ponta — o teste é o Lead Ads Testing Tool da Meta num formulário do CondoStore.
- ✅ **1ª rodada REAL na carteira (13/09, 102s)**: **39 de 42** Páginas assinadas. As 3 fora são LEGÍTIMAS e ficam gravadas em `meta_leadgen_paginas.erro`: Panino77 Curitiba e Picolocos Prochet **compartilham a Página** com Panino'77 / PicoLocos Guanabara (a rotina percorre em ordem alfabética, então o dono é quem vem primeiro — se o Matheus quiser que os leads de formulário caiam na OUTRA unidade, é trocar o `client_id` no `meta_leadgen_page_map`); Sorrifácil Cambé devolve `(#200) User does not have sufficient administrative permission… Two Factor Authentication` — o usuário do token não é admin daquela Página (ou o Business exige 2FA); resolve no painel da Meta, não no código. Cron: `20 12 * * *` (09h20 BRT), backup em `/root/crontab-backup-antes-leadgen.txt`.
- ⚠️ Rotina de diagnóstico: o host da VPS **não tem `node`** — ler JSON lá com `python3` (ou `docker exec … node -`).

## Lead — cidade e respostas de formulário deixam de ficar escondidas (2026-09-13)

Print do Matheus no modal "Editar Lead": "precisam conter também cidade e respostas de formulário quando tiver. E isso tem que virar informação na dashboard".

- **As respostas SEMPRE chegaram** — moram em `lead_tracking_events.raw` e, no cadastro, viravam uma linha de observação ilegível (`Formulário Meta — qual_procedimento_você_está_interessado_: implante_unitário_`). **`src/lib/lead-formulario.ts`** normaliza os três formatos (Meta `field_data[]`, LP objeto plano, wrapper `{lead:{…}}` de CRM externo), descarta identidade (já é coluna) e envelope técnico (id de anúncio, utm, token), e humaniza o slug da Meta.
  - ⚠️ **Não restaura pontuação perdida**: `qual_procedimento_você_está_interessado_` vira "Qual procedimento você está interessado" — pôr um "?" seria escrever pergunta que ninguém fez.
  - ⚠️ **Valor com `@` não é capitalizado**: a parte local de e-mail é sensível a caixa.
  - ⚠️ **Array no topo é descartado** — `typeof [] === 'object'`, e iterar um array solto criava perguntas chamadas "0" e "1" (pego por assert, não por revisão).
- **⚠️⚠️ Cidade ≠ região, e a base provava isso**: `regiao_cidade` guardava as duas coisas e é DOMINADA pelo DDD — medido em 13/09: **10.551 de 12.441**. "Bauru / Marília / SP" é nome de região de DDD, não endereço. `localDoLead` decide o rótulo: cidade declarada → **Cidade**, DDD/IP → **Região**, e a tela mostra a fonte por extenso ("estimada pelo DDD do telefone"). Sem isso o campo mentiria em 8 de cada 10 leads.
- **`crm_leads.city` virou a coluna da cidade DECLARADA** e `applyLeadAttribution` passou a preenchê-la (Meta Forms mandava só para `regiao_cidade`; a LP gravava no INSERT mas não no UPDATE). Backfill: **86 leads** que já tinham declarado cidade (`regiao_fonte='form'`) receberam `city`.
- **Modal do CRM e detalhe do funil** ganharam a linha de localização com a fonte e o bloco "Respostas do formulário" — busca sob demanda em `GET /api/crm/[id]/formulario` (o mesmo padrão da análise da IA). ⚠️ Carregar na LISTA seria um JSONB por linha em tela de centenas de leads. Sem resposta o bloco **não renderiza** em vez de dizer "nenhuma".
- **Agregado** (`/rastreamento`): card "Por cidade (informada no formulário)" SEPARADO do "Por região (UF)", e painel de respostas por pergunta.
  - ⚠️ **Pergunta de resposta livre não entra no painel** — descoberto com dado REAL depois do deploy: "Qual nome da empresa?" deu 13 respostas e 13 nomes diferentes, e "Email profissional" virou barra de gráfico com e-mail de pessoa. Régua: entra quem tem alguma resposta repetida; o painel diz quantas ficaram de fora e por quê. **O modal não filtra nada** — lá a resposta livre é o que o gestor quer ler.
  - A agregação roda em JS sobre `extrairRespostas`, não em SQL: o raw tem formatos diferentes e uma segunda régua divergiria da primeira.
- ✅ Verificado: 34 asserts; tsc + `next build` limpos; eslint sem erro novo (comparado ao HEAD na mesma config); harness no browser com o raw REAL (desktop + 375px); **rotas provadas em produção com sessão forjada** — `/formulario` devolvendo "Quantas unidades está pensando em adquirir? → 10" de um lead real, e o agregado com "Implante unitário 3 · Tarde — das 14h às 18h 2".
- ✅ **De brinde, a prova que faltava do Meta Forms automático**: o lead usado no teste é de **14/09**, canal "Formulário Meta" — chegou sozinho pelo webhook depois da conexão por Página. A ingestão nativa está viva.
- ⚠️ **PENDENTE — painel na `/dashboard` principal**: `dashboard/page.tsx` estava com WIP de outra sessão no working tree e commitar levaria o código dela junto. A rota (`/api/tracking/leads` com `porCidade` e `formulario`) e o desenho do painel já existem; falta só montar lá.

## Lead da LP com ID no lugar do nome e origem "ig" (2026-09-14)

Print do Matheus de um lead do CondoStore: "veio bagunçado, não consigo identificar nada; o utm_source veio como ig mas foi LP". A URL contava a história:

```
?utm_medium=paid&utm_source=ig&utm_id=52604281006064&utm_content=52604281079464
 &utm_term=52604281013664&utm_campaign=52604281006064
```

É o **parâmetro AUTOMÁTICO do Meta Ads** — `{{site_source_name}}` vira sigla (`ig`) e campanha/conjunto/anúncio vêm como **ID**, ao contrário do template da agência, que usa `{{campaign.name}}`. Não estava bagunçado: estava ilegível. Três defeitos NOSSOS, todos medidos antes de mexer:

- **⚠️⚠️ A rota da LP já traduzia ID→nome para o GOOGLE, e o comentário dizia que a Meta "sempre manda nome"** — este lead desmentiu. O bloco virou um só, cobrindo os dois canais (`pareceIdMeta` + `resolveMetaAdHierarchy`, que já existia com cache e era usado por webhook/leadgen/backfill — só o caminho da LP não usava). Graph confirmou: `52604281079464` = **DARK - RAFA 03**, conjunto **FORMS NACIONAL**, campanha **[ON] [FORMS] [NACIONAL] - 01/09**.
- **⚠️ Os nomes vão para COLUNAS PRÓPRIAS (`campaign_name`/`adset_name`/`ad_name`), e os `utm_*` guardam o que a URL trouxe.** O caminho do Google sobrescrevia o `utm_campaign` com o nome — o campo "UTM campaign" da tela passava a mostrar algo que nunca esteve no link. `applyLeadAttribution` ganhou os três campos (fill-blanks), então **todas as 7 portas** herdam de uma vez, igual ao conserto dos `utm_*` de 13/09.
- **⚠️ `originFromTracking` não reconhecia as siglas do `{{site_source_name}}`** (`ig`, `fb`, `msg`, `an`) — a origem virava `"ig"` cru, um canal NOVO no donut em vez de somar com Instagram. **As siglas casam INTEIRAS, nunca por substring**: `ig` casaria em "d**ig**ital", `an` em "b**an**ner" (os dois estão nos asserts). `faceads` (76 leads na base) também passou a cair em `meta`.
- **⚠️ A linha "Conjunto" do modal caía em `utm_medium`** quando não havia adset — por isso exibia **"paid"**, que é o MEIO, nunca o conjunto. O fallback saiu e `utm_medium` ganhou linha própria ("Meio").
- **⚠️ O escopo era maior que o print**: medido, **5 leads** com ID de anúncio sem nome — 1 do CondoStore e **3 da Cost Odonto** (que ninguém tinha reportado). Backfill resolveu 4 pela Graph; 1 ficou sem nome porque o ad_id (`801932230700`, 12 dígitos) não existe mais na conta — corretamente deixado como está.
- **Backfill de origem**: 1 `ig` → `instagram`, 76 `faceads` → `meta`. ⚠️ O `utm_source` CRU é preservado (os 77 seguem com `faceads`/`ig` no campo do UTM) — só a classificação de canal mudou, senão o histórico ficaria dividido entre o antes e o depois do deploy.
- ✅ Verificado: **25 asserts** (siglas exatas, "digital"/"banner" NÃO virando Meta, ID × nome de campanha, e a **contagem de placeholders do UPDATE batendo com a de parâmetros** — o erro clássico ao estender UPDATE posicional); tsc + `next build` limpos; eslint sem erro novo; Graph real resolvendo os 3 níveis; lead do print conferido no banco depois do backfill.
- ⚠️ Lição que se repete: **ID de objeto de anúncio chega por caminho que ninguém previu**. Qualquer porta que grave `utm_*` deve passar por `pareceIdMeta`/`pareceIdGoogle` antes de exibir — nome de campanha nunca é só dígitos.

### ⚠️ Correção no mesmo dia: o conserto acima cobria UMA porta de sete (2026-09-14)

Pergunta do Matheus logo depois: *"isso não vai acontecer mais em nenhum cliente?"*. **Não ia** — e a resposta anterior ("do nosso lado já está resolvido") estava errada.

- **Medido por onde os 5 leads realmente entraram**: **3 pelo DATALYTICS** (Cost Odonto), 1 pela LP do CondoStore, 1 pela LP da Romanza. O conserto tinha ido só na rota da LP; **Datalytics e webhook genérico também aceitam `utm_*` de fora** e continuariam gravando ID.
- **A tradução saiu das rotas e foi para dentro de `applyLeadAttribution`** — a função que as 6 chamadas (7 portas) já usam. É a MESMA lição de 13/09, quando os `utm_*` se perdiam por não estarem nela: **regra de rastreio mora na função compartilhada, nunca em cada rota**.
- **⚠️ A régua depende de a porta passar `clientId`** (o token de anúncio é por cliente). Por isso existe um **assert que varre os call sites e FALHA se alguma porta esquecer** — provado removendo o `clientId` do Datalytics: o teste quebra citando arquivo e linha. É o que impede a próxima porta de repetir o erro.
- **Custo**: o guard só dispara quando algum UTM É um ID (`pareceIdMeta`/`pareceIdGoogle`) — medido: apenas 5 leads em toda a base. Lead de WhatsApp sem UTM não paga chamada nenhuma. Best-effort: falha de Graph/GAQL nunca derruba a gravação do lead.
- ⚠️ **O tsc pegou um erro real no meio**: `clientId` não existia no escopo de `posProcessarIngestao` (Agendor usa `conn.client_id`). E o assert de placeholders quebrou ao mover código para dentro da função — **os dois avisos foram úteis**, não ruído; o recorte do teste foi reancorado no `UPDATE` em si.
- ⚠️ **Limite honesto**: anúncio cujo ID não existe mais na conta não tem nome para buscar (caso real: Luzia/Romanza, ad `801932230700` apagado na Meta). O ID fica.
- ✅ 32 asserts; tsc + `next build` limpos; eslint 0 erros nos 6 arquivos; assert de regressão provado falhando.

## Landing page (GA4) — tráfego pago, audiência e comportamento (2026-09-21)

Lâmina "Landing page" do dashboard (`src/lib/ga4-landing.ts` +
`src/components/dashboard/ga4-landing-panel.tsx`, rota `/api/clients/[id]/ga4`,
cache `ga4:v3`) ganhou 4 abas: **Visão geral** (KPIs + engajamento, tempo médio,
novos, páginas/sessão, vídeos), **Tráfego pago** (qualidade por canal; campanhas
do Google Ads com custo/cliques/custo por conversão; todas as campanhas por UTM —
Meta entra aqui; palavras-chave; termos pesquisados), **Audiência** (dispositivo,
cidade, novos x recorrentes, idade, gênero, grade dia da semana × hora) e
**Comportamento** (rolagem 25/50/75/90, seções vistas, funil do formulário,
página de entrada, vídeos, posição do clique).

- ⚠️ **Bug corrigido (estava no ar desde 04/09): com DUAS faixas de data o GA4
  põe a dimensão `dateRange` como ÚLTIMA coluna**, não a primeira. O parse lia
  `dimensionValues[1]` como nome do evento → WhatsApp/telefone/formulário/
  contatos saíam SEMPRE 0. Agora a posição vem de `dimensionHeaders`
  (`indiceDim`). Conferido na Romanza LP: 11 WhatsApp / 5 formulários.
- Pedidos vão em `batchRunReports` (lotes de 5, até 3 lotes simultâneos — o GA4
  limita pedidos concorrentes por propriedade); lote que falha é refeito um a um.
- Dimensão personalizada só é pedida se estiver registrada (`/metadata`) —
  uma só inexistente derruba o lote inteiro com 400.
- "Conv." = eventos-chave (uma sessão pode ter vários); "Converteu" =
  `sessionKeyEventRate` (guardado como contagem `sessoesConv` para somar
  propriedades). Custo/conv. = custo ÷ sessões que converteram.
- Custo, palavra-chave e termo só vêm com a propriedade GA4 **vinculada ao
  Google Ads**; sem vínculo o painel avisa (Romanza LP em 21/09: sem vínculo —
  campanhas aparecem só como ID numérico do gclid). Idade/gênero dependem do
  Google Signals e somem com pouco volume.
- Contatos contam só os eventos do padrão ONMID (`click_whatsapp`,
  `click_telefone`, `lead_form`). Site com nomes próprios (Londrigifts:
  `click_whatsapp_topo`…) mostra 0 contatos, mas conversões por canal/campanha
  (keyEvents) funcionam.
- **WhatsApp x Formulário x Telefone separados** (pedido do Matheus, 21/09) em
  toda tabela: `categoriaConversao` classifica cada evento-chave pelo NOME
  (whats/wpp → WhatsApp; form/lead/orçamento/cadastro/confirmado → Formulário;
  telefone → Telefone; resto — purchase, maps — só no total). Cada corte tem um
  relatório irmão `conv:<corte>` com `eventName` como última dimensão (métrica
  `keyEvents:<nome>` não serve: nome com acento, ex. `Solicitou_orçamento`, dá
  400). Site fora do padrão ONMID (Ingleses `envio_whatsapp`/
  `form_contato_enviado`, Londrigifts) passa a ter WhatsApp/Formulário nos KPIs
  via `completaTotais` — só preenche o que o evento padrão deixou zerado.
- Palavras-chave e termos: lista COMPLETA dos que trouxeram contato (limite
  1000 no GA4; com 250 a Ingleses perdia 13 termos de pouca visita) + bloco
  "sem nenhum contato" (10+ visitas). Termos: o Google esconde os de pouco
  volume e os da PMax — a soma fica abaixo do total (Ingleses: 394 de 645).
- Teste: `node scratchpad/test-ga4-landing.mjs` (build no cabeçalho do arquivo).
  Harness visual: `scratchpad/harness-ga4.tsx`, com `?json=arquivo.json` para
  ver um consolidado real (não versionar dado de cliente).

## Meta · API de Conversões para lead de SITE (2026-09-22)

`src/lib/meta-capi-site.ts` + chamada em `/api/integrations/lp/[token]`: todo
lead que chega de formulário de site/LP também vai para a Meta pelo SERVIDOR.

- **Por que não reusar `enviarEventoMeta`** (conversions.ts): aquele é o fluxo de
  WhatsApp — `action_source: 'business_messaging'` + `messaging_channel` +
  `page_id`, e manda SÓ o telefone (`ph`). Lead de site precisa de
  `action_source: 'website'`, `event_source_url` e o máximo de sinal de
  correspondência. Os dois convivem; nada do fluxo de WhatsApp mudou.
- **Sinais enviados** (todos em SHA-256, menos os técnicos): em, ph, fn, ln, ct,
  st, country, external_id (lead id), fbp, fbc, client_ip_address,
  client_user_agent. É isso que leva a "qualidade de correspondência" do
  Gerenciador de Eventos de ~5-7 (Pixel sozinho) para 9+.
- **Dedupe:** o `event_id` vem no corpo (o mesmo que o Pixel do navegador usa em
  `eventID`) — a Meta junta e conta UM evento. Sem `event_id`, usa `lp-<leadId>`.
- **fbp/fbc:** cookies do Meta, lidos no navegador e mandados no corpo (o
  servidor não enxerga cookie de outro domínio). Sem `_fbc`, monta do `fbclid`
  (`fb.1.<ms>.<fbclid>`).
- **Nunca quebra a captura:** cliente sem Pixel/token → devolve `sem_pixel` e
  segue; erro da Meta vira log em `conversion_log` (resposta prefixada com
  `[site em+ph+...]` para saber quais sinais foram).
- Config por cliente segue em `client_conversion_config` (aba Rastreio →
  Meta CAPI: Pixel ID, token, test event code).
- Teste: `node scratchpad/test-meta-capi.mjs` (build no cabeçalho do arquivo) —
  9 asserts, incluindo "nada identificável sai em texto puro".
