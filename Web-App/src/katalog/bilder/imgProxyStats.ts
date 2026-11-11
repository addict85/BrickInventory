// Eigenes Modul, damit Proxy und Vorschau zählen, ohne über global zu greifen.
export const imgProxyFailures = {
  timeout: 0,
  error: 0,
  notFound: 0,
  other: 0,
  lastError: null as string | null,
};
