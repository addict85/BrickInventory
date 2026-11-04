#!/usr/bin/env python3
"""Ersetzt Gruppen-Regex unter <trusted-keys> durch die Gruppen, die sie heute decken.

Aufruf: vertrauen-eng.py gradle/verification-metadata.xml   (schreibt die Datei um)

Gradle fasst beim Erzeugen Gruppen eines Schlüssels zu einer Regex zusammen
(`^com[.]google($|([.].*))`). Die gilt dann für jedes künftige Paket der Gruppe,
auch eines, das nie jemand angesehen hat (sec10 H5). Ersetzt wird sie durch die
Gruppen der Komponenten in derselben Datei, die sie trifft: Was heute gebaut wird,
bleibt gedeckt, eine neue Gruppe braucht einen neuen, sichtbaren Eintrag.
Rückgabe 0 = geschrieben, 1 = eine Regex trifft keine Komponente (von Hand prüfen).
"""
import re
import sys

GRUPPE = re.compile(r'group="([^"]+)"')


def gruppen(text):
    return sorted(set(re.findall(r'<component group="([^"]+)"', text)))


def eng(text):
    alle = gruppen(text)
    leer = []

    def treffer(rx):
        r = re.compile(rx)
        gefunden = [g for g in alle if r.match(g)]
        if not gefunden:
            leer.append(rx)
        return gefunden

    def einzeilig(m):
        einr, schluessel, rx = m.group(1), m.group(2), m.group(3)
        zeilen = [f'{einr}   <trusting group="{g}"/>' for g in treffer(rx)]
        return f'{einr}<trusted-key id="{schluessel}">\n' + ''.join(z + '\n' for z in zeilen) + f'{einr}</trusted-key>'

    def block(m):
        kopf, inhalt, fuss = m.group(1), m.group(2), m.group(3)
        zeilen = inhalt.split('\n')
        einr = re.match(r' *', zeilen[0]).group(0)
        bleibt, dazu = [], []
        for z in zeilen:
            rx = re.search(r'group="(\^[^"]+)" regex="true"', z)
            if rx:
                dazu += treffer(rx.group(1))
            else:
                bleibt.append(z)
        da = {GRUPPE.search(z).group(1) for z in bleibt if 'name=' not in z}
        bleibt += [f'{einr}<trusting group="{g}"/>' for g in sorted(set(dazu) - da)]
        bleibt.sort(key=lambda z: GRUPPE.search(z).group(1))
        return kopf + '\n'.join(bleibt) + fuss

    text = re.sub(r'( *)<trusted-key id="([0-9A-F]+)" group="(\^[^"]+)" regex="true"/>', einzeilig, text)
    text = re.sub(r'(<trusted-key id="[0-9A-F]+">\n)((?: *<trusting [^\n]*\n?)+?)(\n *</trusted-key>)', block, text)
    return text, leer


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    with open(argv[1], encoding='utf-8') as f:
        text, leer = eng(f.read())
    if leer:
        print('Diese Regex trifft keine Komponente, bitte von Hand prüfen: ' + ', '.join(leer))
        return 1
    with open(argv[1], 'w', encoding='utf-8') as f:
        f.write(text)
    print('Gruppen-Regex durch die gedeckten Gruppen ersetzt.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
