#!/usr/bin/env python3
"""Prueft die Fassungen in libs.versions.toml gegen die ECHTEN Verzeichnisse.

── Warum es dieses Werkzeug gibt ───────────────────────────────────────────

Die Frage „sind alle Bibliotheken auf der neuesten Fassung" ist dreimal
gestellt worden, und dreimal war ein Teil der Antwort GESCHAETZT statt
gemessen: Die androidx-Zahlen stammten aus einer Dokumentationsseite, weil
Google-Maven aus der Entwicklungsumgebung nicht erreichbar ist
(dl.google.com → HTTP 000, auch ueber den Proxy, und maven.google.com leitet
genau dorthin um).

Der CI-Runner erreicht es sehr wohl — von dort laedt der Build seine
Abhaengigkeiten. Also wird dort gemessen.

Gelesen werden die maschinenlesbaren Verzeichnisse selbst:

  Google-Maven   <host>/<gruppe>/group-index.xml   (alle Artefakte der Gruppe)
  Maven Central  <host>/<pfad>/maven-metadata.xml  (alle Fassungen)

Vorfassungen (alpha, beta, rc, dev, snapshot, eap, M1) zaehlen nicht als
„neueste" — dieses Projekt faehrt Stabiles.

Aufruf:  python3 tools/fassungen-pruefen.py gradle/libs.versions.toml
Rueckgabe: 0, sobald ueberhaupt etwas gemessen wurde — 1 nur, wenn KEINE
einzige Fassung messbar war. Ein Rueckstand faerbt den Lauf also nicht rot:
Das Werkzeug BERICHTET. Ob eine aeltere Fassung richtig ist, entscheidet ein
Mensch — fuer okhttp und coil etwa entschied es `minCompileSdk`, nicht die
Nummer. Rot ist nur der Fall, in dem der Bericht nichts aussagt und trotzdem
beruhigend aussaehe.
"""
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

GOOGLE = "https://dl.google.com/dl/android/maven2"
CENTRAL = "https://repo1.maven.org/maven2"
VOR = re.compile(r"alpha|beta|rc|dev|snapshot|eap|-m\d", re.I)


_gespeichert = {}


def hole(url, versuche=6):
    """Mit Wiederholung: Maven Central drosselt (429), wenn viele Abrufe
    dicht aufeinander folgen — und genau das tut dieses Werkzeug. Ohne
    Wiederholung meldet es „unklar", wo es sehr wohl messen koennte; beim
    ersten Lauf traf das Kotlin, junit und coil, die allesamt auf Central
    liegen."""
    # Ein group-index.xml nennt ALLE Artefakte seiner Gruppe. androidx.camera
    # steht viermal im Katalog, androidx.compose oefter — ohne diesen Speicher
    # holte das Werkzeug dieselbe Datei mehrfach und provozierte die Drosselung,
    # gegen die die Wiederholung unten antritt.
    if url in _gespeichert:
        return _gespeichert[url]
    letzter = None
    for i in range(versuche):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                _gespeichert[url] = r.read()
                return _gespeichert[url]
        except Exception as e:                                # noqa: BLE001
            letzter = e
            if i < versuche - 1:
                time.sleep(4 * (i + 1))
    print("    (nicht abrufbar nach %d Versuchen: %s — %s)" % (versuche, url, letzter))
    _gespeichert[url] = None
    return None


def schluessel(v):
    return [int(t) if t.isdigit() else t for t in re.split(r"[.\-]", v)]


def kleinere(a, b):
    """Die niedrigere zweier Fassungen — None zaehlt als „unbekannt"."""
    if a is None or b is None:
        return a or b
    try:
        return a if schluessel(a) <= schluessel(b) else b
    except TypeError:
        return min(a, b)


def stabil(fassungen):
    """Hoechste stabile Fassung, nach Zahlenteilen sortiert."""
    rein = [v for v in fassungen if not VOR.search(v)]
    if not rein:
        return None
    try:
        return max(rein, key=schluessel)
    except TypeError:
        # Gemischte Typen (etwa "2026.08.00" neben "1.0"): dann lexikalisch,
        # was bei gleich langen Nummernschemata dasselbe Ergebnis gibt.
        return max(rein)


def google(gruppe, artefakt):
    roh = hole("%s/%s/group-index.xml" % (GOOGLE, gruppe.replace(".", "/")))
    if roh is None:
        return None
    wurzel = ET.fromstring(roh)
    for kind in wurzel:
        if kind.tag == artefakt:
            return stabil((kind.get("versions") or "").split(","))
    print("    (Artefakt %s nicht in der Gruppe %s)" % (artefakt, gruppe))
    return None


def central(gruppe, artefakt):
    roh = hole("%s/%s/%s/maven-metadata.xml" % (CENTRAL, gruppe.replace(".", "/"), artefakt))
    if roh is None:
        return None
    wurzel = ET.fromstring(roh)
    return stabil([v.text for v in wurzel.iter("version") if v.text])


