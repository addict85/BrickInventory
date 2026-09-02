package ch.brickinventoryapp

import org.junit.Test

/**
 * Wer die Galerie laedt, fuehrt mit, was die Galerie anzeigt.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Es gab ZWEI Lader fuer dieselbe Liste. `loadSets()` und `loadMoreSets()`
 * reichten Haushaltsfilter, Suchtext, Themenfilter und Sortierung durch;
 * `loadGallery()` rief `repo.sets.getSets()` ohne jedes Argument.
 *
 * Wer mit gesetztem Filter ein Set per Barcode erfasste, bekam danach eine
 * ungefilterte Seite 1 in einer Ansicht, deren Filterchips weiter den alten
 * Stand zeigten.
 *
 * Schlimmer noch die Paginierung: `loadMoreSets()` prueft
 * `sets.size >= galleryTotal`. Nach einem `loadGallery()` standen dort eine
 * UNGEFILTERTE Liste und eine GEFILTERTE Gesamtzahl nebeneinander — je nachdem
 * entweder gar kein Nachladen mehr, oder gefilterte Seiten, an eine
 * ungefilterte Liste gehaengt.
 *
 * Aufgefallen ist es beim Vergleich, welche Ladewege `scopeFor()` mitgeben:
 * neun ja, einer nein. Nicht beim Lesen — der zweite Lader sah fuer sich
 * genommen voellig richtig aus.
 *
 * ── Was geprueft wird ───────────────────────────────────────────────────────
 * Jeder Aufruf von `repo.sets.getSets(` muss das Blickfeld UND die drei Filter
 * mitgeben. Die Aufrufstellen werden GEFUNDEN, nicht aufgezaehlt: Ein dritter
 * Lader — in welcher Datei auch immer — ist damit von selbst mitgeprueft.
 */
class GalerieLaedtGefiltertTest {

    @Test
    fun `jeder Abruf der Set-Liste fuehrt Blickfeld und Filter mit`() {
        val fehlend = mutableListOf<String>()
        var gefunden = 0

        for (datei in Quellen.alle()) {
            val src = Quellen.ohneKommentare(datei.readText())
            var i = src.indexOf(AUFRUF)
            while (i >= 0) {
                gefunden++
                val aufruf = src.substring(i, endeDesAufrufs(src, i))
                val fehlt = PFLICHT.filterNot { aufruf.contains(it) }
                if (fehlt.isNotEmpty()) {
                    val zeile = src.substring(0, i).count { it == '\n' } + 1
                    fehlend += "${datei.name}:$zeile — es fehlt: ${fehlt.joinToString()}"
                }
                i = src.indexOf(AUFRUF, i + AUFRUF.length)
            }
        }

        // Selbstbeweis: Findet das Muster nichts, waere die Liste leer und der
        // Test gruen, ohne etwas geprueft zu haben. Erwartet werden mindestens
        // loadSets() und loadMoreSets().
        assert(gefunden >= 2) {
            "Nur $gefunden Aufruf(e) von '$AUFRUF' gefunden — Muster veraltet?"
        }

        assert(fehlend.isEmpty()) {
            "Diese Abrufe der Set-Liste lassen etwas weg:\n  " + fehlend.joinToString("\n  ") +
                "\nDie Liste passt danach nicht mehr zu den Filterchips daneben, und " +
                "galleryTotal gehoert zu einer anderen Abfrage als sets."
        }
    }

    private companion object {
        const val AUFRUF = "repo.sets.getSets("

        /** Blickfeld plus die drei Filter, die die Galerie anzeigt. */
        val PFLICHT = listOf("scopeFor(", "search", "theme", "sort")

        /**
         * Das Ende des Aufrufs ist seine schliessende Klammer — die Argumente
         * stehen ueber mehrere Zeilen, ein festes Zeilenfenster waere wieder
         * die Konstruktion, die in dieser Reihe schon viermal gebrochen ist.
         */
        fun endeDesAufrufs(src: String, start: Int): Int {
            var tiefe = 1
            var j = start + AUFRUF.length
            while (j < src.length && tiefe > 0) {
                val c = src[j]
                if (c == '(') {
                    tiefe++
                } else if (c == ')') {
                    tiefe--
                }
                j++
            }
            return j
        }
    }
}
