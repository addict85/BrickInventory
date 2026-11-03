#!/usr/bin/env python3
"""Zwei Prüfungen vor dem Veröffentlichen eines APK (Job `apk-pruefen`).

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

Rückgabe 0 = in Ordnung, 1 = abgelehnt, 2 = Eingabe unbrauchbar. Die Meldung
geht auf stdout; das ::error:: setzt der Workflow, denn ein erwartetes Nein
(Probe-Schlüssel) ist dort kein Fehler.
"""
import json
import re
import sys


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


def main(argv):
    if len(argv) == 4 and argv[1] == 'zertifikat':
        return zertifikat(argv[2], argv[3])
    if len(argv) == 5 and argv[1] == 'fassung':
        return fassung(argv[2], argv[3], argv[4])
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
