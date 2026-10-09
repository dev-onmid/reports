import type { MetadataRoute } from 'next';

/**
 * Permite "Adicionar à tela inicial" no celular — o CRM passa a ser usado pela
 * recepção dos clientes, muitas vezes só pelo telefone. Abre no login, que
 * manda cada um para o seu lugar (funcionário do cliente vai direto ao CRM).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Onmid CRM',
    short_name: 'Onmid',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0f14',
    theme_color: '#0e0f14',
    icons: [{ src: '/brand/onmid-favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
