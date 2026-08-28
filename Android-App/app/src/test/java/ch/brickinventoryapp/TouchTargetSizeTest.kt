package ch.brickinventoryapp

import org.junit.Test

/**
 * Bedienelemente unter 48 dp fallen auf — die vorhandenen sind eingetragen.
 *
 * ── Was hier wirklich der Fall ist (Nachtrag 118) ───────────────────────────
 *
 * In der Durchsicht hatte ich sechs `IconButton(modifier = Modifier.size(…))`
 * unter 48 dp als Barrierefreiheits-Mangel gemeldet. Es sind vierzehn in neun Dateien; nach dem
 * Aufräumen in Nachtrag 119 sind es zwölf in sieben — meine Suche hatte nur die einzeiligen Formen gefunden, in denen der
 * Modifier direkt hinter dem Klammerbeginn steht. Beim Umsetzen habe ich
 * genauer hingesehen, und das war zu scharf formuliert: Material3 legt in
 * `IconButton` ein `minimumInteractiveComponentSize()` in die Modifier-Kette,
 * das die ANTIPPFLÄCHE unabhängig von der sichtbaren Grösse auf mindestens
 * 48 dp aufzieht. Das ist ausdrücklich der Zweck dieses Modifiers.
 *
 * Die sechs Stellen sind also mit hoher Wahrscheinlichkeit in Ordnung — was
 * bleibt, ist eine kleine SICHTBARE Fläche (zweimal 24 dp mit einem 14-dp-
 * Symbol darin, auf der Minifiguren- und der Teile-Kachel). Ob das Antippen
 * dort in der Praxis gut geht, entscheidet kein Test, sondern ein Gerät und der
 * Accessibility Scanner. Deshalb wird hier NICHTS an Pixeln geändert.
 *
 * Was dieser Test tut, ist das, was ein Test hier leisten kann: die bekannten
 * Stellen festhalten, damit eine SIEBTE auffällt und jemand kurz nachdenkt —
 * dasselbe Muster wie bei den Ausnahmen in StateDomainBoundaryTest. Wächst die
 * Liste, ist das das Signal, einmal am Gerät nachzumessen.
 */
class TouchTargetSizeTest {

    /** Ab hier gilt eine Fläche als klein. Android-Richtwert für Antippziele. */
    private val schwelle = 48

    /**
     * Bekannte kleine Bedienelemente, mit dem Grund, warum sie klein sind.
     * Kurz halten: Jeder Eintrag ist eine Stelle, die niemand mehr nachmisst.
     */
    // ManualItemComposables.kt und SetDetailComponents.kt sind in Nachtrag 119
    // herausgefallen: Ihre kleinen Knöpfe standen in AcquisitionEditRow und
    // AcquisitionRow — beides Funktionen ohne Aufrufer, die dabei entfernt
    // wurden. Gemeldet hat es die zweite Behauptung dieses Tests, nicht ich.
    private val bekannt = mapOf(
        "MinifigsScreen.kt" to "Bearbeiten und Löschen in den Ecken der Kachel (24dp)",
        "PartsScreen.kt" to "Bearbeiten in der Ecke der Kachel (24dp)",
        "GalleryScreen.kt" to "Menge +/- auf der Kachel (28dp)",
        "MonitoringSections.kt" to "Aufklappen und Neustart in dichten Tabellenzeilen",
        "ManualItemDetailScreen.kt" to "Bearbeiten/Löschen je Kaufpreis-Zeile",
        "AcquisitionManagementScreen.kt" to "Löschen in der Zeile eines Kaufpreises",
        "SetDetailSections.kt" to "Bearbeiten/Löschen je Kaufpreis-Zeile",
    )

    @Test
    fun `kleine Antippflaechen sind bekannt und begruendet`() {
        val muster = Regex("""IconButton\((?:[^()]|\([^()]*\))*?Modifier[^)]*?\.size\((\d+)\.dp""")
        val gefunden = mutableMapOf<String, MutableList<String>>()

        for (datei in Quellen.unter("ui")) {
            val s = Quellen.ohneKommentare(datei.readText())
            muster.findAll(s).forEach { m ->
                val dp = m.groupValues[1].toInt()
                if (dp >= schwelle) return@forEach
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                gefunden.getOrPut(datei.name) { mutableListOf() } += "$zeile (${dp}dp)"
            }
        }

        val neu = gefunden.keys - bekannt.keys
        assert(neu.isEmpty()) {
            "Neue Bedienelemente unter ${schwelle}dp in: " +
                neu.joinToString { "$it ${gefunden[it]}" } +
                ". Material3 zieht die Antippfläche zwar auf 48dp auf, die SICHTBARE " +
                "Fläche bleibt aber klein — bitte einmal am Gerät ansehen und dann " +
                "hier eintragen, oder grösser machen."
        }

        val verschwunden = bekannt.keys - gefunden.keys
        assert(verschwunden.isEmpty()) {
            "Diese Einträge werden nicht mehr gebraucht und gehören gelöscht: " +
                verschwunden.joinToString() + ". Eine Ausnahme, die niemand mehr " +
                "prüft, ist schlimmer als keine."
        }
    }
}
