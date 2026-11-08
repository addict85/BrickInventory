#!/usr/bin/env python3
"""Gegenproben in der CI messen: Jeder Patch unter gegenproben/ macht etwas
kaputt, die im Kopf genannte Testklasse muss danach ROT sein.

Ein Test, der nie rot war, ist unbewiesen (CLAUDE.md). Für Robolectric-Tests
gibt es lokal kein Android; gemessen werden kann nur hier.

Kopf eines Patches (vor dem ersten `diff --git`, git apply überliest ihn):

    Gegenprobe: was kaputt gemacht wird
    Modul: core-data
    Test: ch.brickinventoryapp.data.BestandMigrationTest
    Rot: Teil des Testnamens, der scheitern muss      (optional)

Rot heisst: Der Testbericht der Klasse existiert und nennt einen Fehlschlag
(mit `Rot:` genau in diesem Test). Kein Bericht — etwa weil der Patch nicht
übersetzt — zählt NICHT als rot: Dann hat der Test nichts bewiesen.

Aufruf:  python3 tools/gegenproben.py gegenproben
Gradle-Befehl ersetzbar über GEGENPROBE_GRADLE (für den Test dieses Werkzeugs).
Mit GEGENPROBE_BASIS=<Commit> nur die Patches, deren Ziel, Test oder Patch seit
dem Commit geändert ist; ist keiner betroffen, ist das ein Erfolg.
Rückgabe 0 nur, wenn jede Gegenprobe rot war und es mindestens eine gab.
"""
import glob
import os
import re
import shlex
import shutil
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
    # Reine JVM-Module (core-model) haben `test` statt `testDebugUnitTest`.
    skript = os.path.join(projekt, k['Modul'], 'build.gradle.kts')
    text = open(skript, encoding='utf-8').read() if os.path.exists(skript) else ''
    jvm = 'kotlin.jvm' in text or 'jvm.library' in text
    aufgabe = 'test' if jvm else 'testDebugUnitTest'
    bericht = os.path.join(projekt, k['Modul'], 'build', 'test-results', aufgabe, f'TEST-{klasse}.xml')
    if os.path.exists(bericht):
        os.remove(bericht)
    git(wurzel, 'apply', os.path.abspath(patch))
    befehl = gradle + [f':{k["Modul"]}:{aufgabe}', '--rerun', '--tests', klasse]
    try:
        lauf = subprocess.run(befehl, cwd=projekt, capture_output=True, text=True)
        # KSP verliert nach einem Patch in einem Vormodul sporadisch dessen Klassen
        # („… could not be resolved“) oder Hilt findet alte Ausgaben („Attempt to
        # recreate a file“) — in einem frischen Bau nie. Dann einmal mit
        # leerem KSP-Stand wiederholen; ein echter Übersetzungsfehler bleibt rot.
        ausgabe = lauf.stdout + lauf.stderr
        if not os.path.exists(bericht) and ('could not be resolved' in ausgabe
                                            or 'Attempt to recreate a file' in ausgabe):
            for alt in glob.glob(os.path.join(projekt, '*', 'build', 'kspCaches')) + \
                       glob.glob(os.path.join(projekt, '*', 'build', 'generated', 'ksp')):
                shutil.rmtree(alt, ignore_errors=True)
            lauf = subprocess.run(befehl, cwd=projekt, capture_output=True, text=True)
    finally:
        zurueck = git(wurzel, 'apply', '-R', os.path.abspath(patch))
    if zurueck.returncode != 0:
        return False, f'{name}: Patch liess sich nicht zurücknehmen — {zurueck.stderr.strip()}'
    if not os.path.exists(bericht):
        zeilen = (lauf.stdout + lauf.stderr).splitlines()
        # Die eigentliche Ursache (Übersetzer, KSP) steht weit vor Gradles Schlusszeilen.
        ursache = [z for z in zeilen if z.startswith(('e: ', 'w: [ksp]')) or '[ksp]' in z or 'error:' in z][:20]
        ende = '\n'.join(ursache + zeilen[-15:])
        return False, f'{name}: kein Testbericht für {klasse} — der Test lief nicht (übersetzt der Patch?)\n{ende}'.rstrip()
    rot = fehlschlaege(bericht)
    erwartet = k.get('Rot')
    if erwartet and not any(erwartet in t for t in rot):
        return False, f'{name}: „{erwartet}“ blieb grün (rot: {rot or "nichts"}) — {k["Gegenprobe"]}'
    if not rot:
        return False, f'{name}: {klasse} blieb grün — die Gegenprobe „{k["Gegenprobe"]}“ greift nicht'
    return True, f'{name}: rot wie verlangt ({", ".join(rot)}) — {k["Gegenprobe"]}'


