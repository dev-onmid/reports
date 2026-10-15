// Monta o briefing em Markdown de um formato de criativo para colar numa IA
// (Maya, ChatGPT, Claude…) e pedir roteiros personalizados para um cliente.
// Pura e client-safe: a tela chama na hora de copiar/baixar.

export type EtapaExemplo = { de: number; ate: number; etapa: string; o_que_acontece: string };
export type FichaExemplo = {
  resumo: string;
  nicho_do_exemplo: string;
  duracao_seg?: number;
  gancho: { tempo: string; fala: string; visual: string; texto_na_tela: string | null; por_que_prende: string };
  estrutura: EtapaExemplo[];
  gravacao: Record<string, string>;
  cta: { fala: string; como_aparece: string };
  roteiro_modelo: string;
  dicas: string[];
  erros_comuns: string[];
  ideias_de_adaptacao: { nicho: string; ideia: string }[];
  transcricao?: { t: number; texto: string }[];
};
export type Arquetipo = {
  essencia: string;
  quando_usar: string[];
  quando_evitar: string[];
  estrutura_padrao: { etapa: string; duracao: string; o_que_fazer: string }[];
  ganchos_modelo: string[];
  como_gravar: Record<string, string>;
  roteiro_modelo: string;
  dicas: string[];
  erros_comuns: string[];
  variacoes: string[];
};

export const ROTULOS_GRAVACAO: Record<string, string> = {
  pessoas: 'Pessoas',
  enquadramento: 'Enquadramento',
  cenario: 'Cenário',
  camera: 'Câmera',
  figurino_objetos: 'Figurino e objetos',
  edicao: 'Edição',
  texto_na_tela: 'Texto na tela',
  audio: 'Áudio',
  duracao_ideal: 'Duração ideal',
};

const lista = (xs: string[] | undefined) => (xs ?? []).map((x) => `- ${x}`).join('\n');
const campos = (o: Record<string, string> | undefined) =>
  Object.entries(o ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `- **${ROTULOS_GRAVACAO[k] ?? k}:** ${v}`)
    .join('\n');

export function montarBriefing(opts: {
  numero: number;
  titulo: string;
  descricao: string;
  arquetipo: Arquetipo | null;
  exemplo: FichaExemplo | null;
  exemploIndice: number;
  cliente: string;
}): string {
  const { numero, titulo, descricao, arquetipo: a, exemplo: e, exemploIndice, cliente } = opts;
  const p: string[] = [];

  p.push(`# Briefing de criativo: formato "${titulo}" (nº ${String(numero).padStart(2, '0')})`);
  p.push(
    `Você é roteirista de anúncios em vídeo para Meta Ads (Reels e Stories, 9:16). Use o formato descrito abaixo como molde e crie roteiros para o cliente indicado. Mantenha a ESTRUTURA e o mecanismo do formato; troque o assunto, a linguagem e a oferta para o cliente e o público dele.\n\n` +
      `Entregue 3 roteiros diferentes. Para cada um: gancho (0 a 3 s, fala + o que aparece na tela), cenas numeradas com tempo aproximado, fala exata, texto na tela, orientação de gravação (quem aparece, onde, enquadramento) e CTA. Português do Brasil, linguagem natural de quem fala no celular. Não use travessão. Não prometa resultado garantido nem use números que o cliente não confirmou.`,
  );

  p.push(`## Cliente\n${cliente.trim() || '[DESCREVA O CLIENTE: nome, segmento, cidade, público ideal, oferta/produto, diferenciais, objetivo da campanha (mensagem no WhatsApp, formulário, venda) e restrições (o que não pode falar)]'}`);

  p.push(`## O formato\n${descricao}`);
  if (a) {
    p.push(`**Essência:** ${a.essencia}`);
    p.push(`### Quando usar\n${lista(a.quando_usar)}\n\n### Quando evitar\n${lista(a.quando_evitar)}`);
    p.push(`### Estrutura padrão\n${a.estrutura_padrao.map((s, i) => `${i + 1}. **${s.etapa}** (${s.duracao}): ${s.o_que_fazer}`).join('\n')}`);
    p.push(`### Ganchos modelo\n${lista(a.ganchos_modelo)}`);
    p.push(`### Como gravar\n${campos(a.como_gravar)}`);
    p.push(`### Roteiro modelo (com lacunas)\n${a.roteiro_modelo}`);
    p.push(`### Dicas\n${lista(a.dicas)}\n\n### Erros comuns\n${lista(a.erros_comuns)}`);
    if (a.variacoes?.length) p.push(`### Variações possíveis\n${lista(a.variacoes)}`);
  }

  if (e) {
    p.push(`## Exemplo de referência (exemplo ${exemploIndice + 1}, nicho: ${e.nicho_do_exemplo})\n${e.resumo}`);
    p.push(
      `### Gancho (${e.gancho.tempo})\n- **Fala:** ${e.gancho.fala}\n- **Visual:** ${e.gancho.visual}` +
        (e.gancho.texto_na_tela ? `\n- **Texto na tela:** ${e.gancho.texto_na_tela}` : '') +
        `\n- **Por que prende:** ${e.gancho.por_que_prende}`,
    );
    p.push(`### Estrutura\n${e.estrutura.map((s, i) => `- **${s.ate > 0 ? `${s.de}s a ${s.ate}s` : `${i + 1}º`} · ${s.etapa}:** ${s.o_que_acontece}`).join('\n')}`);
    p.push(`### Como foi gravado\n${campos(e.gravacao)}`);
    p.push(`### CTA\n- **Fala:** ${e.cta.fala}\n- **Como aparece:** ${e.cta.como_aparece}`);
    p.push(`### Roteiro modelo deste exemplo\n${e.roteiro_modelo}`);
    if (e.transcricao?.length) {
      p.push(`### Transcrição do exemplo\n${e.transcricao.map((s) => `[${s.t}s] ${s.texto}`).join('\n')}`);
    }
  }

  return p.join('\n\n') + '\n';
}
