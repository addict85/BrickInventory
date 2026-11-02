#!/usr/bin/env python3
"""Vergleicht zwei verification-metadata.xml und schreibt eine Markdown-Übersicht:
neue, entfernte und Komponenten mit geänderter Prüfsumme oder geändertem Schlüssel,
dazu neu vertraute PGP-Schlüssel (Gruppen-Regex zuerst und hervorgehoben).

Aufruf: pruefsummen-vergleich.py <alt.xml> <neu.xml>

Eine geänderte Prüfsumme bei gleicher Fassung ist der Fall, den jemand ansehen
muss: Dasselbe Artefakt dürfte nie andere Bytes haben.
"""
import sys
import xml.etree.ElementTree as ET

NS = "{https://schema.gradle.org/dependency-verification}"


def lies(pfad):
    """{"gruppe:name:fassung": {artefakt: (sha256, pgp-schlüssel)}}; fehlt die Datei, leer."""
    try:
        wurzel = ET.parse(pfad).getroot()
    except (OSError, ET.ParseError):
        return {}
    ergebnis = {}
    for k in wurzel.iter(f"{NS}component"):
        teile = {}
        for a in k.findall(f"{NS}artifact"):
            sha = a.find(f"{NS}sha256")
            schluessel = sorted(p.get("value", "") for p in a.findall(f"{NS}pgp"))
            teile[a.get("name")] = (sha.get("value") if sha is not None else None, tuple(schluessel))
        ergebnis[f"{k.get('group')}:{k.get('name')}:{k.get('version')}"] = teile
    return ergebnis


def vertrauen(pfad):
    """{(schlüssel, gruppe, name, fassung, regex)} aus <trusted-keys>; fehlt die Datei, leer.
    Ein Schlüssel mit Gruppen-Regex deckt jedes künftige Paket der Gruppe ab."""
    try:
        wurzel = ET.parse(pfad).getroot()
    except (OSError, ET.ParseError):
        return set()
    eintraege = set()
    for k in wurzel.iter(f"{NS}trusted-key"):
        for t in [k] + k.findall(f"{NS}trusting"):
            if t.get("group") is not None:
                eintraege.add((k.get("id"), t.get("group"), t.get("name") or "", t.get("version") or "",
                               t.get("regex") == "true"))
    return eintraege


def vertrauen_markdown(alt, neu):
    dazu = sorted(neu - alt)
    if not dazu:
        return ""
    z = [f"### Neu vertraute Schlüssel ({len(dazu)}) — bitte ansehen", "",
         "| Schlüssel | Gruppe | Name | Fassung | Gruppen-Regex |", "|---|---|---|---|---|"]
    z += [f"| `{s}` | `{g.replace('|', chr(92) + '|')}` | {n or '*'} | {v or '*'} | {'**JA — gilt für jedes Paket der Gruppe**' if r else 'nein'} |"
          for s, g, n, v, r in sorted(dazu, key=lambda e: (not e[4], e[1], e[0]))]
    return "\n".join(z + [""])


def vergleiche(alt, neu):
    neu_k = sorted(set(neu) - set(alt))
    weg_k = sorted(set(alt) - set(neu))
    geaendert = []
    for k in sorted(set(alt) & set(neu)):
        for art in sorted(set(alt[k]) & set(neu[k])):
            (sa, pa), (sn, pn) = alt[k][art], neu[k][art]
            if sa and sn and sa != sn:
                geaendert.append((k, art, "Prüfsumme", sa, sn))
            elif pa and pn and pa != pn:
                geaendert.append((k, art, "Schlüssel", ",".join(pa), ",".join(pn)))
    return neu_k, weg_k, geaendert


def markdown(neu_k, weg_k, geaendert):
    z = ["## Prüfsummen: was sich geändert hat", ""]
    z.append(f"| neu | entfernt | geänderte Prüfsumme/Schlüssel |\n|---|---|---|\n| {len(neu_k)} | {len(weg_k)} | {len(geaendert)} |")
    z.append("")
    if geaendert:
        z += ["### Geändert bei gleicher Fassung — bitte ansehen", "", "| Komponente | Datei | Art | alt | neu |", "|---|---|---|---|---|"]
        z += [f"| `{k}` | `{a}` | {art} | `{x[:16]}…` | `{y[:16]}…` |" for k, a, art, x, y in geaendert]
        z.append("")
    for titel, liste in (("Neu", neu_k), ("Entfernt", weg_k)):
        if liste:
            z += [f"<details><summary>{titel} ({len(liste)})</summary>", ""]
            z += [f"- `{k}`" for k in liste]
            z += ["", "</details>", ""]
    return "\n".join(z)


if __name__ == "__main__":
    print(markdown(*vergleiche(lies(sys.argv[1]), lies(sys.argv[2]))))
    print(vertrauen_markdown(vertrauen(sys.argv[1]), vertrauen(sys.argv[2])))
