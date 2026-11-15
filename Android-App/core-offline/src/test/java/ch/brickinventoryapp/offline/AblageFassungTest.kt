package ch.brickinventoryapp.offline

import org.junit.Assert.assertNotNull
import ch.brickinventoryapp.model.fach.KatalogThemaAnsicht
import ch.brickinventoryapp.model.fach.KatalogMetaAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.vertrag.DashboardStats
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Minifig
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.StatsResponse
import ch.brickinventoryapp.vertrag.ValuationAcquisition
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Jedes Fach liegt in eigener Zeilenform mit Fassung, nicht als Servermodell: Jedes Feld des
 * Fachtyps übersteht die Ablage, eine Zeile, wie sie vor der eigenen Form auf der Platte lag, bleibt
 * lesbar, und eine unbekannte Fassung ist unlesbar statt falsch gelesen.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   ablage-figur-feld-umbenannt     in FigurZeile `fig_number` ohne SerialName → rot „eine alte Zeile …“
 *   ablage-kauf-feld-vertauscht     in Ablagezeilen.kauf avgPrice und purchasePrice vertauscht → rot „jedes Feld …“
 *   ablage-fassung-ignoriert        dekodiere() liest jede Fassung mit dem heutigen Leser → rot „eine unbekannte Fassung …“
 */
class AblageFassungTest {

    private fun <T : Any> rund(fach: Fach<T>, wert: T): T = fach.form.dekodiere(BrickJson, fach.form.kodiere(BrickJson, wert))

    private val konto = KontoName(id = 3, username = "lea")
    private val kauf = ValuationAcquisition(id = 4, condition = Zustand.GEBRAUCHT, quantity = 2, purchasePrice = 1.5, avgPrice = 2.5,
        totalAvg = "5,00", wertGesamt = 5.0, pnlPct = "+3%", pnlProzent = 3.0, createdAt = "2026-01-01T08:00:00Z", ownerUserId = 3,
        kaufpreisOriginal = 1.4, kaufpreisWaehrung = "CHF", priceEstimated = true)
    private val figur = Minifig(id = 1, inSets = "10001-1", ownerIds = listOf(3), setNumber = "10001-1", storage = "Kiste", unitPrice = 2.0,
        figNumber = "sw0001", condition = Zustand.NEU, conditions = listOf(Zustand.NEU), owners = listOf(konto), avgPurchasePrice = 3.0,
        figName = "Luke", quantity = 2, totalQuantity = 4, imageUrl = "u", imageLocal = "l", source = "manual", setAddedAt = "2025-12-24T18:00:00Z")
    private val teil = PartValuationItem(ausstehend = true, fromCache = true, maxPrice = 9.0, minPrice = 1.0, acqCount = 2, usedCount = 1,
        categoryName = "Steine", createdAt = "2025", source = "manual", id = 5, partNumber = "3001", blPartNumber = "3001b", partName = "Stein",
        colorId = 5, colorName = "Rot", colorHex = "FF0000", quantity = 3, imageUrl = "u", imageLocal = "l", unitPrice = 0.1,
        purchasePrice = 0.3, avgPurchasePrice = 0.2, qtyAvgPrice = 0.4, avgPrice = 0.5, pnlPct = "+1%", pnlProzent = 1.0, displayValue = "1,50",
        totalValue = "1,50", wertGesamt = 1.5, condition = Zustand.GEBRAUCHT, conditions = listOf(Zustand.GEBRAUCHT), userId = 3,
        owners = listOf(konto), acquisitions = listOf(kauf), storage = "Regal")
    private val manuelleFigur = FigValuationItem(ausstehend = true, fromCache = true, maxPrice = 9.0, minPrice = 1.0, setNumber = "10001-1",
        source = "manual", storageId = 2, acqCount = 2, usedCount = 1, id = 6, figNumber = "sw0002", blFigNumber = "sw0002a", figName = "Leia",
        quantity = 1, imageUrl = "u", imageLocal = "l", unitPrice = 1.0, purchasePrice = 2.0, avgPurchasePrice = 3.0, qtyAvgPrice = 4.0,
        avgPrice = 5.0, pnlPct = "-1%", pnlProzent = -1.0, displayValue = "5,00", totalValue = "5,00", wertGesamt = 5.0,
        condition = Zustand.NEU, conditions = listOf(Zustand.NEU), userId = 3, owners = listOf(konto), acquisitions = listOf(kauf), storage = "Kiste")
    private val gutschein = Gutschein(id = 7, number = "6061", amount = 20.0, currency = Waehrung.EUR, hatPdf = true,
        createdAt = "2025-05-01T09:00:00Z", updatedAt = "2026-01-01T09:00:00Z", guthabenGeprueftAm = "2026-02-03")
    private val alarm = Preisalarm(setNumber = "75192-1", condition = Zustand.GEBRAUCHT, richtung = Alarmrichtung.UEBER, schwelle = 800.0,
        currencyCode = Waehrung.CHF, ausgeloest = true, zuletztAm = "2026-03-04T05:06:07Z", zuletztPreis = 810.0, name = "Falke", imageLocal = "l",
        imageUrl = "u", setImgUrl = "s", besitzt = false)
    private val kennzahlen = StatsResponse(success = true, stats = DashboardStats(currency = "CHF", defaultCondition = "N",
        userDefaultCondition = "U", totalSets = 1, totalQuantity = 2, totalPieces = 3, totalInstructions = 4, totalParts = 5, setParts = 6,
        manualParts = 7, totalMinifigs = 8))
    private val metaAnsicht = KatalogMetaAnsicht(listOf(KatalogThemaAnsicht(id = 1, name = "Castle", setCount = 9)), 1980, 2026)

