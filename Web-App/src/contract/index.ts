/** Der API-Vertrag: je Bereich eine Datei, hier zusammengeführt. Aus ihm
 * entstehen docs/openapi.json (npm run vertrag:openapi), die Typen der
 * Routen (src/http/vertragsRouter.ts) und die Prüfung der Antworten in den Tests. */
import type { z } from 'zod';
import type { Wire, Route } from './base';
import * as bestand from './inventory';
import * as einstellungen from './settings';
import * as figuren from './minifigs';
import * as finanzen from './finances';
import * as geraet from './device';
import * as gutscheine from './vouchers';
import * as haushalt from './household';
import * as katalog from './catalog';
import * as konto from './account';
import * as merkliste from './wanted';
import * as sets from './sets';
import * as teile from './parts';
import * as verwaltung from './management';

export const AREAS = {
  bestand,
  einstellungen,
  figuren,
  finanzen,
  geraet,
  gutscheine,
  haushalt,
  katalog,
  konto,
  merkliste,
  sets,
  teile,
  verwaltung,
};

export const CONTRACT = {
  ...bestand.routen,
  ...einstellungen.routen,
  ...figuren.routen,
  ...finanzen.routen,
  ...geraet.routen,
  ...gutscheine.routen,
  ...haushalt.routen,
  ...katalog.routen,
  ...konto.routen,
  ...merkliste.routen,
  ...sets.routen,
  ...teile.routen,
  ...verwaltung.routen,
};

export type Schluessel = keyof typeof CONTRACT;
type Rumpf<K extends Schluessel> = (typeof CONTRACT)[K] extends { antwort: infer S extends z.ZodType }
  ? Wire<z.output<S>>
  : never;
/** Der Rumpf einer Route, für Dienste, die ihn ganz zusammensetzen. */
export type ResponseBody<K extends Schluessel> = Rumpf<K>;

type Teil<K extends Schluessel, F extends 'eingabe' | 'abfrage'> = (typeof CONTRACT)[K] extends {
  [P in F]: infer S extends z.ZodType;
}
  ? z.output<S>
  : Record<never, never>;
/** Der geprüfte Rumpf (checkInput); ohne Schema leer. */
export type Eingabe<K extends Schluessel> = Teil<K, 'eingabe'>;
/** Die geprüfte Abfrage; ohne Schema leer, ein Lesen dort ist ein Übersetzungsfehler. */
export type Abfrage<K extends Schluessel> = Teil<K, 'abfrage'>;

export function routeZu(schluessel: string): Route | undefined {
  return Object.hasOwn(CONTRACT, schluessel) ? (CONTRACT as Record<string, Route>)[schluessel] : undefined;
}

/** Wörtliche Abschnitte vor Platzhaltern, wie Express es für diese Pfade hält. */
const MUSTER = Object.entries(CONTRACT as Record<string, Route>)
  .map(([k, route]) => {
    const [methode, pfad] = k.split(' ') as [string, string];
    const teile = pfad.split('/');
    return { schluessel: k as Schluessel, methode, teile, route, offen: teile.filter(t => t.startsWith(':')).length };
  })
  .sort((a, b) => a.offen - b.offen);

function patternForRequest(methode: string, pfad: string) {
  const teile = pfad.replace(/\/+$/, '').split('/');
  return MUSTER.find(
    m =>
      m.methode === methode &&
      m.teile.length === teile.length &&
      m.teile.every((t, i) => t === teile[i] || (t.startsWith(':') && teile[i] !== '')),
  );
}

/** Die Vertragsroute zu einer Anfrage, bevor Express sie zugeordnet hat. */
export function routeForRequest(methode: string, pfad: string): Route | undefined {
  return patternForRequest(methode, pfad)?.route;
}

/** Ihr Schlüssel: Wer Routen danach einordnet, nennt sie so, wie der Übersetzer sie prüft. */
export function keyForRequest(methode: string, pfad: string): Schluessel | undefined {
  return patternForRequest(methode, pfad)?.schluessel;
}
