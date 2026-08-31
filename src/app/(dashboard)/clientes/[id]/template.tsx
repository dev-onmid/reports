/**
 * Existe só para dar uma KEY por cliente a esta rota.
 *
 * O seletor de cliente do cabeçalho (`ClientSwitcher`) navega de
 * /clientes/A para /clientes/B sem sair do App Router. Sem um template, os
 * Client Components do segmento não resetam nessa troca (layouts persistem;
 * quem recebe key única é o template — ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/template.md`),
 * e o estado preso ao cliente anterior — planejamento (tkm/CPL), blocos do
 * dashboard, categoria, aba — vazaria para o cliente novo. Pior: esses valores
 * são gravados por efeito, então o vazamento não ficaria só na tela.
 */
export default function ClienteTemplate({ children }: { children: React.ReactNode }) {
  return children;
}
