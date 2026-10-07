#!/usr/bin/env python3
"""Zaehlt die Warnungen des Uebersetzungslaufs — und laesst sie nicht wachsen.

── Warum es dieses Werkzeug gibt ───────────────────────────────────────────

Auf die Frage „sind alle Warnungen beim Kompilieren geloest" gab es in diesem
Baum keine Antwort, nur zwei Zeilen, die das Gegenteil festlegen:

    app/build.gradle.kts:177   abortOnError     = false
    app/build.gradle.kts:178   warningsAsErrors = false

und `allWarningsAsErrors` fuer Kotlin ist nirgends gesetzt. Es gab also keine
Regel, die Warnungen verbietet — und niemand hat sie je GEZAEHLT. Die Zahl
stand in hunderten Zeilen Gradle-Protokoll, das GitHub nur als Ganzes von
einem Host ausliefert, der aus dieser Umgebung nicht erreichbar ist.

── Warum nicht einfach allWarningsAsErrors = true ──────────────────────────

Weil das den Bau ab der ersten Warnung abbricht, auch bei einer, die aus
generiertem Code kommt (Hilt, KSP) und die niemand hier beheben kann. Eine
Regel, die man danach sofort wieder mit Ausnahmen durchloechern muss, ist
keine. Dieses Werkzeug nimmt den anderen Weg: Es zaehlt, nennt jede Warnung
beim Namen, und wird rot, sobald die Zahl STEIGT. Was da ist, ist damit
sichtbar; was dazukommt, faellt auf.

── Was gezaehlt wird ───────────────────────────────────────────────────────

  Kotlin      Zeilen, die mit „w: " beginnen (kotlinc)
  KSP         dieselben mit „[ksp]" darin — eigene Rubrik, weil sie meist aus
              generiertem Code stammen
  Java        Zeilen mit „: warning:" (javac)
  Gradle      „Deprecated Gradle features were used in this build"
  Lint        aus app/build/reports/lint-results-release.xml, falls vorhanden

Aufruf:  python3 tools/warnungen-zaehlen.py <obergrenze.txt> <log> [<log> …]
Rueckgabe: 0 wenn die Summe die Obergrenze nicht uebersteigt, sonst 1.
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

LINT_BERICHT = "app/build/reports/lint-results-release.xml"

# kotlinc schreibt „w: file:///pfad/Datei.kt:12:7 Text". Der Pfad enthaelt das
# Arbeitsverzeichnis des Runners, das sich von Lauf zu Lauf unterscheidet —
# fuers Zusammenfassen wird er darum abgeschnitten, die Zeilen- und
# Spaltennummer aber BEHALTEN: Sie unterscheidet zwei echte Vorkommen in
# derselben Datei von einem, das zweimal gemeldet wurde.
ORT = re.compile(r"^w:\s*(?:file://)?(\S*?)(:\d+:\d+)?\s+(.*)$")
JAVA_ORT = re.compile(r"^(\S+?)(:\d+)?:\s*warning:\s*(.*)$")


def warnungen(zeilen):
    """(kotlin, ksp, java, gradle) als Listen von (ort, text) — je Stelle EINMAL.

    ── Warum hier entdoppelt wird ──────────────────────────────────────────

    Gezaehlt wird ueber mehrere Protokolle: `assembleRelease` und
    `lintRelease` sind zwei Gradle-Aufrufe, und `lintRelease` UEBERSETZT
    erneut. Dieselbe Warnung an derselben Quelltextstelle erschien damit
    zweimal.

    GEMESSEN an Lauf 37580480952: Das Werkzeug meldete „3x Elvis operator …
    [UpdateFeature.kt, PdfViewerScreen.kt]" — im Quelltext gibt es aber genau
    ZWEI solche Stellen. Eine davon war doppelt gezaehlt. Und „Deprecated
    Gradle features were used in this build" stand zweimal da, obwohl es EIN
    Zustand ist, der von zwei Aufrufen gemeldet wird.

    Eine Warnung ist eine Eigenschaft einer QUELLTEXTSTELLE, nicht eines
    Gradle-Aufrufs. Der Schluessel ist darum Datei + Zeile + Spalte + Text.
    Zwei verschiedene Zeilen derselben Datei bleiben zwei Warnungen.
    """
    gesehen = set()
    kotlin, ksp, java, gradle = [], [], [], []
    for z in zeilen:
        z = z.rstrip("\r\n")
        if z.startswith("w: "):
            m = ORT.match(z)
            if m:
                ort, stelle, text = os.path.basename(m.group(1)), m.group(2) or "", m.group(3)
            else:
                ort, stelle, text = "", "", z[3:]
            schluessel = ("kotlin", ort, stelle, text)
            if schluessel in gesehen:
                continue
            gesehen.add(schluessel)
            (ksp if "[ksp]" in z else kotlin).append((ort, text))
        elif ": warning:" in z:
            m = JAVA_ORT.match(z)
            if m:
                ort, stelle, text = os.path.basename(m.group(1)), m.group(2) or "", m.group(3)
            else:
                ort, stelle, text = "", "", z.split(": warning:", 1)[1].strip()
            schluessel = ("java", ort, stelle, text)
            if schluessel in gesehen:
                continue
            gesehen.add(schluessel)
            java.append((ort, text))
        elif "Deprecated Gradle features were used in this build" in z:
            # Ohne Stelle: EIN Zustand des Baus, egal wie viele Aufrufe ihn
            # melden.
            if ("gradle", "", "", "deprecated") in gesehen:
                continue
            gesehen.add(("gradle", "", "", "deprecated"))
            gradle.append(("", "Deprecated Gradle features were used in this build"))
    return kotlin, ksp, java, gradle


def lint_warnungen():
    if not os.path.exists(LINT_BERICHT):
        return None
    try:
        wurzel = ET.parse(LINT_BERICHT).getroot()
    except ET.ParseError:
        return None
    return sum(1 for k in wurzel.iter("issue") if k.get("severity") == "Warning")


def obergrenze(pfad):
    if not os.path.exists(pfad):
        return None
    for z in open(pfad, encoding="utf-8"):
        z = z.split("#", 1)[0].strip()
        if z.isdigit():
            return int(z)
    return None


def main(argv):
    if len(argv) < 3:
        print("Aufruf: warnungen-zaehlen.py <obergrenze.txt> <log> [<log> …]",
              file=sys.stderr)
        return 2
    grenze_pfad, logs = argv[1], argv[2:]

    zeilen = []
    gelesen = []
    for p in logs:
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                zeilen += f.readlines()
            gelesen.append(p)

    # Selbstnachweis gegen die stille Null: Ohne Protokoll faende dieses
    # Werkzeug keine Warnung und meldete „sauber" — das waere die
    # beruhigendste aller Falschaussagen.
    if not gelesen:
        print("::error::Kein Protokoll gefunden (%s). Ohne Mitschnitt kann hier "
              "nichts gezaehlt werden, und „0 Warnungen\" waere eine "
              "Falschaussage." % ", ".join(logs))
        return 1

    kotlin, ksp, java, gradle = warnungen(zeilen)
    lint = lint_warnungen()
    summe = len(kotlin) + len(ksp) + len(java) + len(gradle)

    print("Protokolle: %s (%d Zeilen)" % (", ".join(gelesen), len(zeilen)))
    for name, liste in (("Kotlin", kotlin), ("KSP", ksp), ("Java", java),
                        ("Gradle", gradle)):
        print("  %-7s %d" % (name, len(liste)))
    print("  %-7s %s" % ("Lint", "—" if lint is None else lint))
    print("  %-7s %d  (ohne Lint)" % ("Summe", summe))

    # Jede Warnung beim Namen — zusammengefasst nach dem TEXT, nicht nach
    # (Datei, Text).
    #
    # Die erste Fassung gruppierte nach beiden, und die Gegenprobe hat es
    # gefangen: „Variable 'a' is never used" in A.kt und in B.kt ergab zwei
    # Zeilen. Genau das, was hier verhindert werden soll — dieselbe Meldung an
    # vierzig Stellen ist EIN Befund mit vierzig Fundorten, nicht vierzig
    # Befunde. Die Fundorte stehen dahinter, damit man sie noch findet.
    gezaehlt = {}
    for ort, text in kotlin + ksp + java + gradle:
        n, orte = gezaehlt.get(text, (0, []))
        if ort and ort not in orte:
            orte.append(ort)
        gezaehlt[text] = (n + 1, orte)

    def faltung(text):
        n, orte = gezaehlt[text]
        wo = ", ".join(orte[:3]) + (" …" if len(orte) > 3 else "")
        return n, wo

    if gezaehlt:
        print("\nIm Einzelnen:")
        for text in sorted(gezaehlt, key=lambda t: -gezaehlt[t][0]):
            n, wo = faltung(text)
            print("  %3dx %s\n        %s" % (n, text, wo or "—"))

    grenze = obergrenze(grenze_pfad)

    # ── Die Annotation trägt IMMER die Liste ────────────────────────────────
    #
    # Die erste Fassung nannte im gruenen Fall nur die Zahl. Damit stand „18
    # Warnungen" am Lauf und WELCHE 18 nur im Protokoll — also dort, wo es aus
    # dieser Umgebung nicht hinkommt (GitHub liefert das Protokoll als Ganzes
    # von einem Host, den der Proxy mit 403 abweist). Eine Zahl ohne die Liste
    # ist aber genau die Auskunft, mit der man nichts anfangen kann: Sie sagt,
    # DASS etwas da ist, und nicht, was zu tun waere.
    zeile = ["Kotlin %d, KSP %d, Java %d, Gradle %d, Summe %d"
             % (len(kotlin), len(ksp), len(java), len(gradle), summe)]
    if lint is not None:
        zeile.append("Lint-Warnungen: %d (nicht in der Summe)" % lint)
    for text in sorted(gezaehlt, key=lambda t: -gezaehlt[t][0])[:15]:
        n, wo = faltung(text)
        zeile.append("  %dx %s%s" % (n, text[:260], (" [" + wo + "]") if wo else ""))
    if len(gezaehlt) > 15:
        zeile.append("  … und %d weitere Arten, vollstaendig im Protokoll."
                     % (len(gezaehlt) - 15))

    if grenze is None:
        # KEIN stilles Durchlassen: Ohne Obergrenze gibt es keinen Riegel, und
        # das muss man sehen.
        zeile.append("In %s steht keine Obergrenze — es gibt derzeit nichts, "
                     "was ein Anwachsen bemerkt." % grenze_pfad)
        print("::warning title=Warnungen::" + "%0A".join(zeile))
        return 0
    if summe > grenze:
        zeile.insert(1, "Obergrenze ist %d — ueberschritten." % grenze)
        print("::error title=Warnungen::" + "%0A".join(zeile))
        return 1
    if summe < grenze:
        zeile.insert(1, "Obergrenze ist %d. Weniger als erlaubt — %s auf %d "
                        "senken, damit der Riegel weiter greift."
                        % (grenze, grenze_pfad, summe))
        print("::warning title=Warnungen::" + "%0A".join(zeile))
        return 0
    zeile.insert(1, "Obergrenze ist %d — genau eingehalten." % grenze)
    print("::notice title=Warnungen::" + "%0A".join(zeile))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
