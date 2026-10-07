#!/usr/bin/env python3
"""Zaehlt die Lint-Befunde — benennt sie und laesst sie nicht wachsen.

── Warum es dieses Werkzeug gibt ───────────────────────────────────────────

tools/warnungen-zaehlen.py meldet seit Lauf 37580480952 „Lint-Warnungen: 58
(nicht in der Summe)". Eine Zahl, sonst nichts: WELCHE 58 stand nur im
XML-Bericht, und der liegt als Artefakt in einer Ablage, die der Proxy dieser
Entwicklungsumgebung mit 403 abweist. Damit war die Zahl nicht handhabbar —
sie sagte, DASS etwas da ist, nicht was zu tun waere.

Dazu kommt, dass Lint hier ausdruecklich nichts erzwingt:

    app/build.gradle.kts   abortOnError     = false
    app/build.gradle.kts   warningsAsErrors = false

Das ist richtig so (ein Lint-Befund soll den Bau nicht abbrechen), heisst aber
auch: Es gab nichts, was ein Anwachsen bemerkt.

── Warum keine Baseline ────────────────────────────────────────────────────

Der naheliegende Weg waere `lint { baseline = file("lint-baseline.xml") }`.
Das ist hier bewusst NICHT der Weg: Eine Baseline macht bestehende Befunde
unsichtbar. Sie stehen dann in einer Datei, die niemand liest, und
verschwinden aus jedem Bericht — man sieht nicht mehr, dass es sie gibt, und
also auch nicht, dass man sie beheben koennte.

Dieses Werkzeug macht das Gegenteil: Es NENNT jeden Befund, gruppiert nach
Prueferkennung, mit Anzahl und Fundorten — und wird rot, sobald die Summe
steigt. Was da ist, bleibt sichtbar; was dazukommt, faellt auf.

── Was gelesen wird ────────────────────────────────────────────────────────

app/build/reports/lint-results-release.xml, der Bericht, den AGP ohnehin
erzeugt. Gezaehlt werden die Eintraege mit severity="Warning"; Error und
Fatal werden getrennt gemeldet, denn die gehoeren nicht unter eine
Warnungs-Obergrenze — bei denen ist die richtige Zahl null.

Aufruf:  python3 tools/lint-zaehlen.py <obergrenze.txt> <lint-results.xml>
Rueckgabe: 0 wenn die Warnungen die Obergrenze nicht uebersteigen und es
keinen Error/Fatal gibt, sonst 1.
"""
import os
import sys
import xml.etree.ElementTree as ET


def obergrenze(pfad):
    if not os.path.exists(pfad):
        return None
    for z in open(pfad, encoding="utf-8"):
        z = z.split("#", 1)[0].strip()
        if z.isdigit():
            return int(z)
    return None


def lies(pfad):
    """{stufe: [(kennung, beschreibung, [fundorte])]} aus dem Lint-XML."""
    wurzel = ET.parse(pfad).getroot()
    nach_stufe = {}
    for k in wurzel.iter("issue"):
        stufe = k.get("severity") or "?"
        kennung = k.get("id") or "?"
        text = (k.get("message") or "").strip()
        orte = []
        for ort in k.iter("location"):
            datei = os.path.basename(ort.get("file") or "")
            zeile = ort.get("line")
            orte.append(datei + (":" + zeile if zeile else ""))
        nach_stufe.setdefault(stufe, []).append((kennung, text, orte))
    return nach_stufe


