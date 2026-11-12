/** Der API-Vertrag: je Bereich eine Datei, hier zusammengeführt. Aus ihm
 * entstehen docs/openapi.json (npm run vertrag:openapi), die Typen der
 * Routen (src/http/vertragsRouter.ts) und die Prüfung der Antworten in den Tests. */
import type { z } from 'zod';
import type { Draht, Route } from './grund';
import * as bestand from './bestand';
import * as einstellungen from './einstellungen';
import * as figuren from './figuren';
import * as finanzen from './finanzen';
import * as geraet from './geraet';
import * as gutscheine from './gutscheine';
import * as haushalt from './haushalt';
import * as katalog from './katalog';
import * as konto from './konto';
import * as merkliste from './merkliste';
import * as sets from './sets';
import * as teile from './teile';
import * as verwaltung from './verwaltung';

export const BEREICHE = {
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

export const VERTRAG = {
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

export type Schluessel = keyof typeof VERTRAG;
type Rumpf<K extends Schluessel> = (typeof VERTRAG)[K] extends { antwort: infer S extends z.ZodType }
  ? Draht<z.output<S>>
  : never;
/** Der Rumpf einer Route, für Dienste, die ihn ganz zusammensetzen. */
export type AntwortRumpf<K extends Schluessel> = Rumpf<K>;

type Teil<K extends Schluessel, F extends 'eingabe' | 'abfrage'> = (typeof VERTRAG)[K] extends {
  [P in F]: infer S extends z.ZodType;
}
  ? z.output<S>
  : Record<never, never>;
/** Der geprüfte Rumpf (eingabePruefen); ohne Schema leer. */
export type Eingabe<K extends Schluessel> = Teil<K, 'eingabe'>;
/** Die geprüfte Abfrage; ohne Schema leer, ein Lesen dort ist ein Übersetzungsfehler. */
export type Abfrage<K extends Schluessel> = Teil<K, 'abfrage'>;

export function routeZu(schluessel: string): Route | undefined {
  return Object.hasOwn(VERTRAG, schluessel) ? (VERTRAG as Record<string, Route>)[schluessel] : undefined;
}

/** Wörtliche Abschnitte vor Platzhaltern, wie Express es für diese Pfade hält. */
const MUSTER = Object.entries(VERTRAG as Record<string, Route>)
  .map(([k, route]) => {
    const [methode, pfad] = k.split(' ') as [string, string];
    const teile = pfad.split('/');
    return { methode, teile, route, offen: teile.filter(t => t.startsWith(':')).length };
  })
  .sort((a, b) => a.offen - b.offen);

/** Die Vertragsroute zu einer Anfrage, bevor Express sie zugeordnet hat. */
export function routeFuerAnfrage(methode: string, pfad: string): Route | undefined {
  const teile = pfad.replace(/\/+$/, '').split('/');
  return MUSTER.find(
    m =>
      m.methode === methode &&
      m.teile.length === teile.length &&
      m.teile.every((t, i) => t === teile[i] || (t.startsWith(':') && teile[i] !== '')),
  )?.route;
}
