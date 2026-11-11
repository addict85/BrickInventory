import type { SetsDienste } from './bereich';

/** Die Dienste des Prozesses, gebaut beim ersten Gebrauch aus dem, was der Einstieg
 * (startup/verdrahtung.ts) übergibt. Ohne Verdrahtung ist ein Aufruf ein Fehler:
 * Ein stiller Rückfall auf den Datenbankzugang des Prozesses verdeckte, wer fehlt.
 * Ohne Laufzeit-Import, damit Tests verdrahten können, bevor sie Module ersetzen. */
let _stand: { bau: () => SetsDienste; dienste: SetsDienste | null } | null = null;

export function verdrahteSets(bau: (() => SetsDienste) | null): void {
  _stand = bau ? { bau, dienste: null } : null;
}

export function sets(): SetsDienste {
  if (!_stand) throw new Error('Der Bereich Sets ist nicht verdrahtet (startup/verdrahtung.ts, verdrahte())');
  _stand.dienste ??= _stand.bau();
  return _stand.dienste;
}
