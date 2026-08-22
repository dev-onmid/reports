"use client";

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles } from 'lucide-react';
import { authenticateUser } from '@/lib/auth-store';

/**
 * Só caminho interno vira destino pós-login — "//evil.com" e "/\evil.com" são
 * lidos como URL absoluta pelo navegador e virariam redirecionamento aberto.
 */
function destinoSeguro(valor: string | null): string {
  if (!valor || !valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) return '/inicio';
  return valor;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expirado, setExpirado] = useState(false);
  const [destino, setDestino] = useState('/inicio');

  // auditoria 2026-08-22: lido do window (e não de useSearchParams) pra não
  // exigir Suspense nesta página, que é a raiz do app.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExpirado(params.get('expirado') === '1');
    setDestino(destinoSeguro(params.get('next')));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');
    const resultado = await authenticateUser(email, password);
    setLoading(false);

    if (!resultado.ok) {
      setExpirado(false);
      setError(
        resultado.motivo === 'servidor'
          ? 'Não foi possível conectar ao servidor. Tente de novo.'
          : 'E-mail ou senha inválidos, ou usuário inativo.',
      );
      return;
    }

    // Volta pra tela em que a sessão expirou, não pro início fixo.
    router.push(destino);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden font-sans">
      {/* Gradients and glow as per brand manual */}
      <div className="absolute top-1/3 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] opacity-70 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[600px] h-[600px] bg-secondary/20 rounded-full blur-[150px] opacity-60 pointer-events-none" />
      
      {/* Subtle grid pattern for digital feel */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=')] opacity-50" />

      <div className="w-full max-w-md bg-card/80 backdrop-blur-2xl border border-primary/30 rounded-2xl p-10 shadow-[0_0_40px_rgba(85,245,47,0.05)] relative z-10">
        <div className="flex flex-col items-center mb-10">
          <img
            src="/brand/onmid-logo-white.png"
            alt="Onmid"
            className="mb-6 h-14 w-auto max-w-[260px] object-contain"
          />
          <h1 className="text-3xl font-heading font-normal tracking-wider text-foreground uppercase">Acesso Restrito</h1>
          <p className="text-sm text-muted-foreground mt-2 font-medium">Plataforma de Relatórios Estratégicos</p>
        </div>

        {expirado && (
          <div className="mb-5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            Sua sessão expirou — entre de novo.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground/80 uppercase text-xs tracking-wider">E-mail corporativo</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nome@onmid.com.br"
              className="bg-background border-border/50 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary h-12"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password" className="text-foreground/80 uppercase text-xs tracking-wider">Senha</Label>
              {/* Não existe fluxo de recuperação — o link ia pra "#" e não fazia nada. */}
              <span className="text-xs text-muted-foreground">Esqueceu a senha? Fale com um administrador.</span>
            </div>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="bg-background border-border/50 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary h-12"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          
          <Button
            type="submit"
            disabled={loading || !email.trim() || !password.trim()}
            className="w-full h-12 mt-8 bg-primary text-primary-foreground hover:bg-primary/90 font-bold uppercase tracking-wider shadow-[0_0_15px_rgba(85,245,47,0.3)] hover:shadow-[0_0_25px_rgba(85,245,47,0.5)] transition-all rounded-lg border-none"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>

      <div className="absolute bottom-8 left-8 flex items-center gap-3 text-xs font-medium text-muted-foreground z-10">
        <div className="w-8 h-8 rounded border border-border flex items-center justify-center bg-card">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-foreground uppercase tracking-widest font-bold">Estratégico por dentro.</p>
          <p className="text-primary uppercase tracking-widest font-bold">Criativo por natureza.</p>
        </div>
      </div>
    </div>
  );
}