def betroffen(projekt, wurzel, patches, basis):
    """Die Patches, die eine seit `basis` geänderte Datei berühren; None, wenn die Basis fehlt."""
    lauf = git(wurzel, 'diff', '--name-only', basis, 'HEAD')
    if lauf.returncode != 0:
        return None
    geaendert = set(lauf.stdout.split())
    vorsilbe = os.path.relpath(projekt, wurzel).replace(os.sep, '/')
    # Die Testhilfen und das Werkzeug selbst tragen jede Gegenprobe.
    if any(p.startswith(vorsilbe + '/core-testing/') or p == vorsilbe + '/tools/gegenproben.py' for p in geaendert):
        return patches
    auswahl = []
    for patch in patches:
        with open(patch, encoding='utf-8') as f:
            ziele = set(re.findall(r'^\+\+\+ b/(\S+)', f.read(), re.M))
        ziele.add(os.path.relpath(os.path.abspath(patch), wurzel).replace(os.sep, '/'))
        k = kopf(patch)
        klasse = k.get('Test', '').rsplit('.', 1)[-1]
        if klasse and k.get('Modul'):
            muster = os.path.join(projekt, k['Modul'], 'src', 'test', '**', klasse + '.kt')
            ziele |= {os.path.relpath(t, wurzel).replace(os.sep, '/') for t in glob.glob(muster, recursive=True)}
        if ziele & geaendert:
            auswahl.append(patch)
    return auswahl


def main():
    ordner = sys.argv[1] if len(sys.argv) > 1 else 'gegenproben'
    projekt = os.path.dirname(os.path.abspath(ordner))
    wurzel = git(projekt, 'rev-parse', '--show-toplevel').stdout.strip()
    # Mit Daemon: Alle Patches eines Teils laufen im selben Gradle, statt je Patch neu zu starten.
    gradle = shlex.split(os.environ.get('GEGENPROBE_GRADLE', './gradlew --no-build-cache -Pksp.incremental=false'))
    patches = sorted(glob.glob(os.path.join(ordner, '*.patch')))
    basis = os.environ.get('GEGENPROBE_BASIS', '').strip()
    if basis and patches:
        auswahl = betroffen(projekt, wurzel, patches, basis)
        if auswahl is None:
            print(f'Basis {basis} unbekannt — alle {len(patches)} Gegenproben.')
        elif not auswahl:
            print(f'Keine der {len(patches)} Gegenproben berührt eine seit {basis[:12]} geänderte Datei.')
            return 0
        else:
            print(f'{len(auswahl)} von {len(patches)} Gegenproben betroffen.')
            patches = auswahl
    # Die CI teilt die Patches auf parallele Jobs (GEGENPROBE_TEIL=„2/4“); jeder
    # nimmt jeden n-ten, so bleibt jeder Teil unter seiner Zeitgrenze.
    if not patches:
        print(f'Keine Gegenproben unter {ordner}/ — ohne sie prüft dieser Schritt nichts.')
        return 1
    teil = os.environ.get('GEGENPROBE_TEIL')
    if teil:
        nr, anzahl = (int(x) for x in teil.split('/'))
        patches = patches[nr - 1::anzahl]
        # Weniger betroffene Patches als Teile: Dieser Teil hat nichts zu messen.
        if not patches:
            print(f'Teil {teil}: keine der betroffenen Gegenproben fällt auf diesen Teil.')
            return 0
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
