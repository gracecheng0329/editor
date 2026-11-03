export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  // Next normalizes request.url's hostname; retain the incoming browser authority.
  return `${url.protocol}//${request.headers.get('host') ?? url.host}`;
}

export function validOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
