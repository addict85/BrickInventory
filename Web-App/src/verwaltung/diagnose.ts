/** Proben für Verwalter: Bild- und Preisabruf und die Fragen zu einer leeren Kachel. */
import { proxyCacheSchluessel, proxyCachePathFor, imgProxyFailures } from '../bilder';
import { oeffneBild } from '../fremdquellen';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../infra/fremdeAdressen';
import { urlOderNull } from '../infra/validate';
import type { KontoBildzeile } from './repository/verwaltung';
import fs from 'node:fs';
import { AbrufFehler, type AbrufStrom } from '../infra/abruf';
import path from 'node:path';
import { DATA_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, ohneFehlendeDatei } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { ohneBricklinkPreis } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import type { VerwaltungKontext } from './kontext';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VARIANTEN = [
  {
    name: 'mit Referer',
    headers: { 'User-Agent': UA, Referer: 'https://rebrickable.com/', Accept: 'image/*,*/*;q=0.8' },
  },
  { name: 'ohne Referer', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } },
  { name: 'nackt', headers: {} },
];

/** Meldet, was der Proxy davon ausliefern würde — mit und ohne Referer. */
export async function bildProbe(url: string) {
  if (!/^https:\/\//.test(url)) fachfehler('ungueltig', 'url_fehlt_https');
  const adresse = urlOderNull(url);
  if (!adresse) fachfehler('ungueltig', 'url_ungueltig');
  // Dieselben Hosts wie der Bild-Proxy: Der Abruf läuft aus dem internen Netz;
  // jede Adresse zuzulassen wäre Server-Side Request Forgery.
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) fachfehler('verboten', 'host_nicht_erlaubt', { host: adresse.hostname });

  const results: Awaited<ReturnType<typeof probeVariante>>[] = [];
  for (const v of VARIANTEN) results.push(await probeVariante(url, v));

  const key = proxyCacheSchluessel(url);
  const dir = path.join(DATA_DIR, 'img_proxy_cache');
  const cached = await dateiGroesse(path.join(dir, key));
  const thumb = await dateiGroesse(path.join(dir, key + '_thumb.jpg'));

  // Zeigt auf einen Blick, woran Abrufe scheitern, ohne im Log zu suchen.
  const failures = imgProxyFailures;
  const head = await ersteBytes(url);
  return { url, cache: { original: cached, thumb }, probes: results, proxy_failures: failures, body_check: head };
}

/** Ohne Umleitungen: Die Probe soll den rohen Status des CDN zeigen. */
const offenOhneUmleitung = (url: string, kopfzeilen: Record<string, string>) =>
  oeffneBild(url, { maxBytes: 65536, zeitlimitMs: 10_000, umleitungen: 0, kopfzeilen });

function liesStrom(a: AbrufStrom, genug = Infinity) {
  return new Promise<{ teile: Buffer[]; bytes: number; truncated: boolean }>(fertig => {
    const teile: Buffer[] = [];
    let bytes = 0;
    const s = a.strom();
    s.on('data', (c: Buffer) => {
      teile.push(c);
      bytes += c.length;
      if (bytes >= genug) {
        s.destroy();
        fertig({ teile, bytes, truncated: false });
      }
    });
    s.on('end', () => fertig({ teile, bytes, truncated: false }));
    s.on('error', () => fertig({ teile, bytes, truncated: true }));
  });
}

async function probeVariante(url: string, v: { name: string; headers: Record<string, string> }) {
  const t0 = Date.now();
  try {
    const a = await offenOhneUmleitung(url, v.headers);
    const { bytes, truncated } = await liesStrom(a);
    const k = a.kopf;
    return {
      variant: v.name,
      ms: Date.now() - t0,
      status: a.status,
      content_type: k['content-type'] || null,
      content_length: k['content-length'] || null,
      // Komprimiert geliefert muss der Proxy die Kopfzeile weiterreichen, sonst hält
      // der Browser die Bytes für ein JPEG.
      content_encoding: k['content-encoding'] || null,
      transfer_encoding: k['transfer-encoding'] || null,
      bytes,
      server: k.server || null,
      cf_ray: k['cf-ray'] || null,
      ...(truncated ? { truncated } : {}),
    };
  } catch (e) {
    return {
      variant: v.name,
      ms: Date.now() - t0,
      error: fehlertext(e),
      code: e instanceof AbrufFehler ? e.grund : undefined,
    };
  }
}

