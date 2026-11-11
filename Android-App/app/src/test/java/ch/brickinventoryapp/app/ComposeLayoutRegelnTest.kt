package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Quellen
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Zwei Aufbauregeln der Oberfläche, die nur im Quelltext zu sehen sind (Strukturprüfung).
 * Eine FlowRow in einer Row hat keinen Platz zum Umbrechen und stellt jeden Chip auf eine
 * eigene Zeile; die gemeinsame Tabellenzeile muss der Sprachausgabe sagen, was Antippen tut.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   flowrow-in-row          FlowRow der Haushaltsmitglieder in eine Row gelegt → rot „keine FlowRow …“
 *   tabellenzeile-stumm     TabellenZeile reicht onClickLabel nicht an clickable → rot „die Tabellenzeile …“
 */
class ComposeLayoutRegelnTest {

    private val aufruf = Regex("""^(?:[A-Za-z_][\w.]*\.)?([A-Z]\w*)\s*\(""")

    /** Der nächste umschliessende Composable-Aufruf einer Zeile, nach Einrückung gesucht. */
    private fun elternteil(zeilen: List<String>, nr: Int): Pair<String, Int>? {
        var tiefe = zeilen[nr].length - zeilen[nr].trimStart().length
        for (i in nr - 1 downTo 0) {
            val z = zeilen[i]
            if (z.isBlank()) continue
            val e = z.length - z.trimStart().length
            if (e >= tiefe) continue
            aufruf.find(z.trim())?.let { return it.groupValues[1] to i + 1 }
            tiefe = e
        }
        return null
    }

    @Test
    fun `keine FlowRow in einer waagerechten Row`() {
        var flowRows = 0
        val funde = Quellen.unter("ui").filterNot { "/ui/theme/" in it.invariantSeparatorsPath }.flatMap { f ->
            val zeilen = Quellen.ohneKommentare(f.readText()).lines()
            zeilen.indices.filter { Regex("""\bFlowRow\s*\(""").containsMatchIn(zeilen[it]) }.mapNotNull { i ->
                flowRows++
                elternteil(zeilen, i)?.takeIf { it.first in setOf("Row", "LazyRow") }
                    ?.let { "${f.name}:${i + 1} — FlowRow in ${it.first} (Zeile ${it.second})" }
            }
        }
        assertTrue("Nur $flowRows FlowRows gefunden — greift die Suche noch?", flowRows >= 4)
        assertTrue("Eine FlowRow gehört in eine Column, nicht in eine Row:\n" + funde.joinToString("\n"), funde.isEmpty())
    }

    @Test
    fun `die Tabellenzeile sagt der Sprachausgabe, was das Antippen tut`() {
        val zeile = Quellen.ohneKommentare(Quellen.lies("gemeinsam/ui/TabellenZeile.kt"))
        assertTrue("TabellenZeile nimmt keine Beschriftung für die Sprachausgabe",
            zeile.contains("onClickLabel: String? = null"))
        assertTrue("TabellenZeile reicht die Beschriftung nicht an clickable weiter",
            Regex("""clickable\(onClickLabel = onClickLabel,[^)]*\bonClick = onClick\)""").containsMatchIn(zeile))
    }
}
