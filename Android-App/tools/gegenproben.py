#!/usr/bin/env python3
"""Gegenproben in der CI messen: Jeder Patch unter gegenproben/ macht etwas
kaputt, die im Kopf genannte Testklasse muss danach ROT sein.

Ein Test, der nie rot war, ist unbewiesen (CLAUDE.md). Für Robolectric-Tests
gibt es lokal kein Android; gemessen werden kann nur hier.

Kopf eines Patches (vor dem ersten `diff --git`, git apply überliest ihn):

    Gegenprobe: was kaputt gemacht wird
    Modul: core-data
    Test: ch.brickinventoryapp.BestandMigrationTest
    Rot: Teil des Testnamens, der scheitern muss      (optional)

Rot heisst: Der Testbericht der Klasse existiert und nennt einen Fehlschlag
(mit `Rot:` genau in diesem Test). Kein Bericht — etwa weil der Patch nicht
übersetzt — zählt NICHT als rot: Dann hat der Test nichts bewiesen.

Aufruf:  python3 tools/gegenproben.py gegenproben
Gradle-Befehl ersetzbar über GEGENPROBE_GRADLE (für den Test dieses Werkzeugs).
Rückgabe 0 nur, wenn jede Gegenprobe rot war und es mindestens eine gab.
"""
import glob
import os
import shlex
import subprocess
import sys
import xml.etree.ElementTree as ET

PFLICHT = ('Gegenprobe', 'Modul', 'Test')


def kopf(pfad):
    werte = {}
    with open(pfad, encoding='utf-8') as f:
        for zeile in f:
            if zeile.startswith('diff --git') or zeile.startswith('--- '):
                break
            if ':' in zeile:
                name, wert = zeile.split(':', 1)
                if name.strip() in PFLICHT + ('Rot',):
                    werte[name.strip()] = wert.strip()
    return werte


def git(wurzel, *args):
    return subprocess.run(['git', *args], cwd=wurzel, capture_output=True, text=True)


def fehlschlaege(bericht):
    """Namen der gescheiterten Tests im JUnit-Bericht."""
    baum = ET.parse(bericht).getroot()
    return [fall.get('name', '') for fall in baum.iter('testcase')
            if fall.find('failure') is not None or fall.find('error') is not None]


def miss(projekt, wurzel, patch, gradle):
    k = kopf(patch)
    name = os.path.basename(patch)
    fehlt = [p for p in PFLICHT if not k.get(p)]
    if fehlt:
        return False, f'{name}: im Kopf fehlt {", ".join(fehlt)}'
    pruef = git(wurzel, 'apply', '--check', os.path.abspath(patch))
    if pruef.returncode != 0:
        return False, f'{name}: Patch passt nicht mehr auf den Stand — {pruef.stderr.strip()}'
    klasse = k['Test']
    bericht = os.path.join(projekt, k['Modul'], 'build', 'test-results', 'testDebugUnitTest', f'TEST-{klasse}.xml')
    if os.path.exists(bericht):
        os.remove(bericht)
    git(wurzel, 'apply', os.path.abspath(patch))
    try:
        lauf = subprocess.run(gradle + [f':{k["Modul"]}:testDebugUnitTest', '--rerun', '--tests', klasse],
                              cwd=projekt, capture_output=True, text=True)
    finally:
        zurueck = git(wurzel, 'apply', '-R', os.path.abspath(patch))
    if zurueck.returncode != 0:
        return False, f'{name}: Patch liess sich nicht zurücknehmen — {zurueck.stderr.strip()}'
    if not os.path.exists(bericht):
        ende = '\n'.join((lauf.stdout + lauf.stderr).splitlines()[-15:])
        return False, f'{name}: kein Testbericht für {klasse} — der Test lief nicht (übersetzt der Patch?)\n{ende}'.rstrip()
    rot = fehlschlaege(bericht)
    erwartet = k.get('Rot')
    if erwartet and not any(erwartet in t for t in rot):
        return False, f'{name}: „{erwartet}“ blieb grün (rot: {rot or "nichts"}) — {k["Gegenprobe"]}'
    if not rot:
        return False, f'{name}: {klasse} blieb grün — die Gegenprobe „{k["Gegenprobe"]}“ greift nicht'
    return True, f'{name}: rot wie verlangt ({", ".join(rot)}) — {k["Gegenprobe"]}'


def main():
    ordner = sys.argv[1] if len(sys.argv) > 1 else 'gegenproben'
    projekt = os.path.dirname(os.path.abspath(ordner))
    wurzel = git(projekt, 'rev-parse', '--show-toplevel').stdout.strip()
    gradle = shlex.split(os.environ.get('GEGENPROBE_GRADLE', './gradlew --no-daemon -Pksp.incremental=false'))
    patches = sorted(glob.glob(os.path.join(ordner, '*.patch')))
    if not patches:
        print(f'Keine Gegenproben unter {ordner}/ — ohne sie prüft dieser Schritt nichts.')
        return 1
    ergebnisse = [miss(projekt, wurzel, p, gradle) for p in patches]
    zeilen = [('rot ' if ok else 'FEHLT ') + text for ok, text in ergebnisse]
    print('\n'.join(zeilen))
    zusammenfassung = os.environ.get('GITHUB_STEP_SUMMARY')
    if zusammenfassung:
        with open(zusammenfassung, 'a', encoding='utf-8') as f:
            f.write('## Gegenproben\n\n' + '\n'.join(f'- {z.splitlines()[0]}' for z in zeilen) + '\n')
    for ok, text in ergebnisse:
        if not ok:
            print(f'::error title=Gegenprobe greift nicht::{text.splitlines()[0]}')
    return 0 if all(ok for ok, _ in ergebnisse) else 1


if __name__ == '__main__':
    sys.exit(main())
