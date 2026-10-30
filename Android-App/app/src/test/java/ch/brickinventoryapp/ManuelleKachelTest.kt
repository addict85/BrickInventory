package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.PartValuationItem
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Was auf einer manuell erfassten Kachel steht — und was frueher fehlte.
 *
 * ── Woher dieser Test kommt (Marcos Wunsch, Nachtrag 134) ───────────────────
 *
 * „bitte auch die Preise und Notizen aus der Webapp inkl. Preisverlauf in der
 * Android-App auf den manuell erfassten Teilen und Minifiguren nachziehen"
 *
 * Nachgesehen, was die Webapp auf ihrer `man-tile` zeigt (06-minifigs.js
 * Zeilen 321-331 fuer Figuren, 479-489 fuer Teile):
 *
 *     Bild, Nummer, Name, [Farbe], ×Menge + Zustand + Besitzer,
 *     PREIS (fett), NOTIZ
 *
 * Die App zeigte die letzten beiden Zeilen nicht. Bei der NOTIZ war das mehr
 * als eine fehlende Zeile: Der Erfassungsdialog fragt sie ab und schickt sie
 * an den Server — danach war sie in der ganzen App nirgends mehr zu sehen,
 * auch nicht in der Detailansicht. Eine Eingabe, die nirgends wieder
 * auftaucht, sieht aus, als waere sie verlorengegangen.
 *
 * Der PREISVERLAUF war schon da (ManualItemDetailScreen, Abschnitt Marktpreis
 * mit MarketPriceByCondition und PriceChart, geladen von
 * loadManualPriceHistory fuer BEIDE Arten). Der Test haelt ihn hier fest,
 * damit er nicht wieder verschwindet.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class ManuelleKachelTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `beide Kacheln zeigen den Kaufpreis`() {
        // Die Notiz stand hier als zweite Zusicherung; sie ist mit Migration
        // 0022 ausgebaut — Masken und Spalten.
        val teile = code(read("ui/screens/PartsScreen.kt"))
        assert(teile.contains("preis = part.avgPurchasePrice ?: part.unitPrice ?: part.purchasePrice")) {
            "Die Teile-Kachel zeigt den Kaufpreis nicht in der Reihenfolge der Webapp"
        }

        val figuren = code(read("ui/screens/MinifigsScreen.kt"))
        assert(figuren.contains("preis = fig.avgPurchasePrice ?: fig.unitPrice ?: fig.purchasePrice")) {
            "Die Figuren-Kachel zeigt den Kaufpreis nicht in der Reihenfolge der Webapp"
        }
    }

    @Test
    fun `der mengengewichtete Kaufpreis kommt vom Server`() {
        // `unit_price` in der Stammzeile ist nur der ZULETZT geschriebene
        // Einzelpreis. Wer einmal fuer 2.- und einmal fuer 8.- gekauft hat,
        // saehe dort 8.- statt 5.-. Der Server rechnet es richtig
        // (utils/handlers/shared.ts) — die App las das Feld nur nicht ein.
        // Ausgeführt mit dem Json der App. Gegenprobe (29.10.2026, gemessen): in
        // FigValuationItem @SerialName("avg_purchase_price") entfernt → rot.
        val teil = ApiJson.decodeFromString(PartValuationItem.serializer(),
            """{"part_number":"3001","unit_price":8.0,"avg_purchase_price":5.0}""")
        val figur = ApiJson.decodeFromString(FigValuationItem.serializer(),
            """{"fig_number":"sw0001","unit_price":8.0,"avg_purchase_price":5.0}""")
        assertEquals(5.0, teil.avgPurchasePrice ?: 0.0, 0.0)
        assertEquals(5.0, figur.avgPurchasePrice ?: 0.0, 0.0)
    }

    @Test
    fun `die Detailansicht zeigt den Preisverlauf fuer Teile UND Figuren`() {
        val s = code(read("ui/screens/ManualItemDetailScreen.kt"))
        for (teil in listOf("MarketPriceByCondition(", "PriceChart(")) {
            assert(s.contains(teil)) { "$teil fehlt in der Detailansicht" }
        }
        // Geladen wird fuer beide Arten — sonst waere das Diagramm bei einer
        // von beiden immer leer.
        val laden = code(read("ui/viewmodel/KaeufeViewModel.kt"))
        assert(laden.contains("if (type == \"fig\") finanzen.getFigPriceHistory(id) else finanzen.getPartPriceHistory(id, colorId)")) {
            "Der Verlauf wird nicht fuer Figuren UND Teile geladen"
        }
    }
}
