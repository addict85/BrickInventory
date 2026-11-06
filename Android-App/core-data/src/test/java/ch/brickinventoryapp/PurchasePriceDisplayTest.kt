package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.SetItem
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

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
 * `purchase_price` — und das war bloss der in die sets-Zeile gespiegelte Wert
 * der NEUESTEN Erfassung, also der letzte Kauf statt der Sammlung.
 *
 * Die Regel steht jetzt EINMAL im Modell (`anzeigeKaufpreis`) statt in jeder
 * Ansicht. Genau darum geht es: nicht „an zwei Stellen dasselbe hinschreiben",
 * sondern eine Stelle, die beide Ansichten benutzen.
 *
 * ── Was Migration 0032 daran geändert hat ───────────────────────────────────
 * Die gespiegelte Spalte ist weg, und mit ihr das Feld `purchasePrice` an
 * SetItem. `anzeigeKaufpreis` hat deshalb keinen Rückfall mehr. Die Prüfung
 * darauf ist umgedreht: Das Modell darf das Feld NICHT wieder einführen, denn
 * es käme ab jetzt immer leer vom Server — und ein leerer Rückfall hinter
 * einem gefüllten Wert fällt niemandem auf, bis der gefüllte einmal fehlt.
 */
class PurchasePriceDisplayTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()
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
        File(Quellen.wurzel, "data/model")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }

    // Gegenprobe: anzeigeKaufpreis auf maxPurchasePrice
    // gestellt → rot „die Anzeigeregel steht im Modell …“.
    @Test
    fun `die Anzeigeregel steht im Modell und bevorzugt den Durchschnitt`() {
        val set = ApiJson.decodeFromString(SetItem.serializer(),
            """{"set_number":"75192-1","avg_purchase_price":712.5,"max_purchase_price":800,"purchase_price":99}""")
        assertEquals("Der mengengewichtete Wert, nie der alte gespiegelte", 712.5, set.anzeigeKaufpreis!!, 1e-9)
        val m = code(modelle())
        // Umgedrehte Richtung, siehe Kopfkommentar: Das Feld darf nicht zurück.
        //
        // Geprüft wird der Kopf von SetItem, nicht die ganze Modelldatei:
        // `purchase_price` ist in den ANFRAGEN (AddSetRequest,
        // UpdateQuantityRequest, Merkposten-Übernahme) weiterhin richtig — dort
        // schickt die App einen Preis HIN. Eine Suche über alles würde die
        // verbieten und wäre schlicht falsch.
        val kopf = m.substringAfter("data class SetItem(").substringBefore("\n)")
        assert(kopf.isNotEmpty() && kopf.contains("setNumber")) {
            "Der Kopf von SetItem wurde nicht gefunden — die Prüfung darunter wäre leer wahr"
        }
        // Der GANZE Name mit Anführungszeichen, nicht die Teilzeichenfolge.
        //
        // GEMESSEN, als hier `contains("purchase_price")` stand: Die Prüfung war
        // immer rot, weil `avg_purchase_price` und `max_purchase_price` die
        // Zeichenfolge enthalten — beide gehören in den Kopf und sind genau die
        // Felder, die den Kaufpreis jetzt liefern.
        assert(kopf.contains("""@SerialName("avg_purchase_price")""")) {
            "avg_purchase_price fehlt in SetItem — dann hat die Kachel gar keinen " +
                "Kaufpreis mehr, und die Prüfung darunter wäre nebenbei leer wahr"
        }
        assert(!kopf.contains("""@SerialName("purchase_price")""")) {
            "SetItem hat purchase_price wieder — der Server liefert es für Sets " +
                "seit Migration 0032 nicht mehr, das Feld wäre immer leer"
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
        // Markt-, Kaufpreis und G&V stehen in jedem Design in den Wert-Kacheln oben. Eine
        // grosse Preiszeile in der Marktpreis-Karte wiederholte sie, mit einer
        // Prozentangabe aus dem Gesamtvergleich über den Zeilen je Zustand. Beide
        // Detailseiten (Set und manueller Eintrag) halten sich gleich daran.
        val d = code(read("ui/screens/SetDetailScreen.kt") + "\n" + read("ui/screens/SetDetailSections.kt"))
        val m = code(read("ui/screens/ManualItemDetailScreen.kt"))
        for ((name, src) in listOf("Set-Detail" to d, "manueller Eintrag" to m)) {
            assert(src.contains("WertKacheln(")) { "$name: Die Wert-Kacheln fehlen" }
            assert(!src.contains("headlineSmall")) { "$name: wieder eine grosse Preiszeile neben den Kacheln" }
        }
    }
}
