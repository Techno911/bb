// Services people work in under their own account. A link to one of them is
// useless signed out: the document opens on a login form instead of its
// content. The desktop shell carries the user's session into the in-app
// browser for exactly these hosts, so the list lives here, next to the
// contract both sides read, instead of being copied on each side.
export const SIGNED_IN_SERVICE_HOSTS = [
  "google.com",
  "googleusercontent.com",
  "notion.so",
  "figma.com",
  "miro.com",
  "fireflies.ai",
] as const;

// Google keeps the account session on the country domain the person is sent
// to, not only on google.com: signing in from Russia leaves SID and SAPISID on
// google.ru while google.com holds only preferences. Matching one spelling
// would carry over everything except the sign-in itself.
const GOOGLE_COUNTRY_DOMAIN = /^(?:.+\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/u;

export function isSignedInServiceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (GOOGLE_COUNTRY_DOMAIN.test(host)) {
    return true;
  }
  return SIGNED_IN_SERVICE_HOSTS.some(
    (service) => host === service || host.endsWith(`.${service}`),
  );
}

export function signedInServiceHostFor(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return isSignedInServiceHost(hostname) ? hostname : null;
}
