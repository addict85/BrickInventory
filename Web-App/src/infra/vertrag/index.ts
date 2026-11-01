/** Der API-Vertrag: je Bereich eine Datei, hier zusammengeführt. Aus ihm
 * entstehen docs/openapi.json (npm run vertrag:openapi), die Typen der
 * Routen (Antwort<…>) und die Prüfung der Antworten in den Tests. */
import type { Response } from 'express';
import type { z } from 'zod';
import type { Draht, Route } from './grund';
import { Fehler } from './grund';
import * as bestand from './bestand';
import * as einstellungen from './einstellungen';
import * as figuren from './figuren';
import * as finanzen from './finanzen';
import * as gutscheine from './gutscheine';
import * as haushalt from './haushalt';
import * as katalog from './katalog';
import * as konto from './konto';
import * as merkliste from './merkliste';
import * as sets from './sets';
import * as teile from './teile';
import * as verwaltung from './verwaltung';

export const BEREICHE = { bestand, einstellungen, figuren, finanzen, gutscheine, haushalt, katalog, konto,
  merkliste, sets, teile, verwaltung };

export const VERTRAG = {
  ...bestand.routen, ...einstellungen.routen, ...figuren.routen, ...finanzen.routen, ...gutscheine.routen,
  ...haushalt.routen, ...katalog.routen, ...konto.routen, ...merkliste.routen, ...sets.routen,
  ...teile.routen, ...verwaltung.routen,
};

export type Schluessel = keyof typeof VERTRAG;
type Rumpf<K extends Schluessel> = (typeof VERTRAG)[K] extends { antwort: infer S extends z.ZodType } ? Draht<z.output<S>> : never;
/** Der Typ von `res` in einer Route: tsc meldet, wo die Antwort vom Vertrag abweicht. */
export type Antwort<K extends Schluessel> = Response<Rumpf<K> | z.input<typeof Fehler>>;
/** Der Rumpf einer Route, für Dienste, die ihn ganz zusammensetzen. */
export type AntwortRumpf<K extends Schluessel> = Rumpf<K>;

export function routeZu(schluessel: string): Route | undefined {
  return Object.prototype.hasOwnProperty.call(VERTRAG, schluessel)
    ? (VERTRAG as Record<string, Route>)[schluessel] : undefined;
}
