/** Der Satz Dienste aus startup/verdrahtung.ts, hier, damit routes/ und jobs/ nicht an
 * startup/ hängen, das sie einbindet; Routerfabriken verengen ihn mit Pick<>. */
import type { AuftraegeDienste } from './auftraege';
import type { BestandDienste } from './bestand';
import type { BilderDienste } from './bilder';
import type { EinstellungenDienste } from './einstellungen';
import type { FigurenDienste } from './figuren';
import type { FinanzenDienste } from './finanzen';
import type { FremdquellenDienste } from './fremdquellen';
import type { GutscheineDienste } from './gutscheine';
import type { HaushaltDienste } from './haushalt';
import type { IdempotenzDienste } from './idempotenz';
import type { KatalogDienste } from './katalog';
import type { KontoDienste } from './konto';
import type { MailDienste } from './mail';
import type { MerklisteDienste } from './merkliste';
import type { SammlungDienste } from './sammlung';
import type { SetsDienste } from './sets';
import type { TeileDienste } from './teile';
import type { VerwaltungDienste } from './verwaltung';

export interface Dienste {
  einstellungen: EinstellungenDienste;
  mail: MailDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  konto: KontoDienste;
  idempotenz: IdempotenzDienste;
  fremdquellen: FremdquellenDienste;
  bilder: BilderDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  teile: TeileDienste;
  figuren: FigurenDienste;
  merkliste: MerklisteDienste;
  gutscheine: GutscheineDienste;
  sammlung: SammlungDienste;
  verwaltung: VerwaltungDienste;
}
