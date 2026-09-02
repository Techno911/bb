import { useAtom } from "jotai";
import { createBooleanPreferenceAtom } from "./browser-storage";

const OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY = "bb.openLinksInAppBrowser";

const OPEN_LINKS_IN_APP_BROWSER_DEFAULT = true;

type UrlOpenTarget = "in-app-browser" | "external-browser" | "unhandled";

interface ResolveUrlOpenTargetArgs {
  desktopBrowserAvailable: boolean;
  openLinksInAppBrowser: boolean;
  url: string;
}

interface OpenUrlByPreferenceArgs extends ResolveUrlOpenTargetArgs {
  openExternalBrowser: (url: string) => void;
  openInAppBrowser: (url: string) => void;
}

const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;

export function isHttpOrHttpsUrl(url: string): boolean {
  return HTTP_URL_SCHEME_PATTERN.test(url);
}

// Services people work in under their own account. The in-app browser keeps its
// own Electron session, so such a link opens signed out there and cannot be
// edited; the default browser already carries the signed-in session. Add a host
// here when a service is only usable while signed in.
const SIGNED_IN_SERVICE_HOSTS = [
  "google.com",
  "googleusercontent.com",
  "notion.so",
  "figma.com",
  "miro.com",
  "fireflies.ai",
];

export function requiresSignedInBrowser(url: string): boolean {
  if (!isHttpOrHttpsUrl(url)) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return SIGNED_IN_SERVICE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`),
  );
}

export function resolveUrlOpenTarget({
  desktopBrowserAvailable,
  openLinksInAppBrowser,
  url,
}: ResolveUrlOpenTargetArgs): UrlOpenTarget {
  if (!isHttpOrHttpsUrl(url)) {
    return "unhandled";
  }
  if (requiresSignedInBrowser(url)) {
    return "external-browser";
  }
  if (desktopBrowserAvailable && openLinksInAppBrowser) {
    return "in-app-browser";
  }
  return "external-browser";
}

export function openUrlByPreference({
  desktopBrowserAvailable,
  openExternalBrowser,
  openInAppBrowser,
  openLinksInAppBrowser,
  url,
}: OpenUrlByPreferenceArgs): boolean {
  const target = resolveUrlOpenTarget({
    desktopBrowserAvailable,
    openLinksInAppBrowser,
    url,
  });

  switch (target) {
    case "in-app-browser":
      openInAppBrowser(url);
      return true;
    case "external-browser":
      openExternalBrowser(url);
      return true;
    case "unhandled":
      return false;
  }
}

const openLinksInAppBrowserPreferenceAtom = createBooleanPreferenceAtom(
  OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
  OPEN_LINKS_IN_APP_BROWSER_DEFAULT,
);

export function useOpenLinksInAppBrowserPreference() {
  return useAtom(openLinksInAppBrowserPreferenceAtom);
}
