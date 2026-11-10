package ch.brickinventoryapp.app

import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Bedienelemente, die NUR aus einem Symbol bestehen, brauchen eine Beschriftung.
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

    private fun screens(): List<File> =
        Quellen.wurzel
            .walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            .also {
                // Untergrenze: ein leerer Dateilauf lässt jede
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

    /**
     * Jeder reine Symbolknopf liegt in MitTooltip: Sehende Nutzer konnten Filter und
     * Sortieren (beides Linien) nur raten, Material zeigt den Namen beim langen Drücken.
     * Der Aufruf steht auf derselben Zeile oder bis zu zwei Zeilen darüber. Ausnahme ist
     * nur MitTooltip.kt selbst, das den Knopf als Inhalt bekommt.
     *
     * Gegenprobe (gegenproben/symbolknopf-ohne-tooltip.patch): der Zurück-Pfeil der
     * Unterseite ohne MitTooltip → rot mit Unterseite.kt.
     */
    @Test
    fun `jeder Symbolknopf zeigt seinen Namen als Tooltip`() {
        val ohne = mutableListOf<String>()
        for (datei in screens()) {
            if (datei.name == "MitTooltip.kt") continue
            val zeilen = Quellen.ohneKommentare(datei.readText()).lines()
            zeilen.forEachIndexed { i, zeile ->
                if (!zeile.contains("IconButton(")) return@forEachIndexed
                val davor = zeilen.subList(maxOf(0, i - 2), i + 1).joinToString("\n")
                if (!davor.contains("MitTooltip(")) ohne += "${datei.name}:${i + 1}"
            }
        }
        assert(ohne.isEmpty()) { "Symbolknopf ohne Tooltip (MitTooltip): $ohne" }
    }

    @Test
    fun `die Beschriftungen liegen in beiden Sprachen vor`() {
        // Ein fehlender Eintrag in values-de führt nicht zum Fehler, sondern
        // still zum englischen Text — genau die Sorte Lücke, die niemand meldet.
        val en = File(Quellen.res, "values/strings.xml").readText()
        val de = File(Quellen.res, "values-de/strings.xml").readText()
        val namen = listOf(
            "cd_search_clear", "cd_password_show", "cd_password_hide", "cd_set_delete",
            "cd_qty_increase", "cd_qty_decrease", "cd_edit_cache_ttl", "cd_edit_limits",
        )
        for (name in namen) {
            assert(en.contains("\"$name\"")) { "values/strings.xml: $name fehlt" }
            assert(de.contains("\"$name\"")) { "values-de/strings.xml: $name fehlt" }
        }
    }

    // Gegenprobe (am 27.10. gemessen): in MerklisteZeile.kt das
    // `role = Role.Button` wieder entfernt → rot mit genau dieser Stelle.
    @Test
    fun `jedes clickable nennt seine Rolle`() {
        // Ohne Rolle sagt TalkBack bei einer anklickbaren Karte nichts darüber,
        // dass man sie antippen kann.
        val ohneRolle = mutableListOf<String>()
        for (f in screens()) {
            // Glance (Startbildschirm-Widget) kennt keine Rolle: Dort wird daraus eine
            // RemoteViews-Fläche, die der Launcher selbst als antippbar ansagt.
            if (f.readText().contains("import androidx.glance.")) continue
            // Importzeilen leeren statt entfernen: die Zeilennummern bleiben stimmig.
            val s = f.readText().lines().joinToString("\n") { if (it.startsWith("import ")) "" else it }
            Regex("""\.clickable(\((?:[^()]|\([^()]*\))*\))?""").findAll(s).forEach { m ->
                if (!m.value.contains("role =")) ohneRolle += "${f.name}:${s.substring(0, m.range.first).count { it == '\n' } + 1}"
            }
        }
        assert(ohneRolle.isEmpty()) { "clickable ohne role: $ohneRolle" }
    }
}
