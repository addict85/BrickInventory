/** Wie db/konten.ts; hier ohne Import, damit Repositories den Vertrag lesen dürfen (Blatt). */
type Konten = `= $${number}` | `= ANY($${number})`;

/** Was die Bilder aus der Sammlung lesen, die höher liegt: Ein Bild braucht nur, wer das Set
 * hält, merkt oder beobachtet. Die Form steht hier, das SQL reicht startup (db/bestandSicht.ts). */
export interface BilderLesevertrag {
  /** Abfrage: je Set, das für `konten` zählt, set_number und besitz (gehalten, nicht nur gemerkt). */
  gezaehlteSets(konten?: Konten): string;
}
