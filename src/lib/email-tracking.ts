function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function injectTracking(html: string, recipientId: string): string {
  const base = getBaseUrl();

  // Replace href links (http/https) with click-tracking redirect
  const withClicks = html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_, url: string) => `href="${base}/api/email/track/click?rid=${recipientId}&url=${encodeURIComponent(url)}"`,
  );

  // 1×1 tracking pixel
  const pixel = `<img src="${base}/api/email/track/open?rid=${recipientId}" `
    + `width="1" height="1" style="display:none;border:0;outline:0;width:1px;height:1px" alt="" />`;

  if (withClicks.includes('</body>')) {
    return withClicks.replace('</body>', `${pixel}</body>`);
  }
  return withClicks + pixel;
}