    @Test
    fun `jedes Feld jedes Fachs uebersteht die Ablage`() {
        // Die Füllwerte sind lesbare Zeitpunkte: Ein null überstünde jede Ablage.
        listOf(figur.alsAnsicht().setAddedAt, kauf.alsAnsicht().createdAt, gutschein.alsAnsicht().guthabenGeprueftAm, alarm.alsAnsicht().zuletztAm)
            .forEach { assertNotNull(it) }
        assertEquals(figur.alsAnsicht(), rund(Faecher.FIGUREN, figur.alsAnsicht()))
        assertEquals(teil.alsAnsicht(), rund(Faecher.MANUELLE_TEILE, teil.alsAnsicht()))
        assertEquals(manuelleFigur.alsAnsicht(), rund(Faecher.MANUELLE_FIGUREN, manuelleFigur.alsAnsicht()))
        assertEquals(gutschein.alsAnsicht(), rund(Faecher.GUTSCHEINE, gutschein.alsAnsicht()))
        assertEquals(alarm.alsAnsicht(), rund(Faecher.PREISALARME, alarm.alsAnsicht()))
        assertEquals(kennzahlen.stats!!.alsAnsicht(), rund(Faecher.KENNZAHLEN, kennzahlen.stats!!.alsAnsicht()))
        assertEquals(metaAnsicht, rund(Faecher.KATALOG_META, metaAnsicht))
    }

    @Test
    fun `die PIN eines Gutscheins kommt nicht auf die Platte`() {
        val text = Faecher.GUTSCHEINE.form.kodiere(BrickJson, gutschein.copy(pin = "4711").alsAnsicht())
        assertEquals(false, "4711" in text)
    }

    /** So lagen die Zeilen, als die Ablage noch das Servermodell schrieb: eingefroren, nicht neu erzeugt. */
    @Test
    fun `eine alte Zeile jedes Fachs bleibt lesbar`() {
        assertEquals(Minifig(figNumber = "sw0001", figName = "Luke", quantity = 2, owners = listOf(konto)).alsAnsicht(),
            Faecher.FIGUREN.form.dekodiere(BrickJson,
                """{"fig_number":"sw0001","fig_name":"Luke","quantity":2,"owners":[{"id":3,"username":"lea"}],"source":"set"}"""))
        assertEquals(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 3, userId = 3, storage = "Regal",
            acquisitions = listOf(ValuationAcquisition(id = 4, purchasePrice = 1.5))).alsAnsicht(),
            Faecher.MANUELLE_TEILE.form.dekodiere(BrickJson,
                """{"part_number":"3001","color_id":5,"quantity":3,"user_id":3,"storage":"Regal","acquisitions":[{"id":4,"purchase_price":1.5}]}"""))
        assertEquals(FigValuationItem(figNumber = "sw0002", blFigNumber = "sw0002a", quantity = 1, userId = 3).alsAnsicht(),
            Faecher.MANUELLE_FIGUREN.form.dekodiere(BrickJson, """{"fig_number":"sw0002","bl_fig_number":"sw0002a","quantity":1,"user_id":3}"""))
        assertEquals(Gutschein(id = 7, number = "6061", amount = 20.0, currency = Waehrung.EUR, hatPdf = true).alsAnsicht(),
            Faecher.GUTSCHEINE.form.dekodiere(BrickJson, """{"id":7,"number":"6061","amount":20.0,"currency":"EUR","hat_pdf":true}"""))
        assertEquals(Preisalarm(setNumber = "75192-1", condition = Zustand.GEBRAUCHT, richtung = Alarmrichtung.UEBER, schwelle = 800.0,
            currencyCode = Waehrung.CHF, zuletztPreis = 810.0).alsAnsicht(),
            Faecher.PREISALARME.form.dekodiere(BrickJson,
                """{"set_number":"75192-1","condition":"U","richtung":"ueber","schwelle":800.0,"currency_code":"CHF","zuletzt_preis":810.0}"""))
        assertEquals(DashboardStats(totalSets = 1, totalQuantity = 2, totalPieces = 3,
            totalInstructions = 4, totalParts = 5, manualParts = 7, totalMinifigs = 8).alsAnsicht(),
            Faecher.KENNZAHLEN.form.dekodiere(BrickJson, """{"success":true,"stats":{"total_sets":1,"total_quantity":2,"total_pieces":3,""" +
                """"total_instructions":4,"total_parts":5,"manual_parts":7,"total_minifigs":8}}"""))
        assertEquals(KatalogMetaAnsicht(listOf(KatalogThemaAnsicht(id = 1, name = "Castle", setCount = 9)), 1980, null),
            Faecher.KATALOG_META.form.dekodiere(BrickJson, """{"success":true,"themes":[{"id":1,"name":"Castle","set_count":9}],"year_min":1980}"""))
    }

    @Test
    fun `eine unbekannte Fassung ist unlesbar statt falsch gelesen`() {
        val neu = """{"fassung":2,"fig_number":"sw0001"}"""
        assertThrows(SerializationException::class.java) { Faecher.FIGUREN.form.dekodiere(BrickJson, neu) }
        assertEquals("Fassung 1 trägt kein Feld", "sw0001", Faecher.FIGUREN.form.dekodiere(BrickJson, """{"fassung":1,"fig_number":"sw0001"}""").figNumber)
    }
}
