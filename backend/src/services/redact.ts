// Addresses as they may be logged: the secret part of public links, signed links and query strings is replaced.
// Public links put their secret after the route name (/api/public/careers/applications/<token>, /api/public/task/<token>…).
const SECRET_PATHS: [RegExp, string][] = [
  [/^(\/api\/public\/careers\/(?:applications|interview))\/[^/?]+/, '$1/…'],
  [/^(\/api\/public\/(?:task|seo|ads))\/[^/?]+/, '$1/…'],
  [/^(\/api\/recruitment\/media\/[^?]+)\?.*/, '$1?…'],
  [/^(\/(?:careers\/(?:track|interview)|share\/[^/]+|reset-password))\/[^/?]+/, '$1/…'],
];
export function redactUrl(url: string): string {
  let out = String(url ?? '');
  for (const [re, to] of SECRET_PATHS) out = out.replace(re, to);
  // Any query string can hold a token, an OTP or a signature: only its parameter names are kept
  return out.replace(/\?(.*)$/, (m, q: string) => (q === '…' ? m : `?${q.split('&').map((kv) => `${kv.split('=')[0]}=…`).join('&')}`));
}
