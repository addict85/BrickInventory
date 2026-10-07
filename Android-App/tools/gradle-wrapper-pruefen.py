#!/usr/bin/env python3
"""Prueft die festgenagelte Gradle-Pruefsumme gegen die amtliche.

── Warum es dieses Werkzeug gibt ───────────────────────────────────────────

gradle-wrapper.properties nagelt die Verteilung auf eine Pruefsumme fest:

    distributionUrl=…/gradle-9.6.1-bin.zip
    distributionSha256Sum=9c0f7fae…

Das ist der Riegel, der verhindert, dass ein ausgetauschtes Archiv den Build
uebernimmt. Nur: Ob die Zahl daneben die RICHTIGE ist, hat nie etwas geprueft.
Eine beim Heben verdrehte Ziffer bricht den Build sofort und laut — eine
Pruefsumme, die zu einem FREMDEN Archiv passt, nicht.

Dazu kommt ein praktischer Grund. Die Pruefsumme liegt auf
downloads.gradle.org, und das ist aus der Entwicklungsumgebung dieses Projekts
nicht erreichbar (HTTP 000; services.gradle.org leitet dorthin um). Wer die
Fassung heben will, kann die Zahl von dort also nicht holen und darf sie auf
keinen Fall erfinden. Der CI-Runner erreicht es — dasselbe Muster wie bei
tools/fassungen-pruefen.py.

── Was gemeldet wird ───────────────────────────────────────────────────────

  1. Stimmt die festgenagelte Pruefsumme mit der amtlichen fuer die
     festgenagelte Fassung ueberein? Wenn nicht: rot.
  2. Welche Fassung ist die neueste, und wie lautet IHRE Pruefsumme? Das ist
     die Zahl, die man zum Heben braucht. Nur ein Hinweis, nie rot — ob
     gehoben wird, entscheidet ein Mensch.

Aufruf:  python3 tools/gradle-wrapper-pruefen.py gradle/wrapper/gradle-wrapper.properties
Rueckgabe: 0 wenn die Pruefsumme stimmt, 1 wenn sie abweicht oder gar nicht
erst gemessen werden konnte. „Nicht abrufbar" ist hier ausdruecklich ROT und
nicht „unklar": Dieses Werkzeug laeuft dort, wo der Abruf geht, und ein
stillschweigend uebergangener Riegel ist schlimmer als keiner.
"""
import json
import re
import sys
import urllib.request

AKTUELL = "https://services.gradle.org/versions/current"


def hole(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("utf-8", "replace").strip()


def amtliche_summe(fassung):
    # Die .sha256-Datei enthaelt NUR die Pruefsumme, ohne Dateinamen.
    return hole("https://services.gradle.org/distributions/"
                "gradle-%s-bin.zip.sha256" % fassung)


def lies(pfad):
    """(Fassung, festgenagelte Pruefsumme) aus der properties-Datei."""
    text = open(pfad, encoding="utf-8").read()
    m = re.search(r"distributionUrl=.*?gradle-([0-9][0-9A-Za-z.\-]*)-bin\.zip", text)
    s = re.search(r"distributionSha256Sum=([0-9a-f]{64})", text)
    return (m.group(1) if m else None), (s.group(1) if s else None)


def main(argv):
    if len(argv) != 2:
        print("Aufruf: gradle-wrapper-pruefen.py <gradle-wrapper.properties>",
              file=sys.stderr)
        return 2
    fassung, genagelt = lies(argv[1])
    if fassung is None:
        print("::error::In %s steht keine erkennbare Gradle-Fassung." % argv[1])
        return 1
    if genagelt is None:
        # Die Zeile ist optional — ihr Fehlen ist aber eine Verschlechterung,
        # die niemand bemerkt haette, und deshalb hier rot.
        print("::error::distributionSha256Sum fehlt in %s. Ohne sie nimmt der "
              "Wrapper jedes Archiv, das unter der Adresse liegt." % argv[1])
        return 1

    print("festgenagelt: Gradle %s, sha256 %s" % (fassung, genagelt))
    try:
        amtlich = amtliche_summe(fassung)
    except Exception as e:                                        # noqa: BLE001
        print("::error::Die amtliche Pruefsumme fuer Gradle %s war nicht "
              "abrufbar (%s). Damit ist der Riegel ungeprueft." % (fassung, e))
        return 1

    if amtlich != genagelt:
        print("::error::Die festgenagelte Pruefsumme passt NICHT zur amtlichen "
              "fuer Gradle %s.%%0Afestgenagelt: %s%%0Aamtlich:      %s"
              % (fassung, genagelt, amtlich))
        return 1
    print("  ok — gleich der amtlichen.")

    # ── Hinweis: die neueste Fassung und ihre Pruefsumme ────────────────────
    try:
        neu = json.loads(hole(AKTUELL)).get("version")
        if neu and neu != fassung:
            summe = amtliche_summe(neu)
            print("::notice title=Gradle::Neueste Fassung ist %s (festgenagelt "
                  "ist %s).%%0Asha256 %s" % (neu, fassung, summe))
            print("neueste: Gradle %s, sha256 %s" % (neu, summe))
        elif neu == fassung:
            print("::notice title=Gradle::%s ist die neueste Fassung." % fassung)
    except Exception as e:                                        # noqa: BLE001
        # Nur ein Hinweis — sein Ausfall darf den Riegel oben nicht umwerfen.
        print("  (neueste Fassung nicht abrufbar: %s)" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
