package ch.brickinventoryapp

import ch.brickinventoryapp.ui.theme.dunkelNachSystemGilt
import ch.brickinventoryapp.ui.theme.wirksamesDesign
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * „Dunkel nach System" je Gerät: Werkbank nur, wenn das Gerät es will UND das
 * System dunkel ist; sonst gilt das Design des Servers. Ohne gespeicherte Wahl
 * folgt die App dem System, eine ausdrückliche Wahl bleibt.
 *
 * Gegenproben (gemessen am 28.10., kotlinc gegen eine Kopie von
 * ui/theme/Darstellung.kt bzw. MainActivity.kt):
 *   A  in wirksamesDesign() das `&& systemDunkel` entfernt → rot „mit Wahl
 *      dunkel nur bei dunklem System"
 *   B  `?: true` → `?: false` → rot „ohne gespeicherte Wahl folgt die App dem System"
 *   C  MainActivity mit `theme = theme` → rot „MainActivity zeichnet das wirksame Design"
 *   D  installSplashScreen() hinter super.onCreate() → rot „der Start blitzt nicht weiss auf"
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
    fun `ohne gespeicherte Wahl folgt die App dem System`() {
        assertTrue(dunkelNachSystemGilt(null))
    }

    @Test
    fun `eine ausdrueckliche Wahl bleibt bestehen`() {
        assertEquals(false, dunkelNachSystemGilt(false))
        assertEquals(true, dunkelNachSystemGilt(true))
    }

    @Test
    fun `MainActivity zeichnet das wirksame Design`() {
        val src = Quellen.ohneKommentare(Quellen.lies("MainActivity.kt"))
        assertTrue("MainActivity nutzt wirksamesDesign nicht — die Wahl bliebe ohne Wirkung",
            Regex("""BrickInventoryManagerTheme\(theme\s*=\s*wirksamesDesign\(""").containsMatchIn(src))
    }

    /**
     * Bis zum ersten Compose-Bild zeigt Android das Fenster-Theme. War es fest
     * hell, blitzte im Dunkelmodus Weiss auf.
     */
    @Test
    fun `der Start blitzt nicht weiss auf`() {
        val res = java.io.File("src/main/res")
        val nacht = java.io.File(res, "values-night/themes.xml")
        assertTrue("values-night/themes.xml fehlt", nacht.isFile)
        assertTrue("Das Nacht-Theme erbt wieder von einem hellen",
            Regex("""name="Theme\.BrickInventoryManager"\s+parent="[^"]*Light""").find(nacht.readText()) == null)
        assertTrue("values-night/colors.xml setzt keinen eigenen Fensterhintergrund",
            java.io.File(res, "values-night/colors.xml").readText().contains("fenster_hintergrund"))

        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        assertTrue("Die Activity startet nicht im SplashScreen-Theme",
            manifest.contains("@style/Theme.BrickInventoryManager.Start"))

        val src = Quellen.ohneKommentare(Quellen.lies("MainActivity.kt"))
        val splash = src.indexOf("installSplashScreen()")
        val oncreate = src.indexOf("super.onCreate(")
        assertTrue("installSplashScreen() fehlt oder steht nach super.onCreate()",
            splash in 0 until oncreate)
    }
}
