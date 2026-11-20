export interface DbInterface {
  /** T describes the row. Without it, it is `unknown`: whoever reads fields
   * must say which — numeric and bigint come as strings. */
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

/** A row whose fields nobody reads: `SELECT 1 …` as a probe whether it exists. */
export type Treffer = Record<string, unknown>;
