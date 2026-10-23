"use client";

import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("rounded-full w-10 h-10 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors", className)}
      onClick={() => {
        const novo = theme === "dark" ? "light" : "dark";
        setTheme(novo);
        // Guarda na conta: a escolha vale em qualquer navegador (2026-10-22).
        // Best-effort: se a rota falhar, o localStorage já segurou esta sessão.
        void fetch("/api/auth/tema", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tema: novo }) }).catch(() => {});
      }}
      title={`Mudar para modo ${theme === "dark" ? "claro" : "escuro"}`}
    >
      {theme === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">Alternar tema</span>
    </Button>
  );
}
