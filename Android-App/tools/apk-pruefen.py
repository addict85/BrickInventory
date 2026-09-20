#!/usr/bin/env python3
"""Prueft das FERTIGE Release-APK auf das, was R8 weggeschrumpft haben kann.

── Warum es diese Pruefung gibt ────────────────────────────────────────────

Im Release-APK von main (120c998) stand:

    Lch/brickinventoryapp/alarm/PreisalarmWorker;
       direkt   (1): <init>
       virtuell (0):

doWork() fehlte. Der Preisalarm konnte auf keinem Geraet laufen — und alle
470 Unit-Tests waren gruen, weil sie auf der JVM laufen und R8 dort nie
stattfindet. Zwischen "uebersetzt" und "tut etwas" lag niemand.

Die beiden Strings des Benachrichtigungskanals verschwanden gleich mit: Der
Ressourcen-Schrumpfer fand keine Referenz mehr, weil der referenzierende
Code weg war. Er hatte recht — die Ursache lag eine Stufe davor.

── Was geprueft wird ───────────────────────────────────────────────────────

1. Jede eigene Klasse, die von androidx.work erbt, muss doWork() haben.
   Der NAME ueberlebt das Umbenennen, weil er eine Framework-Methode
   ueberschreibt — genau deshalb ist er als Anker brauchbar.

2. Jeder im Kotlin-Quelltext benutzte R.string.X muss im APK stehen.
   Ein fehlender wirft Resources.NotFoundException, und zwar erst auf dem
   Geraet.

Aufruf: apk-pruefen.py <app.apk> <quellverzeichnis>
"""
import re
import struct
import sys
import zipfile
from pathlib import Path

EIGEN = 'Lch/brickinventoryapp/'
ERBE  = 'Landroidx/work/'


class Dex:
    """So viel DEX-Format, wie fuer die beiden Fragen noetig ist."""

    def __init__(self, roh: bytes):
        self.d = roh
        self.string_ids = self.u32(0x3C)
        self.type_ids = self.u32(0x44)
        self.method_ids = self.u32(0x5C)
        self.class_defs_size = self.u32(0x60)
        self.class_defs = self.u32(0x64)

    def u32(self, o): return struct.unpack('<I', self.d[o:o + 4])[0]

    def uleb(self, o):
        r = s = 0
        while True:
            b = self.d[o]
            o += 1
            r |= (b & 0x7F) << s
            s += 7
            if not b & 0x80:
                return r, o

    def s(self, i):
        off = self.u32(self.string_ids + 4 * i)
        n, off = self.uleb(off)
        return self.d[off:off + n * 4].split(b'\x00')[0].decode('utf-8', 'replace')

    def typ(self, i): return self.s(self.u32(self.type_ids + 4 * i))

    def klassen(self):
        """(name, oberklasse, [methodennamen]) je definierter Klasse."""
        for i in range(self.class_defs_size):
            o = self.class_defs + i * 32
            name = self.typ(self.u32(o))
            ober = self.typ(self.u32(o + 8))
            daten = self.u32(o + 24)
            methoden = []
            if daten:
                p = daten
                sf, p = self.uleb(p)
                inf, p = self.uleb(p)
                dm, p = self.uleb(p)
                vm, p = self.uleb(p)
                for _ in range(sf + inf):
                    _a, p = self.uleb(p)
                    _b, p = self.uleb(p)
                for anzahl in (dm, vm):
                    midx = 0
                    for _ in range(anzahl):
                        di, p = self.uleb(p)
                        _acc, p = self.uleb(p)
                        _code, p = self.uleb(p)
                        midx += di
                        methoden.append(self.s(self.u32(self.method_ids + midx * 8 + 4)))
            yield name, ober, methoden


def fehler(text: str) -> None:
    print(f'::error title=APK-Pruefung::{text}')


def main() -> int:
    apk, quelle = Path(sys.argv[1]), Path(sys.argv[2])
    z = zipfile.ZipFile(apk)
    schlimm = []

    # ── 1. Worker mit doWork ────────────────────────────────────────────────
    worker = {}
    for eintrag in z.namelist():
        if not re.fullmatch(r'classes\d*\.dex', eintrag):
            continue
        for name, ober, methoden in Dex(z.read(eintrag)).klassen():
            if name.startswith(EIGEN) and ober.startswith(ERBE):
                worker[name] = methoden

    if not worker:
        schlimm.append(
            'Keine eigene Worker-Klasse im APK gefunden. Entweder wurde der '
            'Preisalarm entfernt — dann gehoert diese Pruefung mit weg — oder '
            'R8 hat die Klasse ganz verworfen.')
    for name, methoden in sorted(worker.items()):
        if 'doWork' in methoden:
            print(f'  OK   {name}  ({len(methoden)} Methoden, doWork vorhanden)')
        else:
            schlimm.append(
                f'{name} hat kein doWork() — R8 hat es weggeschrumpft. Die '
                f'Keep-Regel von WorkManager nennt nur den Konstruktor; der '
                f'Rest braucht eine eigene Regel in proguard-rules.pro. '
                f'Uebrig: {", ".join(methoden) or "nichts ausser der Klasse"}')

    # ── 2. Benutzte Strings muessen im APK stehen ───────────────────────────
    arsc = z.read('resources.arsc')
    benutzt = {}
    for kt in quelle.rglob('*.kt'):
        for treffer in re.finditer(r'R\.string\.([a-z0-9_]+)', kt.read_text(encoding='utf-8')):
            benutzt.setdefault(treffer.group(1), kt.name)

    fehlend = [(n, w) for n, w in sorted(benutzt.items())
               if re.search(rb'(?<![a-z0-9_])' + n.encode() + rb'(?![a-z0-9_])', arsc) is None]
    print(f'  {len(benutzt)} benutzte Strings geprueft, {len(fehlend)} fehlen im APK')
    for name, woher in fehlend:
        schlimm.append(
            f'R.string.{name} wird in {woher} benutzt, steht aber nicht in '
            f'resources.arsc — auf dem Geraet gibt das Resources.NotFoundException. '
            f'Meist Folge davon, dass R8 den benutzenden Code entfernt hat.')

    for t in schlimm:
        fehler(t)
    if schlimm:
        print(f'\nAPK-Pruefung: {len(schlimm)} Befund(e).')
        return 1
    print('\nAPK-Pruefung: nichts zu beanstanden.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
