import type { KatalogDienste } from './bereich';

/** Der Katalog des Prozesses, gebaut beim ersten Gebrauch aus dem, was der Einstieg
 * (startup/verdrahtung.ts) übergibt. Ohne Verdrahtung ist ein Aufruf ein Fehler,
 * kein stiller Rückfall auf den Prozesszugang. Ohne Laufzeit-Import, damit Tests
 * verdrahten können, bevor sie Module ersetzen. */
let _stand: { bau: () => KatalogDienste; dienste: KatalogDienste | null } | null = null;

export function verdrahteKatalog(bau: (() => KatalogDienste) | null): void {
  _stand = bau ? { bau, dienste: null } : null;
}

export function katalog(): KatalogDienste {
  if (!_stand) throw new Error('Der Bereich Katalog ist nicht verdrahtet (startup/verdrahtung.ts, verdrahte())');
  _stand.dienste ??= _stand.bau();
  return _stand.dienste;
}
