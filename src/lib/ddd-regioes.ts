// Mapa estático DDD → UF/região. Usado para derivar a localização aproximada de
// qualquer lead brasileiro a partir do telefone (55 + DDD + número), sem depender
// de API externa. A "cidade" é a cidade-polo da área de cobertura do DDD, não a
// cidade exata do assinante — suficiente para análise de público por região.

export type DddRegiao = { uf: string; regiao: string };

const DDD_MAP: Record<string, DddRegiao> = {
  // São Paulo
  '11': { uf: 'SP', regiao: 'São Paulo' },
  '12': { uf: 'SP', regiao: 'São José dos Campos / Vale do Paraíba' },
  '13': { uf: 'SP', regiao: 'Santos / Baixada Santista' },
  '14': { uf: 'SP', regiao: 'Bauru / Marília' },
  '15': { uf: 'SP', regiao: 'Sorocaba' },
  '16': { uf: 'SP', regiao: 'Ribeirão Preto' },
  '17': { uf: 'SP', regiao: 'São José do Rio Preto' },
  '18': { uf: 'SP', regiao: 'Presidente Prudente / Araçatuba' },
  '19': { uf: 'SP', regiao: 'Campinas' },
  // Rio de Janeiro
  '21': { uf: 'RJ', regiao: 'Rio de Janeiro' },
  '22': { uf: 'RJ', regiao: 'Campos dos Goytacazes' },
  '24': { uf: 'RJ', regiao: 'Volta Redonda / Petrópolis' },
  // Espírito Santo
  '27': { uf: 'ES', regiao: 'Vitória' },
  '28': { uf: 'ES', regiao: 'Cachoeiro de Itapemirim' },
  // Minas Gerais
  '31': { uf: 'MG', regiao: 'Belo Horizonte' },
  '32': { uf: 'MG', regiao: 'Juiz de Fora' },
  '33': { uf: 'MG', regiao: 'Governador Valadares' },
  '34': { uf: 'MG', regiao: 'Uberlândia / Triângulo Mineiro' },
  '35': { uf: 'MG', regiao: 'Poços de Caldas / Varginha' },
  '37': { uf: 'MG', regiao: 'Divinópolis' },
  '38': { uf: 'MG', regiao: 'Montes Claros' },
  // Paraná
  '41': { uf: 'PR', regiao: 'Curitiba' },
  '42': { uf: 'PR', regiao: 'Ponta Grossa' },
  '43': { uf: 'PR', regiao: 'Londrina' },
  '44': { uf: 'PR', regiao: 'Maringá' },
  '45': { uf: 'PR', regiao: 'Foz do Iguaçu / Cascavel' },
  '46': { uf: 'PR', regiao: 'Francisco Beltrão / Pato Branco' },
  // Santa Catarina
  '47': { uf: 'SC', regiao: 'Joinville / Blumenau' },
  '48': { uf: 'SC', regiao: 'Florianópolis' },
  '49': { uf: 'SC', regiao: 'Chapecó / Lages' },
  // Rio Grande do Sul
  '51': { uf: 'RS', regiao: 'Porto Alegre' },
  '53': { uf: 'RS', regiao: 'Pelotas' },
  '54': { uf: 'RS', regiao: 'Caxias do Sul' },
  '55': { uf: 'RS', regiao: 'Santa Maria' },
  // Centro-Oeste
  '61': { uf: 'DF', regiao: 'Brasília' },
  '62': { uf: 'GO', regiao: 'Goiânia' },
  '64': { uf: 'GO', regiao: 'Rio Verde / Sudoeste Goiano' },
  '63': { uf: 'TO', regiao: 'Palmas' },
  '65': { uf: 'MT', regiao: 'Cuiabá' },
  '66': { uf: 'MT', regiao: 'Rondonópolis / Sinop' },
  '67': { uf: 'MS', regiao: 'Campo Grande' },
  // Norte
  '68': { uf: 'AC', regiao: 'Rio Branco' },
  '69': { uf: 'RO', regiao: 'Porto Velho' },
  '91': { uf: 'PA', regiao: 'Belém' },
  '93': { uf: 'PA', regiao: 'Santarém' },
  '94': { uf: 'PA', regiao: 'Marabá' },
  '92': { uf: 'AM', regiao: 'Manaus' },
  '97': { uf: 'AM', regiao: 'Interior do Amazonas' },
  '95': { uf: 'RR', regiao: 'Boa Vista' },
  '96': { uf: 'AP', regiao: 'Macapá' },
  // Nordeste
  '71': { uf: 'BA', regiao: 'Salvador' },
  '73': { uf: 'BA', regiao: 'Ilhéus / Itabuna' },
  '74': { uf: 'BA', regiao: 'Juazeiro' },
  '75': { uf: 'BA', regiao: 'Feira de Santana' },
  '77': { uf: 'BA', regiao: 'Vitória da Conquista / Barreiras' },
  '79': { uf: 'SE', regiao: 'Aracaju' },
  '81': { uf: 'PE', regiao: 'Recife' },
  '87': { uf: 'PE', regiao: 'Petrolina' },
  '82': { uf: 'AL', regiao: 'Maceió' },
  '83': { uf: 'PB', regiao: 'João Pessoa' },
  '84': { uf: 'RN', regiao: 'Natal' },
  '85': { uf: 'CE', regiao: 'Fortaleza' },
  '88': { uf: 'CE', regiao: 'Juazeiro do Norte / Sobral' },
  '86': { uf: 'PI', regiao: 'Teresina' },
  '89': { uf: 'PI', regiao: 'Picos / Floriano' },
  '98': { uf: 'MA', regiao: 'São Luís' },
  '99': { uf: 'MA', regiao: 'Imperatriz' },
};

/**
 * Deriva DDD + UF + região a partir de um telefone em dígitos.
 * Aceita formatos com ou sem o DDI 55 (ex: "5543999998888" ou "43999998888").
 * Retorna null para números estrangeiros ou irreconhecíveis.
 */
export function regiaoFromPhone(rawPhone: string | null | undefined): (DddRegiao & { ddd: string }) | null {
  const digits = String(rawPhone ?? '').replace(/\D/g, '');
  if (!digits) return null;

  let rest = digits;
  if (digits.startsWith('55') && digits.length >= 12) {
    rest = digits.slice(2);
  } else if (digits.length > 11) {
    // DDI diferente de 55 → estrangeiro, não dá pra derivar
    return null;
  }
  // rest deve ser DDD (2) + número (8-9)
  if (rest.length < 10 || rest.length > 11) return null;
  const ddd = rest.slice(0, 2);
  const info = DDD_MAP[ddd];
  return info ? { ddd, ...info } : null;
}
