#!/usr/bin/env python3
"""Prüfungen vor dem Veröffentlichen eines APK (Job `apk-pruefen`).

  release-pruefen.py zertifikat ZERTIFIKAT_TXT SOLL_DATEI
      ZERTIFIKAT_TXT ist die Ausgabe von `apksigner verify --print-certs`. Jedes
      genannte Signierzertifikat muss in SOLL_DATEI stehen (SHA-256, eine Zeile
      je Wert, `#` leitet einen Kommentar ein). Ein ausgetauschter Schlüssel in
      der Environment fiele sonst erst auf, wenn Updates scheitern; eine
      Neuinstallation über den Direktlink nähme ihn still an.

  release-pruefen.py fassung ALT_VERSION_JSON NEU_CODE COMMIT
      Der versionCode muss über dem veröffentlichten liegen; gleich nur für
      denselben Commit (ein wiederholter Lauf). Sonst ginge ein älterer Stand
      von main als „neustes APK“ hinaus. ALT_VERSION_JSON `-`: noch nichts
      veröffentlicht.

  release-pruefen.py beschreibung DATEN_JSON APK OUTPUT_METADATA COMMIT ABLAGE
      DATEN_JSON ist der signierte Inhalt von version-signiert.json (die
      Signatur prüft openssl im Workflow). Er muss genau dieses APK beschreiben:
      versionCode und versionName wie in AGPs output-metadata.json, Grösse und
      SHA-256 der Datei, der Commit, und die Adresse
      ABLAGE/BrickInventory-<versionCode>.apk — der unveränderliche Anhang
      dieser Fassung. Sonst signierte der Workflow eine Beschreibung, die die
      App beim Laden ablehnt. Dazu eine Frist (sec10 N1): `ausgestellt` jetzt
      (höchstens einen Tag alt) und `gueltigBis` danach, höchstens 90 Tage —
      ohne sie liesse sich eine ältere Beschreibung still wieder hochladen.

  release-pruefen.py schluessel GELIEFERT_PEM APP_PEM
      GELIEFERT_PEM ist der öffentliche Beschreibungsschlüssel, mit dem der
      Signierjob signiert hat (fehlt die Datei: keiner). APP_PEM ist
      res/raw/beschreibungs_schluessel.pem der App. Nennt die App Schlüssel, muss
      der gelieferte darunter sein; sonst lehnten die Geräte die Beschreibung ab
      (sec11 H1). Nennt sie keinen, nähme sie keine Beschreibung an:
      Rückgabe 3, damit der Workflow das sichtbar macht (Etikett: kein Release).

Rückgabe 0 = in Ordnung, 1 = abgelehnt, 2 = Eingabe unbrauchbar, 3 = App ohne Schlüssel. Die Meldung
geht auf stdout; das ::error:: setzt der Workflow, denn ein erwartetes Nein
(Probe-Schlüssel) ist dort kein Fehler.
"""
import base64
import hashlib
import json
import os
import re
import sys
import time


def sollwerte(pfad):
    werte = set()
    with open(pfad, encoding='utf-8') as f:
        for zeile in f:
            wert = zeile.split('#', 1)[0].strip().replace(':', '').lower()
            if wert:
                if not re.fullmatch(r'[0-9a-f]{64}', wert):
                    raise ValueError(f'kein SHA-256: {zeile.strip()}')
                werte.add(wert)
    return werte


def zertifikat(ausgabe_pfad, soll_pfad):
    try:
        soll = sollwerte(soll_pfad)
    except (OSError, ValueError) as e:
        print(f'Sollwerte unlesbar: {e}')
        return 2
    if not soll:
        print(f'{soll_pfad} nennt kein Zertifikat. Den SHA-256 des Release-Zertifikats eintragen (README).')
        return 2
    with open(ausgabe_pfad, encoding='utf-8') as f:
        ist = [m.lower() for m in re.findall(r'certificate SHA-256 digest: ([0-9a-fA-F]{64})', f.read())]
    if not ist:
        print('In der Ausgabe von apksigner steht kein Zertifikat.')
        return 2
    fremd = sorted(set(ist) - soll)
    if fremd:
        print('Signiert mit einem anderen Zertifikat als dem hinterlegten: ' + ', '.join(fremd))
        return 1
    print(f'Signierzertifikat wie hinterlegt ({ist[0][:16]}…).')
    return 0


