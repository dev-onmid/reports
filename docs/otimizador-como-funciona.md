# Otimizador de Campanhas — Como Funciona

> Documento de referência para validação externa (humanos e outras IAs). Descreve o que o
> Otimizador faz, como faz, o que analisa e o raciocínio por trás de cada decisão de design.
> Não é uma especificação técnica de código — é uma explicação do comportamento e da lógica.

---

## 1. O que é

O Otimizador é um módulo que analisa contas de anúncios (Meta Ads e Google Ads) de clientes de
uma agência de marketing e transforma dados brutos de performance em **decisões operáveis**:
uma fila de recomendações, uma de cada vez, cada uma com um botão para executar a ação
diretamente na conta de anúncio.

O princípio central: **qualquer funcionário, mesmo sem conhecimento técnico de tráfego pago,
precisa conseguir operar essa tela.** Ele não precisa interpretar métrica nenhuma — só ler uma
frase em português claro e decidir entre três botões.

---

## 2. O fluxo, de ponta a ponta

```
1. Coleta de dados     → busca campanhas/conjuntos/anúncios reais na API do canal
2. Análise por IA       → um modelo de linguagem recebe os dados + contexto e classifica
3. Sanitização          → o código valida e corrige a saída da IA antes de confiar nela
4. Fila de decisão      → a análise vira uma lista plana de recomendações, uma por objeto
5. Decisão do operador  → Ignorar / Editar / Aplicar / Enviar para análise humana
6. Execução             → se aplicado, chama a API do Meta/Google e registra o resultado
7. Auditoria            → tudo fica gravado: quem decidiu, quando, o quê, e pode ser desfeito
```

A análise roda **automaticamente uma vez por semana por cliente** (rodízio entre segunda e
sexta, para distribuir o custo de IA), e pode ser disparada manualmente a qualquer momento.

---

## 3. O que ele analisa (os dados de entrada)

Para cada cliente, o sistema monta um "payload" com:

- **A árvore inteira da conta**: campanha → conjunto de anúncios → anúncio individual, com
  métricas reais de cada nível (gasto, impressões, cliques, conversões, CTR, CPL, ROAS,
  frequência, rankings de qualidade/engajamento/conversão do Meta, dias ativo, status atual).
- **As metas do cliente**: objetivo principal da campanha (leads, vendas, tráfego, engajamento,
  reconhecimento, conversas), CPL/CPA ideal e máximo, ROAS mínimo, orçamento diário e mensal,
  volume de leads esperado por mês.
- **Limites operacionais**: orçamento diário máximo da conta, CPL de emergência, mínimo/máximo de
  conjuntos ativos, mínimo de dias de aprendizado antes de mexer em algo.
- **O modo de operação do cliente**: define se o sistema só diagnostica, sugere com aprovação, ou
  executa sozinho (ver seção 7).
- **Peculiaridades fixas cadastradas pelo gestor**: texto livre com regras permanentes daquele
  cliente específico (ex: "campanhas com [BOT] no nome têm lógica própria, nunca mexer").
- **Histórico recente**: decisões anteriores do gestor e análises passadas, para não repetir o
  mesmo alerta ou contradizer uma decisão já tomada.

**Importante**: os números que aparecem na tela final vêm sempre desse payload (dado real,
verificável), nunca de um número que a IA "lembrou" ou inventou. A IA só decide **classificação,
julgamento e a frase da ação** — nunca os valores numéricos exibidos.

---

## 4. Como ele raciocina — o "norte" de toda análise

### 4.1 Tudo existe para melhorar o resultado do objetivo

Cada campanha tem um objetivo declarado (gerar leads, gerar conversas no WhatsApp, vender,
trazer tráfego, engajar, reconhecer marca). A análise inteira gira em torno de uma pergunta:
**este item está ajudando a entregar mais desse resultado, e mais barato, ou está atrapalhando?**

Isso muda a métrica-chave e o vocabulário usado conforme o objetivo:

| Objetivo | Resultado que importa | Métrica de custo |
|---|---|---|
| Mensagens/WhatsApp | Conversas iniciadas | Custo por conversa |
| Geração de leads | Leads | CPL |
| Vendas | Vendas/receita | ROAS / custo por venda |
| Tráfego | Cliques no link | CPC |
| Engajamento | Interações | Custo por engajamento |
| Reconhecimento | Alcance/frequência saudável | CPM |

Um CPL "alto" numa campanha de tráfego não é problema — não é essa a métrica que importa ali.
A análise nunca mistura o critério de um objetivo com outro.

### 4.2 Teste justo — nunca julgar sem dado suficiente

Um erro comum (que já corrigimos depois de identificado) é tratar "R$3 gastos, 0 conversão"
como falha. Isso não é falha — é **ausência de dado**: o item ainda não teve gasto suficiente
para ter tido uma chance real de converter.

