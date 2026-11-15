/** Was die Bilder aus der höheren Sammlung lesen: Ein Bild braucht nur, wer das Set hält, merkt oder
 * beobachtet (db/bestandSicht.ts). Ohne Import, damit Repositories ihn lesen dürfen. */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface BilderLesevertrag {
  gezaehlteSets(konten?: Konten): string;
}
