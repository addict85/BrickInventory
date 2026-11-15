package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.AcquisitionsResponse
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Oberflächen rechnen nicht — sie zeigen an. Summen und Kennzahlen kommen aus der
 * Antwort des Servers, nicht aus einer Schleife über eine (womöglich gefilterte) Liste;
 * sonst zeigten Webapp und App aus denselben Daten verschiedene Zahlen.
 *
 * Gegenprobe: in AcquisitionManagementScreen wieder
 * `acquisitions.sumOf { it.quantity }` eingesetzt → der erste Teilschritt wird
 * rot; in MinifigsScreen wieder `figs.size` → der zweite.
 */
class ServerComputedValuesTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()

    /** Kommentare zeilenweise ausblenden — sonst hält der eigene Erklärtext die Prüfung grün. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die Summenzeile der Erfassungen kommt vom Server`() {
        for (f in listOf(
            "sammlung/ui/screens/AcquisitionManagementScreen.kt",
            "gemeinsam/ui/ManualItemComposables.kt",
        )) {
            val c = code(read(f))
            assert(!c.contains("acquisitions.sumOf")) {
                "$f summiert die Erfassungen selbst — die Summe kommt als `totals` " +
                    "aus der Antwort (utils/acquisitions.ts, acquisitionTotals)"
            }
        }
        val acq = code(read("sammlung/ui/screens/AcquisitionManagementScreen.kt"))
        assert(acq.contains("totals.quantity")) { "Die Menge muss aus totals kommen" }
        assert(acq.contains("totals.amount")) { "Der Betrag muss aus totals kommen" }
        // Gegenrichtung: `amount` ist nullable, und die Ansicht darf daraus keine
        // 0 machen — „nichts erfasst" und „für null gekauft" sind verschieden.
        assert(acq.contains("totals.amount?.let")) {
            "Der fehlende Betrag muss als null behandelt werden, nicht als 0"
        }
    }

    /**
     * Ausgeführt mit dem Json der App. Gegenprobe: die
     * Vorgabe `= AcquisitionTotals()` entfernt → rot.
     */
    @Test
    fun `die Antwort traegt die Summe, mit sicherer Vorgabe`() {
        val neu = BrickJson.decodeFromString(AcquisitionsResponse.serializer(),
            """{"success":true,"acquisitions":[],"totals":{"quantity":3,"amount":42.5,"priced_rows":2}}""")
        assertEquals(3, neu.totals.quantity)
        assertEquals(42.5, neu.totals.amount ?: 0.0, 0.0)
        // Ältere Serverstände schicken keine Summe; die Antwort scheitert daran nicht.
        val alt = BrickJson.decodeFromString(AcquisitionsResponse.serializer(), """{"success":true,"acquisitions":[]}""")
        assertEquals(0, alt.totals.quantity)
    }

    @Test
    fun `die Minifiguren-Kacheln kommen vom Server, nicht aus der gefilterten Liste`() {
        val s = code(Quellen.bildschirm("teile/ui/screens/MinifigsScreen.kt"))
        for (muster in listOf("figs.size", "figs.sumOf", "figs.count")) {
            assert(!s.contains(muster)) {
                "MinifigsScreen rechnet die Kacheln aus `figs` ($muster). Diese Liste ist " +
                    "gefiltert — die Kachel „manuell erfasst\" stünde damit immer auf 0."
            }
        }
        assert(s.contains("minifigStats.types") &&
               s.contains("minifigStats.totalQuantity") &&
               s.contains("minifigStats.manual")) {
            "Alle drei Kacheln müssen aus den Server-Kennzahlen kommen"
        }
    }
}
