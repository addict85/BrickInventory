package ch.brickinventoryapp

import org.junit.Test

/**
 * Beide Clients zeigen denselben Kaufpreis: den MENGENGEWICHTETEN.
 *
 * ── Woher dieser Test kommt (Marcos Befund, Nachtrag 76) ────────────────────
 * „In der Android-App wird der Kaufpreis des gebrauchten Sets angezeigt, in der
 * Webapp der gewichtete Durchschnittspreis. Beide sollen den gewichteten
 * Durchschnitt zeigen."
 *
 * Der Server rechnet ihn längst und liefert ihn auf BEIDEN Wegen als
 * `avg_purchase_price` (nachgemessen: 2×7.41 + 1×9.48 → 8.10 in Liste UND
 * Detail). Die Webapp nutzt das Feld seit jeher. Nur die Kachel der App las
 * `purchase_price` — und das ist bloss der in die sets-Zeile gespiegelte Wert
 * der NEUESTEN Erfassung, also der letzte Kauf statt der Sammlung.
 *
 * Die Regel steht jetzt EINMAL im Modell (`anzeigeKaufpreis`) statt in jeder
 * Ansicht. Genau darum geht es: nicht „an zwei Stellen dasselbe hinschreiben",
 * sondern eine Stelle, die beide Ansichten benutzen.
 */
class PurchasePriceDisplayTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     * Alle Modelldateien als EIN Text (Nachtrag 155).
     *
     * Vorher stand hier "data/model/Models.kt" — ein Dateiname. Die 92
     * Datenklassen lagen in einer Datei mit 1158 Zeilen; beim Aufteilen nach
     * Sachgebieten waeren alle Pruefungen hier rot geworden, obwohl sich an den
     * Klassen nichts geaendert hat. Gemeint sind DIE MODELLE, nicht eine Datei.
     */
    private fun modelle(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/data/model")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }

    @Test
    fun `die Anzeigeregel steht im Modell und bevorzugt den Durchschnitt`() {
        val m = code(modelle())
        assert(m.contains("val anzeigeKaufpreis")) {
            "Die Anzeigeregel fehlt im Modell — dann schreibt sie jede Ansicht selbst, " +
                "und genau so entstehen unterschiedliche Werte in App und Webapp"
        }
        assert(m.contains("avgPurchasePrice ?: purchasePrice")) {
            "Die Reihenfolge muss stimmen: mengengewichtet zuerst, der gespiegelte " +
                "Einzelwert nur als Rückfall"
        }
    }

    @Test
    fun `die Detailansicht liest nicht mehr direkt den gespiegelten Wert`() {
        // SetDetailScreen.kt wurde aufgeteilt; die Kacheln und Karten stehen
        // in SetDetailSections.kt. Beide zusammen sind die Detailansicht.
        val d = code(read("ui/screens/SetDetailScreen.kt") + "\n" + read("ui/screens/SetDetailSections.kt"))
        assert(!d.contains("fmtPrice(set.purchasePrice)")) {
            "Die Kaufpreis-Kachel liest wieder set.purchasePrice — das ist der Preis des " +
                "LETZTEN Kaufs, nicht der Sammlung"
        }
        assert(d.contains("set.anzeigeKaufpreis")) {
            "Die Kachel nutzt die gemeinsame Anzeigeregel nicht"
        }
    }

    @Test
    fun `die Marktpreis-Karte wiederholt die Wert-Kacheln nicht`() {
        // ── Marcos Befund ───────────────────────────────────────────────────
        // „Der blau markierte Wert in der Android-App auf der Detailseite kann
        // entfernt werden. Dieser bietet keinen Mehrwert."
        //
        // Im Stein-Design steht der Marktpreis schon in der Kachel oben und der
        // Kaufpreis in der daneben. Die grosse Zeile in der Marktpreis-Karte
        // wiederholte beide — und ihre Prozentangabe stammte aus dem
        // GESAMTvergleich, während die Zeilen darunter je Zustand rechnen. Bei
        // einem Set mit einem neuen und einem gebrauchten Exemplar standen so
        // drei Prozentzahlen untereinander, von denen die oberste eine andere
        // Frage beantwortete als die beiden darunter.
        //
        // Geprüft wird die REGEL, nicht das Aussehen: Wo die Kacheln stehen,
        // steht die Zeile nicht. Im klassischen Design gibt es die Kacheln
        // nicht — dort bleibt sie, sonst verschwände der Marktpreis von der
        // Seite. Genau diese Kopplung soll nicht unbemerkt verlorengehen.
        // SetDetailScreen.kt wurde aufgeteilt; die Kacheln und Karten stehen
        // in SetDetailSections.kt. Beide zusammen sind die Detailansicht.
        val d = code(read("ui/screens/SetDetailScreen.kt") + "\n" + read("ui/screens/SetDetailSections.kt"))
        assert(d.contains("val zeigeGrossePreiszeile = !isBrick")) {
            "Die grosse Preiszeile hängt nicht mehr am Design — entweder wiederholt sie " +
                "die Kacheln wieder, oder sie ist im klassischen Design mit verschwunden"
        }
        // Die Kacheln selbst müssen es bleiben, sonst zeigt das Stein-Design
        // gar keinen Marktpreis mehr.
        assert(d.contains("BrickStatTile(")) { "Die Wert-Kacheln fehlen" }

        // Die Zwillingsansicht für Teile und Minifiguren kommt seit jeher ohne
        // diese Zeile aus — sie geht direkt zu den Zeilen je Zustand. Beide
        // Detailseiten sollen sich gleich verhalten.
        val m = code(read("ui/screens/ManualItemDetailScreen.kt"))
        assert(!m.contains("headlineSmall")) {
            "Die Ansicht für manuelle Einträge hat eine grosse Preiszeile bekommen — " +
                "dann laufen die beiden Detailseiten wieder auseinander"
        }
    }
}
