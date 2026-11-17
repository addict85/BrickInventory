/** Aufträge, die ein Konto selbst angestossen hat und über ihren Schlüssel verfolgt (etwa ein PDF):
 * Gelesen und gelöscht wird nur unter Zeilenschutz und nach Konto gefiltert. */
import type { AuftragsArt } from './auftraege';
import type { AuftraegeKontext } from './kontext';

export function eigenerAuftrag(k: AuftraegeKontext, art: AuftragsArt, schluessel: string, uid: number) {
  return k.eigene.eigeneZeile(art, schluessel, uid);
}

export async function loescheEigenen(k: AuftraegeKontext, art: AuftragsArt, schluessel: string, uid: number) {
  await k.eigene.loescheEigeneZeile(art, schluessel, uid);
}

export async function zaehleLaufende(k: AuftraegeKontext, art: AuftragsArt, uid: number, fristSek: number) {
  return (await k.eigene.zaehleLaufendeZeilen(art, uid, fristSek))?.n ?? 0;
}

/** @returns die Schlüssel der gelöschten, damit ihre Dateien mitgehen */
export async function loescheBeendete(k: AuftraegeKontext, art: AuftragsArt, fristSek: number): Promise<string[]> {
  return (await k.eigene.loescheBeendeteZeilen(art, fristSek)).map(r => r.dedupe_key);
}
