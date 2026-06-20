# 📋 Onboard: Configurar Pixel de Mensagem para Novo Cliente

**Tempo estimado: 10 minutos por cliente**

---

## ✅ Pré-requisitos
- Cliente tem **conta de anúncios no Meta** (business.facebook.com)
- Cliente tem uma **Página do Facebook** (recomendado) ou Instagram conectado
- Você tem acesso ao **painel de configuração de conversões** do nosso sistema

---

## 🚀 PASSO 1: Criar Pixel de Mensagem no Meta

### 1.1 Acesse o Gerenciador de Eventos
1. Abra **business.facebook.com**
2. Clique em **"Gerenciador de Eventos"** (ou vá em: business.facebook.com/ia/manage/events)

### 1.2 Clique em "Conectar dados"
- Botão verde no canto superior esquerdo

### 1.3 Selecione "Mensagens"
- Clique no card **"Mensagens"** (última opção)
- Descrição: "Conecte dados importantes de conversas comerciais que acontecem no WhatsApp, no Messenger e no Instagram"

### 1.4 Clique em "Avançar"

---

## 🏢 PASSO 2: Escolha Página do Facebook

### 2.1 Selecione "Facebook Page" (recomendado)
- **POR QUÊ?** Mais simples. Se escolher Instagram, Meta cria uma página "fantasma" e fica complicado depois.

### 2.2 Escolha a Página
- Selecione a **Página que o cliente usa nos anúncios**
- Clique em **"Avançar"**

---

## 📝 PASSO 3: Confirmar Criação

### 3.1 Modal de Confirmação vai aparecer
Você vai ver:
- **Dataset**: Nome da página
- **Perfil do Instagram associado**: O Instagram da página (se houver)
- **Página associada**: Nome da página
- **ID da Página**: `9411550124229...` ← **COPIE ESSE NÚMERO** e salve

### 3.2 Clique em "Iniciar integração"

---

## 🔧 PASSO 4: Escolha "Integração Direta"

### 4.1 Um modal vai aparecer com 2 opções
- Selecione **"Integração direta"** (segunda opção)
- Descrição: "Para uma opção mais personalizável..."

### 4.2 Clique em "Avançar"

---

## ⚙️ PASSO 5: Configurar Eventos

### 5.1 Vai aparecer a tela "Selecione parâmetros"
- **Comprar** e **LeadSubmitted** já estão pré-selecionados ✓
- Os parâmetros importantes já estão marcados ✓

### 5.2 Clique em "Continuar"

### 5.3 Confirmar configuração
- Revise o resumo
- Clique em **"Confirmar configuração"**

---

## 🎫 PASSO 6: Gerar Token de Acesso

### 6.1 Vai abrir a página "Instruções"
- Clique em **"Abrir o guia de implementação"** (link azul)

### 6.2 Clique em "Gerar um token de acesso" (à esquerda)

### 6.3 Copie o Token
- Aparece um token longo no box cinza
- **COPIE ESSE TOKEN** e salve

**Exemplo:**
```
EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🆔 PASSO 7: Achar o Pixel ID

### 7.1 Volte para "Conjuntos de dados" (à esquerda)
- Clique em **"Conjuntos de dados"** no menu superior

### 7.2 Procure o dataset que você criou
- Nome: Deve estar com o nome da página do cliente
- Clique nele

### 7.3 Na aba "Configurações"
- Você vai ver a tabela de dados vinculados
- **Na coluna da direita, embaixo da página**, tem um **ID**
- **COPIE ESSE ID** — é o **Pixel ID**

**Exemplo:**
```
1234567890123456
```

---

## 💾 PASSO 8: Preencher no Nosso Sistema

Agora você tem 3 informações:
1. **Page ID**: `94115501242289` (copiou no Passo 3)
2. **Pixel ID**: `1234567890123456` (copiou no Passo 7)
3. **Token de Acesso**: `EAA...` (copiou no Passo 6)

### 8.1 Acesse o painel do cliente
- Vá em **Clientes > [Nome do Cliente]**

### 8.2 Aba "Rastreamento"
- Clique em **"Configurações"** (ou Tracking)

### 8.3 Seção "Meta Conversions API (server-side)"
- Toggle **"Ativar Meta CAPI"** para **ON** ✓

### 8.4 Preencha os campos:
- **Pixel ID**: `1234567890123456`
- **Token da API**: `EAA...`
- **Page ID**: `94115501242289` ← **NOVO CAMPO**
- **Código de Teste**: Deixe em branco (opcional)

### 8.5 Clique em "Testar conexão"
- Se ficar verde ✓ = está certo!
- Se ficar vermelho = verifica se copiou os números certos

---

## ✨ PRONTO!

Agora quando o cliente clicar em um anúncio no WhatsApp:
- ✓ Vamos capturar a campanha, conjunto, anúncio
- ✓ Quando ele mandar mensagem, Meta vai saber qual anúncio trouxe ele
- ✓ Quando ele comprar, Meta vai contar como conversão

---

## 🆘 Troubleshooting

| Problema | Solução |
|----------|---------|
| "Página não qualificada" ao criar | Página precisa ter Instagram associado + estar em BM |
| Teste de conexão retorna erro 400 | Verifica se copiou o Pixel ID/Token corretamente (sem espaços) |
| Conversões não aparecem | Verifica se o **Page ID** foi preenchido (campo novo!) |
| Campanha/Conjunto aparece vazio | Normal — a gente resolve isso automaticamente via API |

---

## 📌 Checklist Final

- [ ] Cliente tem Página do Facebook (ou Instagram)
- [ ] Pixel de Mensagem criado no Meta
- [ ] Page ID copiado: `_______________`
- [ ] Pixel ID copiado: `_______________`
- [ ] Token de Acesso copiado: `_______________`
- [ ] Preenchido no painel (Pixel ID, Token, Page ID)
- [ ] Teste de conexão = Verde ✓
- [ ] Documentado no CRM: Data de criação, IDs

---

**Dúvidas?** Manda screenshot do erro ou do passo que travou!
