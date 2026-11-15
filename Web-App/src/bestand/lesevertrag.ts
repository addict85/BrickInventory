/** Was der Bestand über Lesebausteine liest; Spalten wie in db/bestandSicht.ts und db/bestandsmenge.ts.
 * Nur die Anleitungen liegen höher (src/sets), Sets und Käufe gehören ihm. Ohne Import, damit
 * Repositories ihn lesen dürfen (Konten wie db/konten.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface BestandLesevertrag {
  setBestand(konten?: Konten): string;
  setErfassungen(konten?: Konten): string;
  teilErfassungen(konten?: Konten): string;
  figurErfassungen(konten?: Konten): string;
  anleitungen(konten?: Konten): string;
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
  teilmengeJoin(bezug: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
