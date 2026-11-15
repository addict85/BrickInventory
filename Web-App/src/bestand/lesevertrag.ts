/** Was der Bestand aus höheren Sets, Käufen und Anleitungen liest; Spalten wie in db/bestandSicht.ts
 * und db/bestandsmenge.ts. Ohne Import, damit Repositories ihn lesen dürfen (Konten wie db/konten.ts). */
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
