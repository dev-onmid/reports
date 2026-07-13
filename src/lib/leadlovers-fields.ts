// Normalização de campos de contato — planilhas reais vêm com cabeçalhos em
// qualquer caixa/variação ("Nome", "E-mail", "Celular", "Empresa"…). Sem isso o
// import só lia as chaves minúsculas exatas e jogava tudo em extra_data, deixando
// as colunas nome/email/telefone/empresa nulas (contatos apareciam como "—").
// Puro (sem imports de servidor) pra poder ser usado no client e no server.

const NAME_KEYS    = ['nome', 'name', 'contato', 'cliente', 'nome completo', 'nome do contato', 'lead'];
const EMAIL_KEYS   = ['email', 'e-mail', 'e mail', 'e_mail', 'mail'];
const PHONE_KEYS   = ['telefone', 'phone', 'celular', 'whatsapp', 'whats', 'fone', 'tel', 'numero', 'número', 'telefone/whatsapp'];
const COMPANY_KEYS = ['empresa', 'company', 'negocio', 'negócio', 'organizacao', 'organização', 'organizaçao'];

const FIELD_KEYS: Record<'nome' | 'email' | 'telefone' | 'empresa', string[]> = {
  nome: NAME_KEYS, email: EMAIL_KEYS, telefone: PHONE_KEYS, empresa: COMPANY_KEYS,
};

function clean(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Separa uma linha crua da planilha em nome/email/telefone/empresa + o resto (extra_data). */
export function normalizeContact(row: Record<string, unknown>): {
  nome: string | null; email: string | null; telefone: string | null; empresa: string | null;
  extra: Record<string, unknown>;
} {
  let nome: string | null = null, email: string | null = null, telefone: string | null = null, empresa: string | null = null;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.trim().toLowerCase();
    const val = clean(v);
    if (nome == null && NAME_KEYS.includes(key)) nome = val || null;
    else if (email == null && EMAIL_KEYS.includes(key)) email = val || null;
    else if (telefone == null && PHONE_KEYS.includes(key)) telefone = val || null;
    else if (empresa == null && COMPANY_KEYS.includes(key)) empresa = val || null;
    else extra[k] = v;
  }
  return { nome, email, telefone, empresa, extra };
}

type ContactLike = {
  nome?: unknown; email?: unknown; telefone?: unknown; empresa?: unknown;
  extra_data?: unknown; [key: string]: unknown;
};

/**
 * Valor efetivo de um campo: usa a coluna se preenchida, senão cai pra extra_data
 * (variações de cabeçalho) — repara na exibição/envio os contatos antigos que foram
 * importados antes da normalização, sem precisar re-upload.
 */
export function effectiveField(contact: ContactLike, field: 'nome' | 'email' | 'telefone' | 'empresa'): string {
  const direct = clean(contact[field]);
  if (direct) return direct;
  const extra = contact.extra_data;
  if (extra && typeof extra === 'object') {
    const keys = FIELD_KEYS[field];
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
      if (keys.includes(k.trim().toLowerCase())) {
        const val = clean(v);
        if (val) return val;
      }
    }
  }
  return '';
}