const dateiGroesse = (datei: string) =>
  fs.promises
    .stat(datei)
    .then(st => ({ bytes: st.size }))
    .catch(ohneFehlendeDatei('verwaltung:stat', null));

/** Durch dieselbe Kette wie der Proxy, aber die ersten Bytes kommen als Hex hierher. */
function ersteBytes(url: string) {
  return offenOhneUmleitung(url, { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8', 'Accept-Encoding': 'identity' }).then(
    async a => {
      const b = Buffer.concat((await liesStrom(a, 32)).teile);
      return {
        status: a.status,
        content_encoding: a.kopf['content-encoding'] || null,
        first_bytes_hex: b.slice(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim(),
        looks_like: bildArt(b),
      };
    },
    (e: unknown) => ({ error: fehlertext(e) }),
  );
}

function bildArt(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'JPEG';
  if (b[0] === 0x89 && b[1] === 0x50) return 'PNG';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip (komprimiert!)';
  return b.slice(0, 5).toString().toLowerCase().startsWith('<') ? 'HTML/XML statt Bild' : 'unbekannt';
}

/** Mit `live` auch die Antwort von BrickLink. */
export async function preisProbe(k: VerwaltungKontext, uid: number, setNumber: string, live: boolean) {
  const ab = new Abstriche();
  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    k.verwaltung.probeSet(uid, setNumber),
    k.verwaltung.probeErfassungen(uid, setNumber),
    k.verwaltung.probePreisCache(setNumber),
    k.verwaltung.probePreisVerlauf(setNumber),
    ab.oder('waehrung', k.verwaltung.probeWaehrung(uid), null),
    k.einstellungen.getGlobalSetting('price_cache_ttl'),
  ]);

  // Dieselbe Regel wie conditionFromAcquisitions(): Eine gebrauchte Erfassung genügt.
  const anyUsed = acqs.some(a => a.condition === 'U');
  const chosen = anyUsed ? 'U' : 'N';

  const out: Record<string, unknown> & { currency: string; ttl_hours: number } = {
    ...ab.angabe(),
    set: setRow || null,
    acquisitions: acqs,
    condition_logic: {
      any_acquisition_used: anyUsed,
      chosen_for_price: chosen,
      hinweis:
        'Eine gebrauchte Erfassung macht das Set gebraucht, sonst ist es neu. ' +
        'Der Zustand steht seit Migration 0032 nur in den Erfassungen; das Feld ' +
        'mit dem gespeicherten Wert, das hier vorher stand, ist weggefallen. ' +
        'Weicht "chosen_for_price" von der Anzeige ab, liegt der Fehler dort.',
    },
    currency: currRow?.value || 'EUR',
    ttl_hours: parseInt(ttlRow || '24', 10),
    price_cache: cacheRows,
    price_history_last5: histRows,
  };

  // Dieselbe Währung wie die Bewertung, sonst zeigte die Probe andere Cache-Zeilen.
  out.currency = await k.einstellungen.getSetting(uid, 'currency', 'EUR');
  // „BrickLink kennt das Set nicht": Steht sie, liefert fetchPrice still 0.
  const katalog = await k.katalog.katalogEintrag(setNumber);
  out.katalog = katalog ? { ...katalog, gilt_als_unbekannt: ohneBricklinkPreis(katalog) } : null;
  // Genau der Aufruf, den Finanzen macht.
  try {
    out.finanzen_preis = await k.finanzen.fetchPrice(setNumber, chosen, 'sold', out.currency, out.ttl_hours);
  } catch (e) {
    out.finanzen_preis = { error: fehlertext(e) };
  }

  if (live) {
    const cur = out.currency;
    const liveWerte: Record<string, unknown> = {};
    out.live = liveWerte;
    for (const cond of ['N', 'U']) {
      try {
        const g = await k.katalog.getPriceGuide(setNumber, cond, 'sold', cur);
        liveWerte[cond] = {
          avg_price: g?.avg_price,
          qty_avg_price: g?.qty_avg_price,
          guide_used: g?.guide_used,
          guide_fallback: g?.guide_fallback || false,
        };
      } catch (e) {
        liveWerte[cond] = { error: fehlertext(e) };
      }
    }
  }

  return out;
}

