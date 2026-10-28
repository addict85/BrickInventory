package ch.brickinventoryapp

import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Teileliste
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.URLEncoder

/**
 * Die temporäre Teileliste, ausgeführt gegen einen Testserver: ein Set
 * auflösen und den eigenen Bestand dazu holen.
 *
 * Gegenproben (am 28.10.2026 gemessen, kotlinc gegen ui/Teileliste.kt):
 *   A  Schlüssel des Zusammenfassens auf blNum statt partNumber → rot „ein Set
 *      wird nach Rebrickable-Nummer zusammengefasst …“, „ein Bild vom CDN …“
 *      und „der Bestand fragt …“ (drei Zeilen statt vier)
 *   B  Name aus getSetInfo nicht übernommen (immer setNumber) → rot „ein Set
 *      wird nach Rebrickable-Nummer zusammengefasst …“
 *   C  den Zweig für https-Adressen ohne Proxy durchgereicht → rot „ein Bild vom
 *      CDN läuft über den Server …“
 *   D  in mitBestand() immer null statt "own" geschickt → rot „der Bestand fragt
 *      ohne Unterkonten nur das eigene Konto …“
 *   E  in mitBestand() lose und gesamt vertauscht → rot, derselbe Fall
 *   F  BestandTeil mit blPartNumber gebaut → rot, derselbe Fall (Rumpf)
 *   G  bei einer Fehlantwort mit leerem Bestand weitergerechnet → rot „ein
 *      Fehler beim Bestand ergibt null …“
 */
class TeilelisteTest {

    private lateinit var pfade: PfadServer
    private lateinit var t: TestDienste
    private lateinit var liste: Teileliste

    private val cdn = "https://cdn.rebrickable.com/media/parts/3001.jpg"

    @Before
    fun auf() {
        pfade = PfadServer(
            "/api/v1/sets/info/75192-1" to """{"success":true,"name":"Millennium Falcon"}""",
            "/api/v1/sets/75192-1/parts-list" to """{"success":true,"parts":[
                {"part_number":"3001","bl_part_number":"3001","color_id":1,"total_quantity":2,"image_local":"/images/parts/3001.jpg","image_url":"$cdn"},
                {"part_number":"3001","bl_part_number":"3001","color_id":1,"total_quantity":3},
                {"part_number":"970c00","bl_part_number":"970c00","color_id":0,"total_quantity":1,"image_url":"$cdn"},
                {"part_number":"970c11","bl_part_number":"970c00","color_id":0,"total_quantity":1,"image_url":"/images/parts/970c11.jpg"}
            ]}""",
            "/api/v1/sets/75192-1/minifigs-list" to """{"success":true,"figs":[
                {"fig_number":"sw0001","fig_name":"Han","quantity":1,"total_quantity":2}
            ]}""",
            "/api/v1/parts/owned" to """{"success":true,"bestand":{
                "3001|1":{"gesamt":7,"lose":2},
                "970c11|0":{"gesamt":1,"lose":0}
            }}""",
        )
        t = TestDienste(pfade.server)
        liste = Teileliste(SetsRepository(t.api, t.cache), TeileRepository(t.api, t.cache))
    }

    @After
    fun zu() {
        t.aufraeumen()
        pfade.server.shutdown()
    }

    @Test
    fun `ein Set wird nach Rebrickable-Nummer zusammengefasst und traegt den Katalognamen`() = runBlocking {
        val (name, zeilen) = liste.loeseSetAuf("75192-1", "http://srv/")
        assertEquals("Millennium Falcon", name)
        assertEquals(listOf("3001", "970c00", "970c11", "sw0001"), zeilen.map { it.partNumber })
        assertEquals(5, zeilen.single { it.partNumber == "3001" }.quantity)
        // Gleiche BrickLink-Nummer, verschiedene Rebrickable-Teile: zwei Zeilen.
        assertEquals("970c00", zeilen.single { it.partNumber == "970c11" }.blPartNumber)
        val figur = zeilen.single { it.isFig }
        assertEquals(2, figur.quantity)
    }

    @Test
    fun `ein Bild vom CDN laeuft ueber den Server und ein lokales Bild geht vor`() = runBlocking {
        val zeilen = liste.loeseSetAuf("75192-1", "http://srv/").second
        assertEquals("http://srv/images/parts/3001.jpg", zeilen.single { it.partNumber == "3001" }.imageUrl)
        assertEquals("http://srv/api/v1/img-proxy?url=" + URLEncoder.encode(cdn, "UTF-8"),
            zeilen.single { it.partNumber == "970c00" }.imageUrl)
        assertEquals("http://srv/images/parts/970c11.jpg", zeilen.single { it.partNumber == "970c11" }.imageUrl)
    }

    @Test
    fun `der Bestand fragt ohne Unterkonten nur das eigene Konto und zaehlt wahlweise nur lose Teile`() = runBlocking {
        val zeilen = liste.loeseSetAuf("75192-1", "http://srv").second.filter { !it.isFig }

        val lose = liste.mitBestand(zeilen, nurLose = true, mitUnterkonten = false)!!
        assertEquals(listOf(2, 0, 0), lose.map { it.vorhanden })
        assertTrue(pfade.anfragenAn("POST /api/v1/parts/owned").single().endsWith("?accounts=own"))
        val rumpf = pfade.koerper[pfade.anfragen.indexOfFirst { "parts/owned" in it }]
        assertTrue(rumpf, "\"970c11\"" in rumpf)

        val alle = liste.mitBestand(zeilen, nurLose = false, mitUnterkonten = true)!!
        assertEquals(listOf(7, 0, 1), alle.map { it.vorhanden })
        assertFalse(pfade.anfragenAn("POST /api/v1/parts/owned").last().contains("accounts"))
    }

    @Test
    fun `ein Fehler beim Bestand ergibt null statt einer Liste voller Nullen`() = runBlocking {
        pfade.codes["/api/v1/parts/owned"] = 500
        val zeilen = liste.loeseSetAuf("75192-1", "http://srv").second
        assertNull(liste.mitBestand(zeilen, nurLose = false, mitUnterkonten = false))
    }
}
