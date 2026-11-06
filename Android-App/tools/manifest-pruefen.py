#!/usr/bin/env python3
"""Prueft das zusammengefuehrte Manifest des fertigen Release-APK (sec16 N7).

Gelesen wird die Ausgabe von `aapt2 dump xmltree --file AndroidManifest.xml <apk>`:
Bibliotheken bringen eigene Komponenten mit (WorkManager, Profileinstaller, Glance),
und eine neue Fassung mit einer exportierten Komponente faellt im Quelltext nicht auf.

Rot (Rueckgabe 1), wenn
  - die Anwendung debuggable oder testOnly ist, allowBackup nicht false oder Klartext erlaubt,
  - eine exportierte Komponente nicht in tools/manifest-exportiert.txt steht oder
    dort eine andere Berechtigung verlangt als im APK,
  - das APK eine Berechtigung verlangt, die nicht in tools/manifest-berechtigungen.txt
    steht (sec17 B-N12: etwa READ_PHONE_STATE aus einer neuen Bibliotheksfassung).

Aufruf: manifest-pruefen.py <xmltree.txt> <positivliste.txt> <berechtigungen.txt>
"""
import re
import sys

ANDROID = 'http://schemas.android.com/apk/res/android:'
KOMPONENTEN = ('activity', 'activity-alias', 'service', 'receiver', 'provider')
WAHR = ('true', '0xffffffff', '(type 0x12)0xffffffff')


def baum(text):
    """Elemente als (name, attribute, kinder), aus den Einrueckungen von aapt2."""
    wurzel = ('', {}, [])
    stapel = [(-1, wurzel)]
    for zeile in text.splitlines():
        tiefe = len(zeile) - len(zeile.lstrip(' '))
        z = zeile.strip()
        if z.startswith('E: '):
            el = (z[3:].split(' ')[0], {}, [])
            while stapel[-1][0] >= tiefe:
                stapel.pop()
            stapel[-1][1][2].append(el)
            stapel.append((tiefe, el))
        elif z.startswith('A: '):
            m = re.match(r'A: (?:[^=]*:)?([\w]+)(?:\(0x[0-9a-f]+\))?=(.*)$', z)
            if m:
                wert = m.group(2)
                s = re.match(r'"([^"]*)"', wert)
                stapel[-1][1][1][m.group(1)] = s.group(1) if s else wert.strip()
    return wurzel


def alle(el, name):
    for k in el[2]:
        if k[0] == name:
            yield k
        yield from alle(k, name)


def positivliste(pfad):
    erlaubt = {}
    for zeile in open(pfad, encoding='utf-8'):
        zeile = zeile.split('#', 1)[0].strip()
        if zeile:
            name, _, recht = zeile.partition(' ')
            erlaubt[name] = recht.strip() or None
    return erlaubt


def berechtigungen(pfad):
    return {z.split('#', 1)[0].strip() for z in open(pfad, encoding='utf-8')} - {''}


def pruefe(xmltree, erlaubt, rechte=frozenset()):
    w = baum(xmltree)
    apps = list(alle(w, 'application'))
    if len(apps) != 1:
        return ['kein <application> im Manifest gefunden — Format von aapt2 geaendert?']
    app = apps[0][1]
    fehler = []
    if app.get('debuggable') in WAHR:
        fehler.append('android:debuggable ist gesetzt')
    if app.get('testOnly') in WAHR:
        fehler.append('android:testOnly ist gesetzt')
    for art in ('uses-permission', 'uses-permission-sdk-23'):
        for el in alle(w, art):
            name = el[1].get('name', '?')
            if name not in rechte:
                fehler.append(f'{art} {name} steht nicht in tools/manifest-berechtigungen.txt')
    if app.get('allowBackup') not in ('false', '0x0', '(type 0x12)0x0'):
        fehler.append(f'android:allowBackup ist nicht false ({app.get("allowBackup")})')
    if app.get('usesCleartextTraffic') in WAHR:
        fehler.append('android:usesCleartextTraffic ist an')
    gesehen = 0
    for art in KOMPONENTEN:
        for el in alle(apps[0], art):
            gesehen += 1
            a = el[1]
            if a.get('exported') not in WAHR:
                continue
            name, recht = a.get('name', '?'), a.get('permission')
            if name not in erlaubt:
                fehler.append(f'{art} {name} ist exportiert und steht nicht in der Positivliste (Berechtigung {recht})')
            elif erlaubt[name] != recht:
                fehler.append(f'{art} {name}: verlangt {recht}, erwartet {erlaubt[name]}')
    if gesehen == 0:
        fehler.append('keine Komponente gefunden — Format von aapt2 geaendert?')
    return fehler


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    fehler = pruefe(open(sys.argv[1], encoding='utf-8').read(), positivliste(sys.argv[2]),
                    berechtigungen(sys.argv[3]))
    for f in fehler:
        print(f'::error title=Manifest::{f}')
    print('Manifest in Ordnung' if not fehler else f'{len(fehler)} Befund(e) im Manifest')
    return 1 if fehler else 0


if __name__ == '__main__':
    sys.exit(main())
