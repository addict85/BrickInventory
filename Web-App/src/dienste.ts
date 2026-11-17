/** Der Satz Dienste aus startup/verdrahtung.ts, hier, damit routes/ und jobs/ nicht an
 * startup/ hängen, das sie einbindet; Routerfabriken verengen ihn mit Pick<>. */
import type { AuftraegeDienste } from './auftraege';
import type { BestandDienste } from './bestand';
import type { BilderDienste } from './bilder';
import type { DrosselDienste } from './drossel';
import type { EinstellungenDienste } from './einstellungen';
import type { MinifigsServices } from './minifigs';
import type { GeraeteDienste } from './geraete';
import type { FaktorenDienste } from './faktoren';
import type { FinanzenDienste } from './finanzen';
import type { FremdquellenDienste } from './fremdquellen';
import type { GutscheineDienste } from './gutscheine';
import type { HaushaltDienste } from './haushalt';
import type { IdempotencyServices } from './idempotency';
import type { KatalogDienste } from './katalog';
import type { KontoDienste } from './konto';
import type { MailDienste } from './mail';
import type { ProfileServices } from './profile';
import type { MerklisteDienste } from './merkliste';
import type { SammlungDienste } from './sammlung';
import type { SetsDienste } from './sets';
import type { TeileDienste } from './teile';
import type { VerwaltungDienste } from './verwaltung';
import * as bestandSicht from '../db/bestandSicht';
import * as bestandsmenge from '../db/bestandsmenge';
import * as haushaltSicht from '../db/haushaltSicht';
import * as kontoSicht from '../db/kontoSicht';
import * as zugangSicht from '../db/zugangSicht';

/** Was tiefere Bereiche aus Tabellen höherer lesen: Jeder nennt in seinem Lesevertrag die Form,
 * die er braucht, und bekommt das SQL von hier über dem Besitzer, nicht per Import (docs/architektur.md). */
export const LESEVERTRAG = { ...bestandSicht, ...bestandsmenge, ...haushaltSicht, ...kontoSicht, ...zugangSicht };

export interface Dienste {
  drossel: DrosselDienste;
  einstellungen: EinstellungenDienste;
  mail: MailDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  geraete: GeraeteDienste;
  faktoren: FaktorenDienste;
  konto: KontoDienste;
  profile: ProfileServices;
  idempotency: IdempotencyServices;
  fremdquellen: FremdquellenDienste;
  bilder: BilderDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  teile: TeileDienste;
  minifigs: MinifigsServices;
  merkliste: MerklisteDienste;
  gutscheine: GutscheineDienste;
  sammlung: SammlungDienste;
  verwaltung: VerwaltungDienste;
}