Regra aplicada: um item só pode ser classificado como "sem resultado" (e recomendado para
pausar por esse motivo) depois de ter gastado pelo menos **~2x o custo-alvo por resultado**
(CPL máximo ou ideal cadastrado, ou um piso de ~R$25-30 quando não há meta definida). Abaixo
disso, a recomendação no máximo é "aguardar mais dado" ou "verificar", nunca "pausar" ou
"urgente". Essa regra existe em **duas camadas**: instrução explícita no prompt da IA, e uma
trava no código que descarta a recomendação mesmo se a IA errar — dupla proteção contra
alarme falso.

### 4.3 Cruzamento de múltiplos sinais, nunca decisão por 1 métrica isolada

A análise nunca decide "pausar" só porque uma métrica está ruim. Ela cruza:

- Custo por resultado vs. meta
- Frequência (saturação de público)
- Tendência de CTR (subindo/caindo/estável)
- Rankings de qualidade/engajamento/conversão do próprio Meta
- Dias ativo (está em fase de aprendizado?)
- Ritmo de gasto vs. orçamento disponível

Exemplo de raciocínio composto: CPM subiu + CTR subiu + frequência alta = público saturado
(trocar público, não o criativo). CPM normal + CTR baixo + frequência baixa = criativo fraco
ou público errado (testar novo ângulo). CTR alto + CPL alto = provável problema na página de
destino, não no anúncio.

### 4.4 Cautela temporal e contra reativação por engano

Antes de sugerir reativar qualquer coisa pausada, o sistema verifica:
- O **nome do objeto** sugere sazonalidade (Black Friday, Dia das Mães, campanhas por mês/ano)?
  Se a janela já passou em relação à data da análise, nunca reativa — recomenda arquivar.
- "Pausado" não é sinônimo de "problema" nem de "oportunidade". Só recomenda reativar se a
  pausa parecer não intencional (esgotou orçamento, saiu do aprendizado) **e** o conteúdo
  ainda for relevante para o momento atual.
- Nunca recomenda pausar ou deletar algo que já está pausado (evita instrução redundante).

### 4.5 Não é só sobre problemas — também busca oportunidade de crescer

A maior mudança de raciocínio nesta versão: uma conta "saudável" quase nunca está 100%
otimizada. Se um item entrega o resultado do objetivo **barato e sem sinal de saturação**
(frequência baixa, orçamento com folga), a análise ativamente recomenda **escalar o
investimento** ali — não fica em silêncio só porque "está tudo bem". Escalar o que já funciona
é a forma mais direta de melhorar o resultado geral da conta.

O incremento sugerido é sempre moderado (ex: +20-30%, nunca dobrar de uma vez), para não sair
do intervalo de aprendizado por uma mudança brusca.

### 4.6 Confiança como mecanismo de segurança, não como rótulo

Cada recomendação carrega um nível de confiança (alta/média/baixa), baseado em volume de dados
e tempo ativo. Esse campo não é só informativo — ele **muda o comportamento da interface**:
quando a confiança é baixa (ou a ação não é automatizável, como "trocar criativo"), o botão
"Aplicar" desaparece e vira **"Enviar para análise de um humano"**. O sistema nunca deixa uma
recomendação de baixa confiança ser executada automaticamente por um funcionário sem contexto.

---

## 5. A fila de decisão — como aparece na tela

Cada recomendação vira um card com:

1. **Identificação**: cliente, ícone do canal (Meta/Google), nível (campanha/conjunto/anúncio),
   campanha, badge de severidade (Urgente / Atenção / Oportunidade) e o **objetivo da campanha**
   visível (ex: "Objetivo: Conversas no WhatsApp").
2. **Título em linguagem natural**: nunca jargão técnico. Ex: *"Um criativo está gastando sem
   gerar leads"*, não *"CPL R$47, CTR 0,4%, ranking Below Average"*.
