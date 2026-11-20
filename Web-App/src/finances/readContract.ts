/** Was die Finanzen aus höherem Bestand, Käufen und Merkliste lesen; Spalten wie in db/inventoryView.ts
 * und db/stockQuantity.ts. Ohne Import, damit Repositories ihn lesen dürfen (Konten wie db/accounts.ts). */
type Konten = `= $${number}` | `= ANY($${number})`;

export interface FinancesReadContract {
  setBestand(konten?: Konten): string;
  teilBestand(konten?: Konten): string;
  figurBestand(konten?: Konten): string;
  setErfassungen(konten?: Konten): string;
  teilErfassungen(konten?: Konten): string;
  figurErfassungen(konten?: Konten): string;
  merkliste(konten?: Konten): string;
  mengeJoin(bezug: string, alias?: string, konten?: Konten): string;
  teilmengeJoin(bezug: string, art: 'part' | 'fig', alias?: string, konten?: Konten): string;
}
