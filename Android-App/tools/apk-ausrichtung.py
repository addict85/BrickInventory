#!/usr/bin/env python3
"""16-KB-Speicherseiten: Misst die Ausrichtung der nativen Bibliotheken im APK.

── Warum es dieses Werkzeug gibt ───────────────────────────────────────────

Bis jetzt stand die 16-KB-Tauglichkeit auf einer ZAHL: `datastore = "1.1.7"`,
abgesichert durch eine Textpruefung (SixteenKbAlignmentTest), die genau diese
Nummer verlangte. Die Begruendung daneben hielt fest, 1.2.0 sei wieder
4-KB-ausgerichtet.

Das hat zwei Luecken, und beide sind grundsaetzlich:

  1. Es prueft die NUMMER, nicht die Ausrichtung. Richtet Google eine spaetere
     Fassung wieder aus, bleibt der Riegel trotzdem zu — und niemand merkt es.
     Faellt eine ANDERE Bibliothek zurueck, merkt es erst recht niemand.
  2. Ob eine bestimmte Fassung ausgerichtet ist, laesst sich in der
     Entwicklungsumgebung dieses Projekts gar nicht nachsehen: Die AARs liegen
     auf dl.google.com, und das ist von dort nicht erreichbar.

Dieses Werkzeug misst stattdessen das ERGEBNIS — dieselbe Umkehrung wie bei
tools/apk-pruefen.py, das nicht den Quelltext liest, sondern das APK, das
gleich hochgeladen wird.

── Was gemessen wird ───────────────────────────────────────────────────────

Jede `lib/<abi>/*.so` im APK ist eine ELF-Datei. Ihre Programm-Koepfe
beschreiben Segmente; die vom Typ PT_LOAD (1) tragen ein Ausrichtungsfeld
`p_align`. Ist das kleiner als 16384, kann Android die Bibliothek auf einem
Geraet mit 16-KB-Speicherseiten nicht laden.

Gelesen wird direkt aus dem Zip-Eintrag, ohne Entpacken und ohne fremde
Werkzeuge: Das APK ist ein Zip, ELF ist ein dokumentiertes Format, und beides
kann die Standardbibliothek.

── Warum nur die 64-Bit-Bibliotheken zaehlen ───────────────────────────────

Die erste Fassung dieses Werkzeugs verlangte 16 KB von JEDER Bibliothek. Der
Lauf 37531717086 hat gezeigt, dass das zu streng ist — er meldete rot fuer

    lib/x86/libmlkit_google_ocr_pipeline.so          p_align=4096
    lib/armeabi-v7a/libmlkit_google_ocr_pipeline.so  p_align=4096

und fuer KEINE einzige 64-Bit-Bibliothek. Das ist kein Mangel von ML Kit: Die
16-KB-Speicherseiten gibt es nur auf 64-Bit-Kernen. Ein 32-Bit-Android-Kern
kennt diese Seitengroesse nicht, also kann eine 32-Bit-Bibliothek dort auch
nicht daran scheitern. Google verlangt die Ausrichtung entsprechend nur fuer
arm64-v8a und x86_64.

Unterschieden wird hier NICHT am Verzeichnisnamen, sondern am ELF-Kopf
(e_ident[EI_CLASS]). Eine Liste erlaubter Verzeichnisse muesste gepflegt
werden, sobald Android eine weitere 64-Bit-Architektur bekommt — der Kopf der
Datei sagt es von selbst, und er ist die Eigenschaft, auf die es ankommt.

Aufruf:  python3 tools/apk-ausrichtung.py <pfad-zum-apk>
Rueckgabe: 0 wenn jede 64-Bit-Bibliothek ab 16 KB ausgerichtet ist, sonst 1.
"""
import struct
import sys
import zipfile

SEITE = 16 * 1024
PT_LOAD = 1


