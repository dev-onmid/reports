function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function injectTracking(
  html: string,
  id: string,
  type: 'campaign' | 'flow' = 'campaign',
): string {
  const base = getBaseUrl();
  const param = type === 'flow' ? `fcid=${id}` : `rid=${id}`;

  const withClicks = html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url: string) => `href="${base}/api/email/track/click?${param}&url=${encodeURIComponent(url)}"`,
  );

  const pixel = `<img src="${base}/api/email/track/open?${param}" `
    + `width="1" height="1" style="display:none;border:0;outline:0;width:1px;height:1px" alt="" />`;

  if (withClicks.includes('</body>')) {
    return withClicks.replace('</body>', `${pixel}</body>`);
  }
  return withClicks + pixel;
}
