/** Eine Kontobedingung ist nur ein Platzhalter: Ein Wert im SQL-Text wäre eine Einschleusung,
 * die kein Treiber mehr abfängt. Der Typ lässt nur diese Formen zu; die Prüfung hält auch dort,
 * wo ein Wert ohne Typ ankommt. */
export type Konten = `= $${number}` | `= ANY($${number})`;

const FORM = /^= (?:\$\d+|ANY\(\$\d+\))$/;

/** `spalte konten`, etwa `user_id = ANY($1)`; alles andere wirft. */
export function aufKonten(spalte: string, konten: Konten): string {
  if (!FORM.test(konten)) throw new Error(`Kontobedingung „${konten}“: erlaubt sind = $n und = ANY($n)`);
  return `${spalte} ${konten}`;
}
