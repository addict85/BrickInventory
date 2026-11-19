/** Der Satz Dienste aus startup/verdrahtung.ts, hier, damit routes/ und jobs/ nicht an
 * startup/ hängen, das sie einbindet; Routerfabriken verengen ihn mit Pick<>. */
import type { AuftraegeDienste } from './auftraege';
import type { BestandDienste } from './bestand';
import type { BilderDienste } from './bilder';
import type { ThrottleServices } from './throttle';
import type { SettingsServices } from './settings';
import type { MinifigsServices } from './minifigs';
import type { GeraeteDienste } from './geraete';
import type { FactorsServices } from './factors';
import type { FinanzenDienste } from './finanzen';
import type { FremdquellenDienste } from './fremdquellen';
import type { VoucherServices } from './vouchers';
import type { HaushaltDienste } from './haushalt';
import type { IdempotencyServices } from './idempotency';
import type { KatalogDienste } from './katalog';
import type { KontoDienste } from './konto';
import type { MailDienste } from './mail';
import type { ProfileServices } from './profile';
import type { WantedServices } from './wanted';
import type { CollectionServices } from './collection';
import type { SetsDienste } from './sets';
import type { PartsServices } from './parts';
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
  throttle: ThrottleServices;
  settings: SettingsServices;
  mail: MailDienste;
  auftraege: AuftraegeDienste;
  haushalt: HaushaltDienste;
  geraete: GeraeteDienste;
  factors: FactorsServices;
  konto: KontoDienste;
  profile: ProfileServices;
  idempotency: IdempotencyServices;
  fremdquellen: FremdquellenDienste;
  bilder: BilderDienste;
  katalog: KatalogDienste;
  finanzen: FinanzenDienste;
  bestand: BestandDienste;
  sets: SetsDienste;
  parts: PartsServices;
  minifigs: MinifigsServices;
  wanted: WantedServices;
  vouchers: VoucherServices;
  collection: CollectionServices;
  verwaltung: VerwaltungDienste;
}