/** Die wiederkehrenden Fragen zu einer leeren Kachel in einer Antwort: Datenbank, Platte, Proxy, Fehlanzeige. */
export async function bildDiagnose(kx: VerwaltungKontext, sn: string) {
  const ab = new Abstriche();
  const konten: KontoBildzeile = await ab.oder('konten', kx.verwaltung.bildZeilenDerKonten(sn), {
    anzahl_konten: 0,
    image_local: null,
    image_url: null,
  });
  const katalog = await ab.oder('katalog', kx.verwaltung.katalogBild(sn), null);

  const safe = sn.replace(/[^a-z0-9-]/gi, '_');
  const datei = async (p: string) => {
    const st = await fs.promises.stat(p).catch(ohneFehlendeDatei('verwaltung:bilddatei', null));
    return st
      ? { vorhanden: true, bytes: st.size, geaendert: st.mtime }
      : { vorhanden: false, bytes: 0, geaendert: null };
  };
  const original = await datei(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
  const vorschau = await datei(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

  const cdnUrl = konten.image_url || katalog?.image_url || null;
  let proxy: { gecacht: boolean; [k: string]: unknown } = { adresse: cdnUrl, gecacht: false };
  if (cdnUrl) {
    const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
    if (cf) {
      const cache = await datei(cf);
      proxy = { adresse: cdnUrl, gecacht: cache.vorhanden, cache, vorschau: await datei(cf + '_thumb.jpg') };
    }
  }

  const merker = await ab.oder('fehlanzeige', kx.verwaltung.fehlanzeigeDesSets(sn), null);
  const vorschauMerker = await ab.oder('fehlanzeige', kx.verwaltung.fehlanzeigeDerVorschau(safe), null);

  // Eine Diagnose aus Ersatzwerten führte in die Irre: zuerst sagen, was nicht lesbar war.
  const hinweise: string[] = ab.teile.length ? [`Nicht lesbar, dort stehen Ersatzwerte: ${ab.teile.join(', ')}.`] : [];
  if (!konten.anzahl_konten) hinweise.push('Kein Konto führt dieses Set.');
  if (konten.anzahl_konten && !konten.image_local && !cdnUrl)
    hinweise.push('Weder lokale Datei noch CDN-Adresse bekannt — die Clients können nichts anzeigen.');
  if (konten.image_local && !original.vorhanden)
    hinweise.push('image_local ist gesetzt, die Datei fehlt aber — die Bildroute weicht auf den Proxy aus.');
  if (original.vorhanden && !vorschau.vorhanden)
    hinweise.push('Original da, Vorschau fehlt — sie entsteht beim nächsten Abruf oder über den Bilder-Nachlauf.');
  if (vorschau.vorhanden && vorschau.bytes < 200)
    hinweise.push('Die Vorschau ist unbrauchbar klein und wird beim Ausliefern verworfen.');
  if (merker)
    hinweise.push(
      `Gilt seit ${new Date(merker.checked_at).toLocaleString()} als fehlend` +
        (merker.reason ? ` (${merker.reason})` : ' (Grund nicht vermerkt — Altbestand)') +
        '. Solange der Eintrag steht, wird das Bild NICHT geholt. ' +
        'Zurücknehmen: POST /api/v1/admin/forget-image-misses',
    );
  if (vorschauMerker) hinweise.push('Für die Vorschau ist ein Fehlschlag vermerkt — sie wird nicht erneut versucht.');
  if (!hinweise.length) hinweise.push('Alles vorhanden: Original und Vorschau liegen bereit.');

  return {
    set_number: sn,
    datenbank: { ...konten, katalog_bild: katalog?.image_url || null },
    lokal: { original, vorschau },
    merker: merker ? { seit: merker.checked_at, grund: merker.reason || null } : null,
    proxy,
    hinweise,
  };
}
