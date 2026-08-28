package ch.brickinventoryapp

import org.junit.Test

/**
 * Bedienelemente, die NUR aus einem Symbol bestehen, brauchen eine Beschriftung.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 * Vier IconButtons trugen `contentDescription = null`: Suche leeren (Katalog
 * und Teileliste), Passwort ein-/ausblenden im Login und das Dreipunkt-Menü auf
 * der Galerie-Kachel. TalkBack liest dort nur „Schaltfläche" vor — für jemanden
 * mit Bildschirmleser ist das ein Knopf ohne Funktion.
 *
 * Aufgefallen ist es im Vergleich zur Webapp: Die hat in hardened-62 einen
 * eigenen Durchgang bekommen (57 verknüpfte Beschriftungen, 19 aria-label,
 * sieben Dialoge mit role="dialog"). Die App hatte denselben Anspruch nur noch
 * nicht eingelöst.
 *
 * ── Was dieser Test NICHT verlangt ──────────────────────────────────────────
 * `contentDescription = null` an einem Symbol NEBEN einem Text ist richtig und
 * bleibt: Sonst liest TalkBack dieselbe Sache zweimal („Suchen, Suchen"). Der
 * Test greift deshalb nur Symbole INNERHALB eines IconButton ab — dort ist das
 * Symbol das einzige, was der Knopf zu bieten hat.
 */
class IconButtonLabelTest {

    // Hinweis: Die Prueflogik greift auch FilledTonalIconButton & Co. — deren
    // Name enthaelt "IconButton". Das ist Absicht und hat beim Schreiben dieses
    // Tests sechs weitere Stellen zutage gefoerdert, an die vorher niemand
    // dachte: die Mengen-Knoepfe (+/-) in den beiden Detail-Ansichten und zwei
    // Bearbeiten-Knoepfe im Monitoring. Die Mengen-Knoepfe trugen "+" und "-"
    // als Beschreibung — das liest TalkBack als "Plus", nicht als "Menge
    // erhoehen".

    private fun screens(): List<java.io.File> =
        java.io.File("src/main/java/ch/brickinventoryapp")
            .walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            .also {
                // Untergrenze (Nachtrag 118): ein leerer Dateilauf lässt jede
                // Sammelprüfung darunter stillschweigend bestehen.
                check(it.size >= 20) { "Zu wenige Kotlin-Dateien gefunden (${'$'}{it.size}) — Pfad veraltet?" }
            }

    @Test
    fun `jeder IconButton hat eine Beschriftung`() {
        val ohneLabel = mutableListOf<String>()

        for (datei in screens()) {
            val zeilen = datei.readText().lines()
            zeilen.forEachIndexed { i, zeile ->
                if (!zeile.contains("IconButton(")) return@forEachIndexed
                // Der Icon-Aufruf steht auf derselben oder einer der nächsten
                // Zeilen — mehrzeilige Aufrufe sind der Normalfall.
                //
                // Fenster über die nächsten zehn Zeilen statt über eine feste
                // Zeichenzahl ab `Icon(`: Ein erster Versuch schnitt bei 300
                // Zeichen ab und meldete deshalb den Passwort-Knopf als
                // unbeschriftet, obwohl die Beschriftung — hinter zwei
                // Kommentarzeilen — direkt darunter stand. Ein Test, der
                // korrekten Code anmeckert, wird abgeschaltet statt befolgt.
                val block = zeilen.subList(i, minOf(i + 10, zeilen.size)).joinToString("\n")
                if (!block.contains("Icon(")) return@forEachIndexed
                val beschriftet = block.contains("stringResource") ||
                    block.contains("contentDescription =")
                if (!beschriftet) ohneLabel += "${datei.name}:${i + 1}"
            }
        }

        assert(ohneLabel.isEmpty()) {
            "IconButton ohne Beschriftung — TalkBack sagt dort nur „Schaltfläche\": $ohneLabel"
        }
    }

    @Test
    fun `die Beschriftungen liegen in beiden Sprachen vor`() {
        // Ein fehlender Eintrag in values-de führt nicht zum Fehler, sondern
        // still zum englischen Text — genau die Sorte Lücke, die niemand meldet.
        val en = java.io.File("src/main/res/values/strings.xml").readText()
        val de = java.io.File("src/main/res/values-de/strings.xml").readText()
        val namen = listOf(
            "cd_search_clear", "cd_password_show", "cd_password_hide", "cd_set_menu",
            "cd_qty_increase", "cd_qty_decrease", "cd_edit_cache_ttl", "cd_edit_limits",
        )
        for (name in namen) {
            assert(en.contains("\"$name\"")) { "values/strings.xml: $name fehlt" }
            assert(de.contains("\"$name\"")) { "values-de/strings.xml: $name fehlt" }
        }
    }
}
