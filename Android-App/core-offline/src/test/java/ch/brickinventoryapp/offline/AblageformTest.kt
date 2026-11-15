package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.fach.LagerortEintragAnsicht
import ch.brickinventoryapp.model.fach.VorratsOrtAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.vertrag.BrickLinkRef
import ch.brickinventoryapp.vertrag.Instruction
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Merkposten
import ch.brickinventoryapp.vertrag.MerkpostenAlarm
import ch.brickinventoryapp.vertrag.Part
import ch.brickinventoryapp.vertrag.SetItem
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Bestandsart
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sets, Merkposten und Teile liegen in einer eigenen Ablageform: Jedes Feld kommt
 * unverändert zurück, eine Zeile im Format des Servermodells bleibt lesbar, und eine
 * unlesbare Zeile fällt nicht still weg.
 *
 * Gegenproben (gegenproben/ablageform-felder-vertauscht.patch, verworfen-still.patch):
 *   in Ablagezeilen.set avg und max des Kaufpreises vertauscht → rot „jedes Feld …“
 *   in Offlineablage.dekodiere verworfen = 0 → rot „eine unlesbare Zeile wird gezählt …“
 */
class AblageformTest {

    private fun <T : Any> rund(fach: Fach<T>, wert: T): T = fach.form.dekodiere(BrickJson, fach.form.kodiere(BrickJson, wert))

    // Jedes Feld mit eigenem Wert, damit eine Vertauschung auffällt.
    private val set = SetItem(setNumber = "10001-1", name = "Burg", year = 1990, theme = "Castle", pieces = 500, minifigs = 4, quantity = 2, imageUrl = "u", imageLocal = "l", addedAt = "2020-01-01", condition = Zustand.GEBRAUCHT,
        storage = "Kiste 1", conditions = listOf(Zustand.NEU, Zustand.GEBRAUCHT), owners = listOf(KontoName(id = 3, username = "lea")), maxPurchasePrice = 99.5, avgPurchasePrice = 88.25, usedCount = 1,
        instructions = listOf(Instruction(id = 4, url = "a.pdf", description = "Heft 1", localPath = "lokal/a.pdf", isManual = true)), bricklink = BrickLinkRef(type = "GEAR", number = "g1", url = "bl", exact = false, resolved = true), preisvergleichUrl = "pv")
    private val merk = Merkposten(setNumber = "20001-1", condition = Zustand.GEBRAUCHT, createdAt = "2021-02-02", userId = 7, name = "Schiff", year = 2001, numParts = 900, imageUrl = "u", imageLocal = "l", marktpreis = 12.5,
        waehrung = Waehrung.CHF, owned = true, alarm = MerkpostenAlarm(richtung = Alarmrichtung.UEBER, schwelle = 30.0, ausgeloest = true), preisvergleichUrl = "pv")
    private val teil = Part(partNumber = "3001", blPartNumber = "3001b", partName = "Stein", colorId = 5, blColorId = 11, colorName = "Rot", colorHex = "FF0000", categoryName = "Steine", imageUrl = "u", imageLocal = "l", totalQuantity = 9, inSets = "10001-1", isSpare = true)

    @Test
    fun `jedes Feld von Set, Merkposten und Teil uebersteht die Ablage`() {
        assertEquals(set.alsAnsicht(), rund(Faecher.SETS, set.alsAnsicht()))
        assertEquals(merk.alsAnsicht(), rund(Faecher.MERKLISTE, merk.alsAnsicht()))
        assertEquals(teil.alsAnsicht(), rund(Faecher.TEILE, teil.alsAnsicht()))
        val ort = VorratsOrtAnsicht(ort = LagerortEintragAnsicht(id = 3, userId = 1, name = "Keller"), vorgabe = true)
        assertEquals(ort, rund(Faecher.LAGERORTE, ort))
    }

    @Test
    fun `eine Zeile im frueheren Format bleibt lesbar`() {
        // Das Servermodell selbst als JSON: so liegen Zeilen, die vor der eigenen Ablageform geschrieben wurden.
        val alt = BrickJson.encodeToString(SetItem.serializer(), set)
        assertEquals(set.alsAnsicht(), Faecher.SETS.form.dekodiere(BrickJson, alt))
        assertEquals(merk.alsAnsicht(), Faecher.MERKLISTE.form.dekodiere(BrickJson, BrickJson.encodeToString(Merkposten.serializer(), merk)))
        assertEquals(teil.alsAnsicht(), Faecher.TEILE.form.dekodiere(BrickJson, BrickJson.encodeToString(Part.serializer(), teil)))
    }

    @Test
    fun `eine unlesbare Zeile wird gezaehlt und gemeldet statt still zu fehlen`() = runBlocking {
        val bestand = SpeicherBestand()
        val meldungen = mutableListOf<String>()
        val ablage = Offlineablage(bestand, SpeicherAusgang(), { "a" }, protokoll = { meldungen += it })
        ablage.uebernimm(Faecher.SETS, listOf(set.alsAnsicht()))
        val heil = bestand.lies("a", Bestandsart.SETS).liste
        bestand.ersetze("a", Bestandsart.SETS, heil + LokaleZeile("kaputt", """{"quantity":"viele"}"""), 1L)
        val lokal = ablage.beobachte(Faecher.SETS).first()
        assertEquals(listOf("10001-1"), lokal.liste.map { it.setNumber })
        assertEquals(1, lokal.verworfen)
        assertTrue(meldungen.joinToString(), meldungen.any { "SETS" in it && "1 von 2" in it })
    }
}
