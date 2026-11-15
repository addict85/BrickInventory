/** Je Schlüssel ein wartender Auftrag, der über Aufträge hinweg mitzählt (`versuch` in der
 * Nutzlast): Wer eine Gegenseite später erneut fragen will, merkt vor, bis die Grenze erreicht ist. */
import type { AuftragsArt, NutzlastEingabe } from './auftraege';
import { weckeWorker, zieheVor } from './dienst';
import type { AuftraegeKontext } from './kontext';

/** @returns vorgemerkt false, wenn der Schlüssel schon `hoechstens` Mal vorgemerkt war */
export async function merkeVor<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  schluessel: string,
  nutzlast: (versuch: number) => NutzlastEingabe<A>,
  o: { faelligAb: Date; fehler: string; hoechstens: number },
): Promise<{ versuch: number; vorgemerkt: boolean }> {
  const versuch = (await k.auftraege.hoechsterZaehler(schluessel, 'versuch')) + 1;
  if (versuch > o.hoechstens) {
    await k.auftraege.loescheOffenen(schluessel);
    return { versuch, vorgemerkt: false };
  }
  const n = k.arten.pruefe(art, nutzlast(versuch));
  await k.auftraege.merkeVor(art, schluessel, n as object, {
    faelligAb: o.faelligAb,
    fehler: o.fehler,
    maxVersuche: 3,
  });
  await weckeWorker(k, art);
  return { versuch, vorgemerkt: true };
}

export async function vergiss(k: AuftraegeKontext, schluessel: string): Promise<void> {
  await k.auftraege.loescheOffenen(schluessel);
}

/** Fällig ab sofort, ohne Schlüssel die ganze Art; eine Pause der Art bleibt. */
export async function jetzt(k: AuftraegeKontext, art: AuftragsArt, schluessel?: string): Promise<number> {
  return zieheVor(k, art, schluessel);
}

export async function vorziehen(k: AuftraegeKontext, art: AuftragsArt, bis: Date): Promise<void> {
  await k.auftraege.zieheTermineVor(art, bis);
}

export function wartende(k: AuftraegeKontext, art: AuftragsArt) {
  return k.auftraege.wartendeDerArt(art);
}

export async function zahlen(k: AuftraegeKontext, art: AuftragsArt): Promise<{ wartend: number; faellig: number }> {
  const z = await k.auftraege.zahlenDerArt(art);
  return { wartend: z?.wartend ?? 0, faellig: z?.faellig ?? 0 };
}
