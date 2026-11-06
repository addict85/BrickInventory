/** Die Fristen des HTTP-Servers an einer Stelle: Die Idempotenz leitet daraus ab,
 * wann eine erste Anfrage als abgebrochen gilt (src/idempotenz/dienst.ts).
 * Fünf Minuten für 50-MB-Uploads; ohne kurzes Prüfintervall griffe die Kopffrist erst nach 45 s. */
export const HTTP_FRISTEN = { headersTimeout: 15_000, requestTimeout: 300_000, connectionsCheckingInterval: 1_000 } as const;
