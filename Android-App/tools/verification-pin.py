#!/usr/bin/env python3
"""Pins the critical libraries (crypto, network, security) in verification-metadata.xml.

Gradle trusts a PGP key for a whole group by default: any future package of that group
signed with the key is accepted without a checksum. For the groups in KRITISCH that is too
wide. This tool removes their group-wide (and name-wide) trust and instead writes the key
into each artifact entry, next to its SHA-256. Gradle then checks both, and a new version
needs its own reviewed entry.

Aufruf:
  verification-pin.py <verification-metadata.xml>          rewrites the file in place
  verification-pin.py --check <verification-metadata.xml>  exit 1 if anything is still open

Text-based on purpose: the file keeps Gradle's own formatting, the diff stays reviewable.
Idempotent: a second run changes nothing. Runs after `--write-verification-metadata`
(android.yml, jobs pruefsummen-zusammenfassen and pruefsummen-vorschlagen).
"""
import re
import sys

KRITISCH = {
    "com.squareup.okhttp3",
    "com.squareup.okio",
    "com.squareup.retrofit2",
    "com.jakewharton.retrofit",
    "net.zetetic",
    "androidx.biometric",
    "androidx.credentials",
    "com.google.crypto.tink",
    "org.bouncycastle",
}

ATTR = re.compile(r'(\w+)="([^"]*)"')


def attrs(zeile):
    return dict(ATTR.findall(zeile))


def breit(a):
    """Trust without a version covers every future release of the group or package."""
    return a.get("group") in KRITISCH and "version" not in a and a.get("regex") != "true"


def bearbeite(text):
    """(new text, {group: keys}, problems)"""
    zeilen = text.split("\n")
    schluessel = {}
    aus = []
    i = 0
    while i < len(zeilen):
        z = zeilen[i]
        s = z.strip()
        if s.startswith("<trusted-key ") and s.endswith("/>"):
            a = attrs(s)
            if breit(a):
                schluessel.setdefault(a["group"], set()).add(a["id"])
                i += 1
                continue
            aus.append(z)
        elif s.startswith("<trusted-key ") and s.endswith(">"):
            kopf = attrs(s)
            block = []
            i += 1
            while not zeilen[i].strip().startswith("</trusted-key>"):
                t = attrs(zeilen[i].strip())
                if zeilen[i].strip().startswith("<trusting ") and breit(t):
                    schluessel.setdefault(t["group"], set()).add(kopf["id"])
                else:
                    block.append(zeilen[i])
                i += 1
            if block:
                aus.append(z)
                aus.extend(block)
                aus.append(zeilen[i])
        else:
            aus.append(z)
        i += 1
    return aus, schluessel


def pinne(zeilen, schluessel):
    """Adds the keys to every signed artifact of a critical group; lists artifacts without SHA-256."""
    aus = []
    offen = []
    gruppe = None
    i = 0
    while i < len(zeilen):
        z = zeilen[i]
        s = z.strip()
        if s.startswith("<component "):
            a = attrs(s)
            gruppe = a.get("group") if a.get("group") in KRITISCH else None
            komponente = f'{a.get("group")}:{a.get("name")}:{a.get("version")}'
        elif s.startswith("</component>"):
            gruppe = None
        if gruppe and s.startswith("<artifact ") and s.endswith(">") and not s.endswith("/>"):
            name = attrs(s).get("name")
            inhalt = []
            j = i + 1
            while not zeilen[j].strip().startswith("</artifact>"):
                inhalt.append(zeilen[j])
                j += 1
            sha = [x for x in inhalt if x.strip().startswith("<sha256 ")]
            if not sha:
                offen.append(f"{komponente} {name}: keine SHA-256")
            unsigniert = any('reason="Artifact is not signed"' in x for x in sha)
            vorhanden = {attrs(x.strip()).get("value") for x in inhalt if x.strip().startswith("<pgp ")}
            einzug = (sha[0] if sha else inhalt[0] if inhalt else z + "   ")
            einzug = einzug[: len(einzug) - len(einzug.lstrip())]
            neu = [] if unsigniert else [f'{einzug}<pgp value="{k}"/>'
                                          for k in sorted(schluessel.get(gruppe, set()) - vorhanden)]
            aus.append(z)
            aus.extend(neu)
            aus.extend(inhalt)
            aus.append(zeilen[j])
            i = j + 1
            continue
        aus.append(z)
        i += 1
    return aus, offen


def main(argv):
    pruefen = argv[:1] == ["--check"]
    pfad = argv[-1]
    alt = open(pfad, encoding="utf-8").read()
    zeilen, schluessel = bearbeite(alt)
    zeilen, offen = pinne(zeilen, schluessel)
    neu = "\n".join(zeilen)
    if pruefen:
        if neu != alt or offen:
            for gruppe, k in sorted(schluessel.items()):
                print(f"Gruppenweites Vertrauen für {gruppe}: {', '.join(sorted(k))}")
            for o in offen:
                print(o)
            print("verification-metadata.xml: kritische Bibliotheken nicht einzeln festgehalten "
                  "(python3 tools/verification-pin.py gradle/verification-metadata.xml)")
            return 1
        return 0
    open(pfad, "w", encoding="utf-8").write(neu)
    for o in offen:
        print(o, file=sys.stderr)
    return 1 if offen else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