def ausrichtung(daten):
    """(ist64, groesste p_align aller PT_LOAD) — oder None, wenn kein ELF."""
    if len(daten) < 64 or daten[:4] != b"\x7fELF":
        return None
    # e_ident[EI_CLASS]: 1 = 32 Bit, 2 = 64 Bit. Die Koepfe unterscheiden sich
    # in Breite UND Lage der Felder, deshalb zwei Zweige statt einer Formel.
    ist64 = daten[4] == 2
    klein = "<" if daten[5] == 1 else ">"

    if ist64:
        e_phoff, = struct.unpack_from(klein + "Q", daten, 0x20)
        e_phentsize, e_phnum = struct.unpack_from(klein + "HH", daten, 0x36)
    else:
        e_phoff, = struct.unpack_from(klein + "I", daten, 0x1C)
        e_phentsize, e_phnum = struct.unpack_from(klein + "HH", daten, 0x2A)

    groesste = 0
    for i in range(e_phnum):
        off = e_phoff + i * e_phentsize
        if off + e_phentsize > len(daten):
            break
        p_type, = struct.unpack_from(klein + "I", daten, off)
        if p_type != PT_LOAD:
            continue
        # p_align ist das LETZTE Feld des Programm-Kopfes: bei 64 Bit an
        # Versatz 0x30 (8 Byte), bei 32 Bit an 0x1C (4 Byte).
        if ist64:
            p_align, = struct.unpack_from(klein + "Q", daten, off + 0x30)
        else:
            p_align, = struct.unpack_from(klein + "I", daten, off + 0x1C)
        groesste = max(groesste, p_align)
    return ist64, groesste


def main():
    if len(sys.argv) != 2:
        print("Aufruf: apk-ausrichtung.py <apk>", file=sys.stderr)
        return 2
    apk = sys.argv[1]

    schlecht, gut, befreit = [], [], []
    with zipfile.ZipFile(apk) as z:
        namen = [n for n in z.namelist() if n.startswith("lib/") and n.endswith(".so")]
        for name in sorted(namen):
            with z.open(name) as f:
                gemessen = ausrichtung(f.read())
            if gemessen is None:
                print("::warning::%s ist keine lesbare ELF-Datei — uebersprungen" % name)
                continue
            ist64, a = gemessen
            if not ist64:
                befreit.append((name, a))
            elif a >= SEITE:
                gut.append((name, a))
            else:
                schlecht.append((name, a))

    # Selbstnachweis gegen die stille Null: Gezaehlt werden nur die
    # 64-Bit-Bibliotheken. Findet die Suche keine einzige, haette die Pruefung
    # darunter nichts gemessen und waere trotzdem gruen — der Fall muss rot
    # sein, nicht still. Dass 32-Bit-Dateien dabei waren, hilft nicht: Genau
    # die sind ja ausgenommen.
    if not gut and not schlecht:
        print("::error::Keine native 64-Bit-Bibliothek im APK gefunden — die "
              "Pruefung liefe ins Leere. Entweder ist der Pfad falsch, das "
              "Muster `lib/*/*.so` trifft nicht mehr, oder das APK enthaelt "
              "keine 64-Bit-Architektur mehr (%d 32-Bit-Dateien gesehen)."
              % len(befreit))
        return 1

    for name, a in gut:
        print("  ok   %s  p_align=%d" % (name, a))
    for name, a in befreit:
        # Nicht „ok": Hier wurde nichts bestanden, sondern nichts verlangt.
        # Der Unterschied steht im Wort, nicht in einer Farbe.
        print("  --   %s  p_align=%d  (32 Bit, 16 KB gilt dort nicht)" % (name, a))
    for name, a in schlecht:
        print("::error::%s ist auf %d Byte ausgerichtet, noetig sind %d. Auf "
              "einem Geraet mit 16-KB-Speicherseiten laedt diese Bibliothek "
              "nicht." % (name, a, SEITE))

    print("\n%d von %d 64-Bit-Bibliotheken ausgerichtet, %d nicht; "
          "%d 32-Bit-Bibliotheken ausgenommen."
          % (len(gut), len(gut) + len(schlecht), len(schlecht), len(befreit)))
    return 1 if schlecht else 0


if __name__ == "__main__":
    sys.exit(main())
