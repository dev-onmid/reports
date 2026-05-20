export type CriativoItem = {
  nome: string;
  investimento: string;
  resultados: number;
  custo_resultado: string;
  bar_pct: number; // 0-100
};

export type OrigemItem = {
  canal: string;
  registros: number;
  faturamento: string;
  faturamento_num: number;
  bar_pct: number; // 0-100
};

export type ClienteItem = {
  nome: string;
  origem: string;
  registros: number;
  valor_total: string;
  valor_num: number;
};

export type DiagnosticoData = {
  // Config
  cliente: string;
  periodo: string;           // "01/05/2026 a 31/05/2026"
  subtitulo: string;         // "Relatório de mídia paga + base interna de faturamento"

  // Capa KPIs
  capa: {
    faturamento: string;
    faturamento_var?: string;
    investimento: string;
    investimento_var?: string;
    roas: string;
    roas_var?: string;
    leads: string;
    leads_var?: string;
  };

  // Visão geral Meta Ads
  meta: {
    investimento_total: string;
    resultados: number;
    custo_resultado: string;
    impressoes: string;
    alcance: string;
    total_contatos: number;
    novos_contatos: number;
    custo_novo_contato: string;
    compras: number;
    leitura: string;

    facebook: {
      investimento: string;
      resultados: number;
      custo_resultado: string;
      novos_contatos: number;
      custo_novo_contato: string;
    };
    instagram: {
      investimento: string;
      resultados: number;
      custo_resultado: string;
      novos_contatos: number;
      custo_novo_contato: string;
    };
    leitura_plataformas: string;

    criativos: CriativoItem[];
    leitura_criativos: string;
  };

  // CRM / base interna
  crm: {
    registros: number;
    pacientes_unicos: number;
    faturamento_total: string;
    ticket_medio_registro: string;
    ticket_medio_paciente: string;
    relacao_fat_investimento: string;
    leitura_faturamento: string;

    por_origem: OrigemItem[];
    leitura_origem: string;

    clientes: ClienteItem[];
  };

  // Diagnóstico e conclusão (Claude)
  diagnostico: {
    texto: string;
    cenario_periodo: string;
    o_que_indica: string;
    proximo_passo: string;
  };
};
