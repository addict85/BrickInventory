package ch.brickinventoryapp

import ch.brickinventoryapp.ui.Screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Die Detailansicht manueller Teile und Minifiguren ist ein eigener Screen —
 * kein Dialog mehr.
 *
 * Zwei Dinge, die beim Umbau leicht zurückbleiben und erst am Gerät auffallen:
 * eine Route, deren Platzhalter nicht zu den erzeugten Adressen passen (das
 * Ziel wird dann nie gefunden, ohne Fehlermeldung), und ein Name mit
 * Sonderzeichen, der die Adresse in zu viele Segmente zerlegt.
 */
class ManualItemDetailRouteTest {

    private fun segments(s: String) = s.split("/").size

    @Test
    fun `die erzeugte Adresse passt zum Routenmuster`() {
        assertEquals("manual_detail/{type}/{id}/{colorId}/{title}", Screen.ManualItemDetail.route)

        val built = Screen.ManualItemDetail.createRoute("part", "3001", 4, "Brick 2 x 4")
        assertEquals("gleich viele Segmente wie das Muster — sonst greift das Ziel nicht",
            segments(Screen.ManualItemDetail.route), segments(built))
        assertTrue(built.startsWith("manual_detail/part/3001/4/"))
    }

    @Test
    fun `Sonderzeichen in Nummer und Name zerlegen die Adresse nicht`() {
        // Figurennummern wie "fig-015788" sind harmlos; ein Leerzeichen oder
        // Schrägstrich im Namen wäre es nicht.
        val built = Screen.ManualItemDetail.createRoute("fig", "fig-015788", 0, "Anthony / Skater")
        assertEquals(segments(Screen.ManualItemDetail.route), segments(built))
        assertTrue("Leerzeichen gehören kodiert", built.contains("%20"))
        assertTrue("Ein Schrägstrich im Namen darf kein neues Segment aufmachen",
            built.contains("%2F"))
    }

    @Test
    fun `der alte Dialog ist entfernt, nicht nur ungenutzt`() {
        // Toter Code, den niemand mehr aufruft, wandert beim nächsten Umbau
        // erfahrungsgemäss versehentlich zurück in Gebrauch.
        val src = listOf(
            File("src/main/java/ch/brickinventoryapp/ui/screens/ManualItemComposables.kt"),
            File("app/src/main/java/ch/brickinventoryapp/ui/screens/ManualItemComposables.kt")
        ).firstOrNull { it.exists() }
        assertTrue("ManualItemComposables.kt nicht gefunden", src != null)
        assertTrue("ManualItemDetailDialog gehört entfernt",
            !src!!.readText().contains("fun ManualItemDetailDialog"))
    }
}