def fassung(alt_pfad, neu_code, commit):
    if not re.fullmatch(r'[0-9]+', neu_code):
        print(f'versionCode „{neu_code}“ ist keine Zahl.')
        return 2
    if alt_pfad == '-':
        print('Noch keine veröffentlichte Fassung.')
        return 0
    try:
        with open(alt_pfad, encoding='utf-8') as f:
            alt = json.load(f)
        alt_code = int(alt['versionCode'])
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f'Veröffentlichte version.json unlesbar: {e}')
        return 2
    neu = int(neu_code)
    if neu > alt_code or (neu == alt_code and alt.get('commit') == commit):
        print(f'versionCode {neu} folgt auf {alt_code}.')
        return 0
    print(f'versionCode {neu} liegt nicht über dem veröffentlichten {alt_code} ({alt.get("commit")}). '
          'Ein älterer Stand wird nicht als neustes APK veröffentlicht.')
    return 1


TAG = 86400


def frist(ausgestellt, gueltig, jetzt):
    """Was an `ausgestellt`/`gueltigBis` nicht stimmt; leer, wenn beides passt."""
    if not all(isinstance(w, int) and not isinstance(w, bool) for w in (ausgestellt, gueltig)):
        return [f'ausgestellt/gueltigBis fehlen oder sind keine Zahlen ({ausgestellt!r}, {gueltig!r})']
    if not jetzt - TAG <= ausgestellt <= jetzt + 300:
        return [f'ausgestellt {ausgestellt} liegt nicht bei jetzt ({jetzt})']
    if not 0 < gueltig - ausgestellt <= 90 * TAG:
        return [f'gueltigBis {gueltig} liegt nicht 1 Sekunde bis 90 Tage nach ausgestellt']
    return []


def beschreibung(daten_pfad, apk_pfad, meta_pfad, commit, ablage):
    try:
        with open(daten_pfad, encoding='utf-8') as f:
            daten = json.load(f)
        with open(meta_pfad, encoding='utf-8') as f:
            element = json.load(f)['elements'][0]
        with open(apk_pfad, 'rb') as f:
            pruefsumme = hashlib.sha256(f.read()).hexdigest()
        groesse = os.path.getsize(apk_pfad)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as e:
        print(f'Eingabe unlesbar: {e}')
        return 2
    soll = {
        'versionCode': element.get('versionCode'),
        'versionName': element.get('versionName'),
        'commit': commit,
        'apkSize': groesse,
        'apkSha256': pruefsumme,
        'apkUrl': f"{ablage.rstrip('/')}/BrickInventory-{element.get('versionCode')}.apk",
    }
    falsch = [f'{k}: {daten.get(k)!r} statt {v!r}' for k, v in soll.items() if daten.get(k) != v]
    falsch += frist(daten.get('ausgestellt'), daten.get('gueltigBis'), int(time.time()))
    if falsch:
        print('Die Beschreibung passt nicht zum APK: ' + '; '.join(falsch))
        return 1
    print(f'Beschreibung passt zum APK (versionCode {soll["versionCode"]}).')
    return 0


def pem_schluessel(pfad):
    """Die öffentlichen Schlüssel (DER) einer PEM-Datei; Text ausserhalb der Blöcke zählt nicht."""
    with open(pfad, encoding='utf-8') as f:
        text = f.read()
    bloecke = re.findall(r'-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\s]+)-----END PUBLIC KEY-----', text)
    if text.count('-----BEGIN') != len(bloecke):
        raise ValueError(f'{pfad}: ein Block ist kein öffentlicher Schlüssel')
    return [base64.b64decode(''.join(b.split()), validate=True) for b in bloecke]


def schluessel(geliefert_pfad, app_pfad):
    try:
        app = pem_schluessel(app_pfad)
        geliefert = pem_schluessel(geliefert_pfad) if os.path.exists(geliefert_pfad) else []
    except (OSError, ValueError) as e:
        print(f'Schlüssel unlesbar: {e}')
        return 2
    if not app:
        print('Die App nennt keinen Beschreibungsschlüssel; sie nähme keine Beschreibung an.')
        return 3
    if len(geliefert) != 1:
        print('Die App verlangt einen Beschreibungsschlüssel, die Beschreibung trägt keinen.')
        return 1
    if geliefert[0] not in app:
        print('Der Beschreibungsschlüssel des Signierjobs steht nicht in der App.')
        return 1
    print('Beschreibungsschlüssel steht in der App.')
    return 0


def main(argv):
    if len(argv) == 4 and argv[1] == 'zertifikat':
        return zertifikat(argv[2], argv[3])
    if len(argv) == 5 and argv[1] == 'fassung':
        return fassung(argv[2], argv[3], argv[4])
    if len(argv) == 7 and argv[1] == 'beschreibung':
        return beschreibung(*argv[2:7])
    if len(argv) == 4 and argv[1] == 'schluessel':
        return schluessel(argv[2], argv[3])
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
