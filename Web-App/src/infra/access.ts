/** Was die Bereiche vom Datenbankzugang brauchen, als Schnittstelle der untersten Stufe:
 * db/database.ts erfüllt sie (Db), src/infra/area.ts baut darauf, ohne an db/ zu hängen. */

/** Eine Bestandssperre: Konto (immer der Besitzer) und Schlüssel (inventoryKey). */
export interface Bestandssperre {
  konto: number;
  schluessel: string | number;
}

export interface TxOptions {
  /** Bei Deadlock (40P01) oder Serialisierungsfehler (40001) die ganze Transaktion bis zu
   * zweimal neu beginnen. Nur für Rümpfe ohne Wirkung nach aussen: Sie laufen dann mehrfach. */
  repeatAtConflict?: boolean;
  /** Vor dem Rumpf genommen (db/txLock.ts); sie halten bis zum Ende der äussersten Transaktion. */
  sperren?: readonly Bestandssperre[];
}

/** `D` ist der Zugang selbst: Der Rumpf einer Transaktion bekommt einen gleichartigen (`tx.db`). */
export interface Zugang<D> {
  transaction<T>(fn: (tx: { readonly db: D }) => Promise<T>, o?: TxOptions): Promise<T>;
  /** Ob dieser Zugang an einer Transaktion hängt oder dieser Aufrufpfad eine offen hält. */
  inTransaction(): boolean;
}