3. **Métricas-chave**: 2-3 números relevantes para aquele tipo de recomendação especificamente.
4. **A ação em si**: uma frase direta com o valor exato quando aplicável (ex: *"Escalar
   orçamento de R$60 para R$80"*).
5. **Três botões**:
   - **Ignorar** — tira da fila, não muda nada na conta, fica registrado quem e quando ignorou.
   - **Editar** — permite ajustar o valor sugerido (ex: outro orçamento) antes de aplicar.
   - **Aplicar** — executa a ação de verdade na API do canal (pausar, ativar, mudar orçamento),
     mostra confirmação com opção de **desfazer**, e registra tudo para auditoria.
6. **"Por que essa recomendação?"** (painel opcional, colapsado por padrão): números crus sem
   interpretação, aviso de dependência de outra recomendação pendente, opção de aplicar a mesma
   ação em outras contas com o mesmo padrão, e link direto para abrir no Gerenciador de
   Anúncios nativo.

A pessoa navega **uma decisão por vez** (contador "X de Y" + barra de progresso), pode filtrar
por cliente específico ou ver a fila geral ordenada por severidade entre todas as contas.

---

## 6. Os "porquês" das decisões de design

- **Por que uma decisão por vez, e não um dashboard?** Um dashboard exige interpretação; uma
  fila exige só uma escolha binária/ternária por item. Reduz a barreira de quem opera a tela.
- **Por que esconder a árvore completa por padrão?** A árvore inteira (campanha→conjunto→
  anúncio) é ruído para quem só precisa agir. Ela existe, mas só dentro do painel "por quê",
  para quem quiser auditar.
- **Por que não usar checklist de cliques na interface (ex: "clique em Editar, mude o campo
  X")?** Testamos essa versão. Ficou redundante: quando a ação é automatizável, o botão
  "Aplicar" já executa sozinho via API — instruir cliques manuais no Gerenciador não agrega
  nada. A frase direta com o valor exato é suficiente e mais rápida de ler.
- **Por que confiança baixa vira "análise humana" em vez de simplesmente não aparecer?** Porque
  a situação pode ser real e importante — só não há dado suficiente para confiar numa execução
  automática. A alternativa correta é envolver um humano com mais contexto, não esconder o
  problema nem arriscar uma ação errada.
- **Por que existe o teste de gasto mínimo?** Foi identificado, em teste real, que a análise
  estava recomendando pausar itens com R$3-R$12 gastos e 0 conversão, tratando isso como falha.
  Isso gera desconfiança no sistema e decisões precipitadas. A regra corrige isso na raiz —
  em duas camadas (prompt + código), para não depender só do bom comportamento da IA.
- **Por que separar ações automatizáveis (pausar/ativar/orçamento) de manuais (trocar criativo,
  verificar)?** Só as três primeiras têm uma chamada de API direta e seguro que um sistema pode
  executar sem risco de julgamento subjetivo. Decisões criativas (qual ângulo testar, se vale
  pausar por motivo ambíguo) continuam exigindo um humano.
- **Por que registrar tudo com autor e permitir desfazer?** Porque o sistema pode agir
  diretamente na conta de anúncio de um cliente — é dinheiro real sendo gasto. Auditoria e
  reversibilidade são obrigatórias para qualquer ação automática ter confiança.

---

## 7. Modos de operação (quanto de autonomia o sistema tem)

Cada cliente tem um modo configurável, do mais conservador ao mais autônomo:

1. **Diagnóstico apenas** — só analisa e mostra, nenhuma ação é sugerida como aplicável.
2. **Recomendação com aprovação** (padrão) — sugere ações, mas sempre espera um humano clicar
   em Aplicar.
3. **Automático parcial** — executa sozinho só as ações que o gestor pré-aprovou (ex: só
   pausar, não mexer em orçamento), respeitando um limite de 2 ações automáticas por ciclo.
4. **Automático total** — executa as ações recomendadas sem esperar aprovação, com as mesmas
   proteções de aprendizado e limites.

Em qualquer modo automático, existe uma **proteção contra mexer em algo que ainda está
aprendendo**: nada é pausado automaticamente antes de um número mínimo de dias ativo
(configurável, padrão 7 dias) — aprendizado interrompido cedo demais prejudica a entrega
mais do que ajuda.

---

## 8. O que o sistema NÃO faz (limitações honestas)

- **Não vê o criativo em si.** Julga por métricas (CTR, rankings, frequência), não pela
  qualidade visual, copy ou apelo da peça. Recomendar "trocar criativo" é o limite — desenhar o
  criativo novo é trabalho humano.
- **Não tem repertório de mercado por nicho.** Compara contra as metas cadastradas pelo
  cliente, não contra um banco de benchmarks de dezenas de contas do mesmo segmento (o que um
  gestor sênior de verdade acumula com experiência).
- **Não conhece contexto de negócio fora dos dados de mídia** (ex: "esse produto sai de linha
  mês que vem", "a equipe de vendas está sobrecarregada"). Isso só um humano com contexto tem.
- **Depende da qualidade do dado que chega da API do canal.** Se a conexão com Meta/Google
  falhar ou os dados vierem incompletos, a análise é tão boa quanto o dado disponível — por
  isso existe uma ferramenta de diagnóstico separada (sem custo de IA) que confirma se os
  dados estão realmente chegando antes de rodar a análise completa.
- **É pattern-matching de um modelo de linguagem, não julgamento humano acumulado.** Funciona
  bem dentro dos padrões e regras que foram explicitamente ensinados no prompt; é mais frágil
  em situações muito fora do script (novo tipo de objetivo de campanha, formato de anúncio
  incomum, etc.).

---

## 9. Resumo em uma frase

O Otimizador transforma dados brutos de performance de anúncios em uma fila de decisões
únicas, em português claro, sempre ancoradas em "isso melhora ou piora o resultado que essa
campanha existe para entregar" — testando se há dado suficiente antes de alarmar, cruzando
múltiplos sinais antes de julgar, buscando tanto problemas quanto oportunidades de crescer, e
travando a execução automática sempre que a confiança não for alta o suficiente para dispensar
um humano.
