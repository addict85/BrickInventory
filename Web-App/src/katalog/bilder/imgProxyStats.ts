/**
 * Fehlerzähler des Bild-Proxys.
 * Ausführlich: docs/begruendungen/src/katalog/bilder/imgProxyStats.ts.md#imgproxyfailures
 */
export const imgProxyFailures = {
  timeout: 0,
  error: 0,
  notFound: 0,
  other: 0,
  lastError: null as string | null,
};
