export interface DbSchnittstelle {
  /** T beschreibt die Zeile. Ohne Angabe ist sie `unknown`: Wer Felder liest,
   * muss sagen, welche — numeric und bigint kommen als Zeichenkette. */
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}