def main():
    if len(sys.argv) != 2:
        print("Aufruf: fassungen-pruefen.py <libs.versions.toml>", file=sys.stderr)
        return 2
    try:
        import tomllib
    except ImportError:
        import tomli as tomllib                               # type: ignore
    with open(sys.argv[1], "rb") as f:
        d = tomllib.load(f)
    fassungen = d["versions"]

    # ALLE Koordinaten je Fassungs-Referenz, nicht nur die erste.
    #
    # `camerax` steht an vier Artefakten, `hilt` an dreien. Eine gemeinsame
    # Nummer kann nur dorthin steigen, wo sie JEDES dieser Artefakte auch gibt
    # — fragte man nur das erste, meldete das Werkzeug ein Ziel, an dem der
    # Build zerbricht. Darum unten das Minimum ueber alle.
    koord = {}
    def merke(ref, gruppe, artefakt):
        if ref:
            koord.setdefault(ref, [])
            if (gruppe, artefakt) not in koord[ref]:
                koord[ref].append((gruppe, artefakt))
    for lib in d.get("libraries", {}).values():
        v = lib.get("version")
        merke(v.get("ref") if isinstance(v, dict) else None, lib["group"], lib["name"])
    for pl in d.get("plugins", {}).values():
        v = pl.get("version")
        merke(v.get("ref") if isinstance(v, dict) else None, pl["id"], pl["id"] + ".gradle.plugin")

    GOOGLE_GRUPPEN = ("androidx.", "com.android.", "com.google.android.", "com.google.mlkit")
    hinterher, aktuell, unklar, voraus = [], [], [], []

    for ref in sorted(fassungen):
        ist = fassungen[ref]
        if ref not in koord:
            unklar.append((ref, ist, "keine Bibliothek benutzt diese Referenz"))
            continue
        print("%-30s %s" % (ref, ist))
        neu_gemeinsam, luecke = None, False
        for gruppe, artefakt in koord[ref]:
            gefunden = (google(gruppe, artefakt) if gruppe.startswith(GOOGLE_GRUPPEN)
                        else central(gruppe, artefakt))
            print("    %s:%s → %s" % (gruppe, artefakt, gefunden))
            if gefunden is None:
                luecke = True
                continue
            neu_gemeinsam = (gefunden if neu_gemeinsam is None
                             else kleinere(neu_gemeinsam, gefunden))
        if neu_gemeinsam is None:
            unklar.append((ref, ist, "Verzeichnis nicht lesbar"))
        elif luecke:
            unklar.append((ref, ist, "nur ein Teil der Artefakte lesbar (hoechstens %s)" % neu_gemeinsam))
        elif neu_gemeinsam == ist:
            aktuell.append((ref, ist))
        elif kleinere(ist, neu_gemeinsam) == neu_gemeinsam:
            # Die eingetragene Nummer liegt ueber der hoechsten STABILEN im
            # Verzeichnis. Das ist kein Rueckstand, sondern ein Hinweis: meist
            # eine Vorfassung, manchmal ein Tippfehler. Beides will ein Mensch
            # sehen, aber keines davon ist „hinterher".
            voraus.append((ref, ist, neu_gemeinsam))
        else:
            hinterher.append((ref, ist, neu_gemeinsam))

    print("\n" + "=" * 68)
    print("AKTUELL (%d) — eingetragene Nummer ist die hoechste stabile:" % len(aktuell))
    for ref, v in aktuell:
        print("  %-30s %s" % (ref, v))
    print("\nHINTERHER (%d) — es gibt eine hoehere stabile Fassung:" % len(hinterher))
    for ref, ist, n in hinterher:
        print("  %-30s %-14s → %s" % (ref, ist, n))
    print("\nVORAUS (%d) — eingetragen ist mehr als das Verzeichnis stabil kennt:" % len(voraus))
    for ref, ist, n in voraus:
        print("  %-30s %-14s hoechste stabile: %s" % (ref, ist, n))
    print("\nUNKLAR (%d) — nicht gemessen, also auch nicht behauptet:" % len(unklar))
    for ref, ist, warum in unklar:
        print("  %-30s %-14s %s" % (ref, ist, warum))

    # ── Derselbe Befund als Annotation ──────────────────────────────────────
    #
    # Ein Bericht, der nur im Log steht, liest sich niemand: Das Log dieses
    # Laufs hat ueber tausend Zeilen, und der Bericht liegt irgendwo in der
    # Mitte. Eine Annotation steht oben auf der Lauf-Seite und ist ueber die
    # API einzeln abrufbar, ohne das ganze Log zu holen.
    #
    # ALLES in EINER Annotation, nicht eine je Bibliothek: GitHub zeigt je
    # Schritt und Stufe hoechstens zehn an und verschluckt den Rest
    # stillschweigend — bei rund dreissig Fassungen waere der Bericht damit
    # unvollstaendig, ohne dass es jemand saehe. %0A ist der Zeilenumbruch
    # innerhalb einer Annotation.
    def zeilen(titel, eintraege):
        return [titel] + ["  " + e for e in eintraege]

    offen = []
    offen += zeilen("HINTERHER:", ["%s %s -> %s" % (r, i, n) for r, i, n in hinterher]) if hinterher else []
    offen += zeilen("VORAUS (eingetragen > hoechste stabile):",
                    ["%s %s, Verzeichnis kennt %s" % (r, i, n) for r, i, n in voraus]) if voraus else []
    offen += zeilen("UNKLAR (nicht gemessen):",
                    ["%s %s — %s" % (r, i, w) for r, i, w in unklar]) if unklar else []
    if offen:
        print("::warning title=Fassungen::" + "%0A".join(offen))
    else:
        print("::notice title=Fassungen::Jede gemessene Fassung ist die "
              "hoechste stabile.")
    print("::notice title=Fassungen gemessen::aktuell %d, hinterher %d, "
          "voraus %d, unklar %d"
          % (len(aktuell), len(hinterher), len(voraus), len(unklar)))

    # Selbstnachweis gegen die stille Null: Misst das Werkzeug gar nichts —
    # kein Netz, falsche Datei —, stuenden oben vier leere Listen und der
    # Bericht saehe aus wie „nichts zu tun".
    gemessen = len(aktuell) + len(hinterher) + len(voraus)
    if gemessen == 0:
        print("\n::error::Keine einzige Fassung konnte gemessen werden — dieser "
              "Bericht sagt nichts aus.")
        return 1
    print("\n%d von %d Fassungen gemessen." % (gemessen, len(fassungen)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
