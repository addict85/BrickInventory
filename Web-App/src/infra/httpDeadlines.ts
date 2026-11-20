/** The HTTP server's deadlines in one place: idempotency derives from them
 * when a first request counts as aborted (src/idempotency/service.ts).
 * Five minutes for 50 MB uploads; without a short check interval the header deadline would only apply after 45 s. */
export const HTTP_DEADLINES = {
  headersTimeout: 15_000,
  requestTimeout: 300_000,
  connectionsCheckingInterval: 1_000,
} as const;