def main(argv):
    if len(argv) != 3:
        print("Aufruf: lint-zaehlen.py <obergrenze.txt> <lint-results.xml>",
              file=sys.stderr)
        return 2
    grenze_pfad, bericht = argv[1], argv[2]

    # Selbstnachweis gegen die stille Null: Ohne Bericht faende dieses Werkzeug
    # keinen Befund und meldete „sauber" — die beruhigendste aller
    # Falschaussagen.
    if not os.path.exists(bericht):
        print("::error::%s fehlt. Ohne den Bericht kann hier nichts gezaehlt "
              "werden, und „0 Lint-Warnungen\" waere eine Falschaussage. Lief "
              "der Lint-Schritt?" % bericht)
        return 1
    try:
        nach_stufe = lies(bericht)
    except ET.ParseError as e:
        print("::error::%s ist nicht lesbar (%s)." % (bericht, e))
        return 1

    warnungen = nach_stufe.get("Warning", [])
    schlimme = nach_stufe.get("Error", []) + nach_stufe.get("Fatal", [])
    rest = {s: len(v) for s, v in nach_stufe.items()
            if s not in ("Warning", "Error", "Fatal")}

    print("%s" % bericht)
    for stufe in sorted(nach_stufe):
        print("  %-13s %d" % (stufe, len(nach_stufe[stufe])))

    # Nach Prueferkennung gruppieren: „58 Warnungen" ist unbrauchbar,
    # „38x UnusedResources, 7x OldTargetApi, …" ist eine Arbeitsliste.
    def gruppiere(liste):
        g = {}
        for kennung, text, orte in liste:
            n, o, bsp = g.get(kennung, (0, [], text))
            for ort in orte:
                if ort and ort not in o:
                    o.append(ort)
            g[kennung] = (n + 1, o, bsp)
        return g

    gruppen = gruppiere(warnungen)
    if gruppen:
        print("\nWarnungen nach Prueferkennung:")
        for kennung in sorted(gruppen, key=lambda k: -gruppen[k][0]):
            n, orte, bsp = gruppen[kennung]
            print("  %3dx %-28s %s" % (n, kennung, ", ".join(orte[:4])
                                       + (" …" if len(orte) > 4 else "")))
            print("       %s" % bsp[:160])

    zeile = ["Warnungen %d" % len(warnungen)]
    if rest:
        zeile.append("ausserdem: " + ", ".join("%s %d" % (s, n) for s, n in sorted(rest.items())))
    for kennung in sorted(gruppen, key=lambda k: -gruppen[k][0])[:20]:
        n, orte, bsp = gruppen[kennung]
        zeile.append("  %dx %s — %s" % (n, kennung, bsp[:120]))
    if len(gruppen) > 20:
        zeile.append("  … und %d weitere Kennungen, vollstaendig im Protokoll."
                     % (len(gruppen) - 20))

    # Error und Fatal gehoeren NICHT unter eine Warnungs-Obergrenze: Da ist die
    # richtige Zahl null, und sie unter einer Summe zu verstecken waere genau
    # die Art Riegel, die nichts haelt.
    if schlimme:
        hart = ["%d Lint-Befund(e) der Stufe Error/Fatal — die gehoeren nicht "
                "unter eine Obergrenze." % len(schlimme)]
        for kennung, text, orte in schlimme[:10]:
            hart.append("  %s — %s [%s]" % (kennung, text[:120], ", ".join(orte[:3])))
        print("::error title=Lint::" + "%0A".join(hart))
        return 1

    grenze = obergrenze(grenze_pfad)
    if grenze is None:
        zeile.append("In %s steht keine Obergrenze — es gibt derzeit nichts, "
                     "was ein Anwachsen bemerkt." % grenze_pfad)
        print("::warning title=Lint::" + "%0A".join(zeile))
        return 0
    if len(warnungen) > grenze:
        zeile.insert(1, "Obergrenze ist %d — ueberschritten." % grenze)
        print("::error title=Lint::" + "%0A".join(zeile))
        return 1
    if len(warnungen) < grenze:
        zeile.insert(1, "Obergrenze ist %d. Weniger als erlaubt — %s auf %d "
                        "senken, damit der Riegel weiter greift."
                        % (grenze, grenze_pfad, len(warnungen)))
        print("::warning title=Lint::" + "%0A".join(zeile))
        return 0
    zeile.insert(1, "Obergrenze ist %d — genau eingehalten." % grenze)
    print("::notice title=Lint::" + "%0A".join(zeile))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
