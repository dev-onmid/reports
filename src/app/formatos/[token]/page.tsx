'use client';

// ── Link público da biblioteca "Formatos de Criativos" ───────────────────────
// Página PÚBLICA por token, fora do painel (sem menu, sem login, sem caminho
// para o resto do sistema). Mostra só o que o token cobre — a biblioteca inteira
// ou um formato — lendo /api/formatos-publico/[token]/* (ver
// src/lib/formatos-compartilhamento.ts). Quem recebe pode assistir, baixar o
// vídeo e copiar o briefing para a IA; não há nenhuma ação de escrita.

import { use, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BibliotecaFormatos, type ApiFormatos, type Formato } from '@/components/formatos-criativos/biblioteca';

export default function FormatosPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'invalido' | 'erro'>('carregando');
  const [formatos, setFormatos] = useState<Formato[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/formatos-publico/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!vivo) return;
        if (r.status === 404) return setEstado('invalido');
        if (!r.ok) return setEstado('erro');
        const d = (await r.json()) as { formatos: Formato[] };
        setFormatos(d.formatos);
        setEstado('ok');
      })
      .catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, [token]);

  const api = useMemo<ApiFormatos>(() => {
    const base = `/api/formatos-publico/${encodeURIComponent(token)}`;
    return {
      midia: (a) => `${base}/midia?f=${encodeURIComponent(a)}`,
      fichas: (n) => `${base}/fichas?numero=${n}`,
    };
  }, [token]);

  const unico = formatos.length === 1 ? formatos[0] : null;

  return (
    <div className="min-h-screen bg-[#0e0f14] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/onmid-logo-white.png" alt="ONMID" className="h-6 w-auto" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Biblioteca de formatos</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {estado === 'carregando' && (
          <p className="flex items-center gap-2 py-24 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        )}
        {estado === 'invalido' && (
          <div className="py-24 text-center">
            <h1 className="font-heading text-3xl uppercase tracking-wide">Link indisponível</h1>
            <p className="mt-2 text-sm text-white/60">Este link não existe ou foi desativado. Peça um novo a quem te enviou.</p>
          </div>
        )}
        {estado === 'erro' && (
          <p className="py-24 text-center text-sm text-red-400">Não foi possível carregar agora. Tente de novo em instantes.</p>
        )}
        {estado === 'ok' && (
          <BibliotecaFormatos
            formatos={formatos}
            api={api}
            titulo={unico ? `${String(unico.numero).padStart(2, '0')} · ${unico.titulo}` : 'Formatos de Criativos'}
            subtitulo={unico ? 'Clique no formato para ver os exemplos, a estrutura e copiar o briefing.' : undefined}
            abrirInicial={unico ? unico.numero : null}
          />
        )}
      </main>
    </div>
  );
}
