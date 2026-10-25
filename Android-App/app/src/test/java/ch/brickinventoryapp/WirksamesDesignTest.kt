package ch.brickinventoryapp

import ch.brickinventoryapp.ui.theme.wirksamesDesign
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * „Dunkel nach System" je Gerät: Werkbank nur, wenn das Gerät es will UND das
 * System dunkel ist; sonst gilt das Design des Servers.
 *
 * Gegenproben (NICHT gemessen — in der Umgebung dieses Commits gab es kein
 * Android-SDK; wer sie laufen lässt, trägt das Ergebnis hier ein):
 *   A  in wirksamesDesign() das `&& systemDunkel` entfernt → erwartet rot im
 *      zweiten Fall (helles System)
 *   B  MainActivity wieder mit `theme = theme` → erwartet rot im dritten Fall
 */
class WirksamesDesignTest {

    @Test
    fun `ohne Wahl gilt das Design des Servers, auch bei dunklem System`() {
        assertEquals("brick", wirksamesDesign("brick", dunkelNachSystem = false, systemDunkel = true))
    }

    @Test
    fun `mit Wahl dunkel nur bei dunklem System`() {
        assertEquals("werkbank", wirksamesDesign("classic", dunkelNachSystem = true, systemDunkel = true))
        assertEquals("classic", wirksamesDesign("classic", dunkelNachSystem = true, systemDunkel = false))
    }

    @Test
    fun `MainActivity zeichnet das wirksame Design`() {
        val src = Quellen.ohneKommentare(Quellen.lies("MainActivity.kt"))
        assertTrue("MainActivity nutzt wirksamesDesign nicht — die Wahl bliebe ohne Wirkung",
            Regex("""BrickInventoryManagerTheme\(theme\s*=\s*wirksamesDesign\(""").containsMatchIn(src))
    }
}
