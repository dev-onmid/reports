import type { NextRequest } from 'next/server';

const COLORS = ['#55F52F', '#38BDF8', '#A78BFA', '#F59E0B', '#FB7185', '#22C55E', '#F472B6', '#94A3B8'];
const COLOR_SET = new Set(COLORS);

type AINode = { id: string; title: string; note: string; color: string; parentId: string | null };

// ── Radial layout — positions nodes automatically ─────────────────────────────

function radialLayout(aiNodes: AINode[]) {
  const cx = 500, cy = 320;
  if (!aiNodes.length) return [];

  const root = aiNodes.find(n => !n.parentId) ?? { ...aiNodes[0], parentId: null };
  const childrenOf = new Map<string, AINode[]>();
  for (const n of aiNodes) {
    if (!n.parentId) continue;
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push(n);
  }

  const result: Array<AINode & { x: number; y: number; image: null }> = [];

  function place(node: AINode, x: number, y: number, a0: number, a1: number, r: number) {
    const isRoot = !node.parentId;
    result.push({ ...node, x: Math.round(x - (isRoot ? 96 : 88)), y: Math.round(y - 32), image: null });
    const children = childrenOf.get(node.id) ?? [];
    if (!children.length) return;
    const span = a1 - a0;
    children.forEach((child, i) => {
      const angle = a0 + span * (i + 0.5) / children.length;
      const childR = Math.max(160, r * 0.72);
      const childSpan = Math.max(Math.PI / 5, span / children.length);
      place(child, x + Math.cos(angle) * r, y + Math.sin(angle) * r, angle - childSpan / 2, angle + childSpan / 2, childR);
    });
  }

  place(root, cx, cy, -Math.PI, Math.PI, 265);
  return result;
}

// ── API ───────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    prompt?: string;
    imageBase64?: string;
    imageType?: string;
    clientName?: string;
  };

  const { prompt, imageBase64, imageType, clientName = 'Cliente' } = body;
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });
  if (!prompt && !imageBase64) return Response.json({ error: 'Envie texto ou imagem' }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [];

  if (imageBase64 && imageType) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } });
  }

  userContent.push({
    type: 'text',
    text: `Cliente: ${clientName}
${prompt ? `\nContexto / conteúdo:\n${prompt}` : '\nAnalise a imagem acima.'}

Crie um mapa mental estratégico de marketing e negócios para este cliente.

Retorne APENAS este JSON (sem markdown, sem explicações):
{
  "nodes": [
    { "id": "root", "title": "${clientName}", "note": "Perfil central", "color": "#55F52F", "parentId": null },
    { "id": "n1", "title": "Público-alvo", "note": "...", "color": "#38BDF8", "parentId": "root" }
  ]
}

Regras obrigatórias:
- Entre 10 e 18 nós
- 1 raiz (parentId null) com title = "${clientName}", color = "#55F52F"
- 4 a 6 ramos principais (nível 1) ligados à raiz
- Sub-tópicos onde fizer sentido estratégico
- IDs: "root", "n1"…"n6", "n1a", "n1b", etc. — todos únicos
- Cores disponíveis: ${COLORS.join(', ')}
- Alterne cores entre ramos do nível 1
- Títulos ≤ 28 chars, notas ≤ 55 chars
- Foco: estratégia de marketing, público, canais, produto/oferta, objetivos, métricas`,
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: 'Você é especialista em mapas mentais estratégicos de marketing. Retorne APENAS JSON válido, sem markdown.',
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `Erro na API: ${err.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json() as { content?: { type: string; text: string }[] };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ error: 'Resposta inválida — tente novamente' }, { status: 500 });

    const parsed = JSON.parse(match[0]) as { nodes?: unknown };
    if (!Array.isArray(parsed.nodes)) return Response.json({ error: 'Estrutura inválida' }, { status: 500 });

    const nodes: AINode[] = (parsed.nodes as Partial<AINode>[])
      .filter(n => n?.id && n?.title)
      .slice(0, 24)
      .map((n, i) => ({
        id: String(n.id!).slice(0, 40),
        title: String(n.title!).slice(0, 50),
        note: String(n.note ?? '').slice(0, 80),
        color: COLOR_SET.has(n.color ?? '') ? n.color! : COLORS[i % COLORS.length],
        parentId: n.parentId ? String(n.parentId) : null,
      }));

    if (!nodes.some(n => !n.parentId)) nodes[0] = { ...nodes[0], parentId: null };

    const laid = radialLayout(nodes);
    return Response.json({ nodes: laid, edges: [] });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
