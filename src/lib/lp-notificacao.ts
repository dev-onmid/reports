/**
 * Aviso por e-mail a cada lead que chega de site/landing page.
 *
 * Existe porque o lead já chegava ao CRM mas ninguém na loja ficava sabendo na
 * hora — quem atende não vive com o painel aberto, e lead de formulário esfria
 * em minutos. O destinatário fica na ORIGEM (`lp_origens.notificar_emails`),
 * então cada site avisa quem cuida dele.
 *
 * Quem entrega é `email-envio` (SMTP próprio, com o Gmail de reserva) — este
 * arquivo decide O QUE dizer, não POR ONDE sair.
 *
 * ⚠️ É BEST-EFFORT por construção: qualquer falha aqui (remetente fora do ar,
 * senha recusada, endereço inválido) é registrada e engolida. O lead já está
 * gravado quando esta função roda — derrubar a resposta da LP por causa de um
 * e-mail faria a pessoa ver "erro" num cadastro que funcionou.
 */

import type { Pool } from 'pg';
import { enviarEmail } from '@/lib/email-envio';

export type LeadParaAviso = {
  leadId: string;
  clientId: string;
  site: string;              // nome da origem — a LP que capturou
  criado: boolean;           // false = a pessoa já era lead e voltou
  nome?: string | null;
  telefone?: string | null;
  email?: string | null;
  cidade?: string | null;
  estado?: string | null;
  campanha?: string | null;
  anuncio?: string | null;
  origemAnuncio?: string | null;   // google | meta | organic…
  pageUrl?: string | null;
  baseUrl: string;           // origem canônica, para o link do CRM
};

/** Conteúdo vem de formulário público: escapar é obrigatório, não zelo extra. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const soDigitos = (t: string) => t.replace(/\D/g, '');

/** Linhas do corpo: só entra o que veio preenchido — campo vazio é ruído. */
function linhas(lead: LeadParaAviso): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (lead.nome) out.push(['Nome', lead.nome]);
  if (lead.telefone) out.push(['Telefone', lead.telefone]);
  if (lead.email) out.push(['E-mail', lead.email]);
  const local = [lead.cidade, lead.estado].filter(Boolean).join(' · ');
  if (local) out.push(['Cidade', local]);
  if (lead.campanha) out.push(['Campanha', lead.campanha]);
  if (lead.anuncio) out.push(['Anúncio', lead.anuncio]);
  if (lead.origemAnuncio) out.push(['Veio de', lead.origemAnuncio]);
  return out;
}

export function montarAvisoLead(lead: LeadParaAviso): { subject: string; html: string; text: string } {
  const quem = lead.nome || lead.telefone || lead.email || 'Contato sem nome';
  const subject = lead.criado
    ? `Novo lead: ${quem} — ${lead.site}`
    : `Lead voltou a se cadastrar: ${quem} — ${lead.site}`;

  const dados = linhas(lead);
  const linkCrm = `${lead.baseUrl}/crm?clientId=${encodeURIComponent(lead.clientId)}&lead=${encodeURIComponent(lead.leadId)}`;
  const zap = lead.telefone ? soDigitos(lead.telefone) : '';
  const whats = zap.length >= 10 ? `https://wa.me/${zap.length <= 11 ? '55' + zap : zap}` : null;

  const quando = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden">
    <div style="background:#18181b;padding:16px 20px">
      <p style="margin:0;color:#55f52f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${esc(lead.site)}</p>
      <p style="margin:4px 0 0;color:#fff;font-size:18px;font-weight:700">${esc(lead.criado ? 'Novo lead' : 'Lead voltou a se cadastrar')}</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      ${dados.map(([r, v]) => `<tr>
        <td style="padding:10px 20px;border-bottom:1px solid #f4f4f5;font-size:13px;color:#71717a;width:110px;vertical-align:top">${esc(r)}</td>
        <td style="padding:10px 20px;border-bottom:1px solid #f4f4f5;font-size:14px;font-weight:600">${esc(v)}</td>
      </tr>`).join('')}
      <tr>
        <td style="padding:10px 20px;font-size:13px;color:#71717a">Recebido</td>
        <td style="padding:10px 20px;font-size:14px">${esc(quando)}</td>
      </tr>
    </table>
    <div style="padding:16px 20px 20px">
      ${whats ? `<a href="${esc(whats)}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px;margin-right:8px">Chamar no WhatsApp</a>` : ''}
      <a href="${esc(linkCrm)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px">Ver no CRM</a>
    </div>
  </div>
  <p style="max-width:560px;margin:12px auto 0;font-size:11px;color:#a1a1aa;text-align:center">
    Aviso automático do ONMID Reports${lead.pageUrl ? ` · ${esc(lead.pageUrl)}` : ''}
  </p>
</body></html>`;

  const text = [
    lead.criado ? 'Novo lead' : 'Lead voltou a se cadastrar',
    `Site: ${lead.site}`,
    ...dados.map(([r, v]) => `${r}: ${v}`),
    `Recebido: ${quando}`,
    whats ? `WhatsApp: ${whats}` : '',
    `CRM: ${linkCrm}`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}

/**
 * Envia o aviso para cada destinatário da origem. Uma mensagem por pessoa (o
 * Gmail manda para um `to` por vez) e em paralelo — um endereço recusado não
 * pode impedir os outros de receber.
 */
export async function notificarLeadPorEmail(
  pool: Pool, destinatarios: string[], lead: LeadParaAviso,
): Promise<{ enviados: number; falhas: number }> {
  if (!destinatarios.length) return { enviados: 0, falhas: 0 };

  const msg = montarAvisoLead(lead);
  // Responder o aviso fala com a pessoa, não com a agência.
  const replyTo = lead.email ?? undefined;

  const saida = await Promise.allSettled(destinatarios.map(to =>
    enviarEmail(pool, { to, subject: msg.subject, html: msg.html, text: msg.text, replyTo }),
  ));

  let enviados = 0;
  saida.forEach((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.ok;
    if (ok) enviados++;
    else {
      const motivo = r.status === 'fulfilled' ? `${r.value.via}: ${r.value.erro}` : String(r.reason);
      console.error(`[lp] aviso por e-mail falhou para ${destinatarios[i]}:`, motivo);
    }
  });
  return { enviados, falhas: destinatarios.length - enviados };
}
