/** Ein manueller Kauf wechselt das Konto: Teile, Figuren und ihre Käufe gehören dem Bestand, darum
 * steht das Umhängen hier und nicht beim Set-Verschieben. */
import { fachfehler } from '../infra/fehlerTexte';
import { kaufAmTagErfassen } from './acquisitions';
import { legeZeileAn } from './inhalt';
import * as mengen from './repository/manuelleMengen';
import * as repo from './repository/umhaengen';
import type { BestandKontext } from './kontext';

/** Über den KAUFPREIS, nicht über den Eintrag; was beim Absender bleibt, folgt
 * aus seinen Erfassungen. */
export async function manuelleErfassungUmhaengen(
  t: BestandKontext,
  kind: 'part' | 'fig',
  keyValues: (string | number)[],
  acquisitionId: number,
  fromId: number,
  toId: number,
): Promise<{ quantity: number; merged: boolean; source_emptied: boolean }> {
  const acq = await repo.manuelleErfassung(t.db, kind, acquisitionId, fromId, keyValues);
  if (!acq) fachfehler('nicht_gefunden', 'kaufpreis_nicht_gefunden');

  const src = await repo.manuelleZeile(t.db, kind, fromId, keyValues);
  if (!src) fachfehler('nicht_gefunden', 'nicht_gefunden');

  const movingQty = Math.max(1, parseInt(String(acq.quantity), 10) || 1);
  const remaining = Math.max(0, (await mengen.summeDerErfassungen(t.db, kind, fromId, keyValues)) - movingQty);

  const dst = await repo.manuelleZeile(t.db, kind, toId, keyValues);
  if (!dst) await legeZeileAn(t, kind, toId, keyValues);

  await kaufAmTagErfassen(t, kind, toId, keyValues, {
    quantity: movingQty,
    price: acq.unit_price,
    condition: acq.condition,
    createdAt: acq.created_at,
    geschaetzt: acq.price_estimated,
    currency: acq.currency,
  });
  await mengen.entferneErfassung(t.db, kind, acq.id, [fromId]);

  if (remaining > 0) return { quantity: movingQty, merged: !!dst, source_emptied: false };
  await repo.entferneManuell(t.db, kind, fromId, keyValues, src.id);
  return { quantity: movingQty, merged: !!dst, source_emptied: true };
}
