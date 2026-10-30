package ch.brickinventoryapp

import ch.brickinventoryapp.ui.theme.Darstellung
import ch.brickinventoryapp.ui.theme.darstellung
import ch.brickinventoryapp.ui.theme.dunkelNachSystemGilt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * „Dunkel nach System" je Gerät: die dunkle Fassung DESSELBEN Designs, nur wenn
 * das Gerät es will UND das System dunkel ist; Werkbank ist schon dunkel. Ohne
 * gespeicherte Wahl folgt die App dem System, eine ausdrückliche Wahl bleibt.
 *
 * Gegenproben (29.10.2026, gemessen gegen ui/theme/Darstellung.kt bzw.
 * MainActivity.kt):
 *   A  in darstellung() das `&& systemDunkel` entfernt → rot „mit Wahl dunkel
 *      nur bei dunklem System, im selben Design“
 *   B  `?: true` → `?: false` → rot „ohne gespeicherte Wahl folgt die App dem System"
 *   C  MainActivity ohne `dunkel = sicht.dunkel` → rot „MainActivity
 *      zeichnet das wirksame Design“
 *   D  installSplashScreen() hinter super.onCreate() → rot „der Start blitzt nicht weiss auf"
 *   E  `&& hatDunkleFassung(design)` entfernt → rot „Werkbank bleibt, wie es ist“
 */
class WirksamesDesignTest {

    @Test
    fun `ohne Wahl gilt das Design des Servers, auch bei dunklem System`() {
        assertEquals(Darstellung("brick", false), darstellung("brick", dunkelNachSystem = false, systemDunkel = true))
    }

    @Test
    fun `mit Wahl dunkel nur bei dunklem System, im selben Design`() {
        assertEquals(Darstellung("classic", true), darstellung("classic", dunkelNachSystem = true, systemDunkel = true))
        assertEquals(Darstellung("noppe", true), darstellung("noppe", dunkelNachSystem = true, systemDunkel = true))
        assertEquals(Darstellung("classic", false), darstellung("classic", dunkelNachSystem = true, systemDunkel = false))
    }

    @Test
    fun `Werkbank bleibt, wie es ist`() {
        assertEquals(Darstellung("werkbank", false), darstellung("werkbank", dunkelNachSystem = true, systemDunkel = true))
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
        assertTrue("MainActivity nutzt darstellung() nicht — die Wahl bliebe ohne Wirkung",
            Regex("""darstellung\(theme,\s*dunkel,\s*isSystemInDarkTheme\(\)\)""").containsMatchIn(src))
        assertTrue("MainActivity reicht die dunkle Fassung nicht ans Theme",
            Regex("""(\w+) = darstellung\(theme,[^\n]*\n\s*BrickInventoryManagerTheme\(theme\s*=\s*\1\.design,\s*dunkel\s*=\s*\1\.dunkel\)""").containsMatchIn(src))
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
