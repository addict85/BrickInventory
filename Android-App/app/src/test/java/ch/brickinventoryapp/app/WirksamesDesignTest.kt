package ch.brickinventoryapp.app

import ch.brickinventoryapp.ui.theme.Darstellung
import ch.brickinventoryapp.ui.theme.darstellung
import ch.brickinventoryapp.model.ui.theme.Helligkeit
import ch.brickinventoryapp.model.ui.theme.dunkelNachSystemGilt
import ch.brickinventoryapp.model.ui.theme.helligkeitGilt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.ui.theme.helligkeitWaehlbar
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * System, Hell oder Dunkel je Gerät: die dunkle Fassung DESSELBEN Designs bei
 * „Dunkel“ immer, bei „System“ nur, wenn das System dunkel ist; Werkbank ist schon
 * dunkel. Ohne gespeicherte Wahl folgt die App dem System, eine frühere bleibt.
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
 *   F  in darstellung() der Zweig `Helligkeit.DUNKEL -> true` entfernt →
 *      rot „Dunkel gilt auch bei hellem System …“
 *   G  in helligkeitGilt() die Prüfung auf bekannte Werte entfernt →
 *      rot „die fruehere Ja-Nein-Wahl …“ („blau“ kam durch)
 */
class WirksamesDesignTest {

    @Test
    fun `ohne Wahl gilt das Design des Servers, auch bei dunklem System`() {
        assertEquals(Darstellung("brick", false), darstellung("brick", helligkeit = Helligkeit.HELL, systemDunkel = true))
    }

    @Test
    fun `mit Wahl dunkel nur bei dunklem System, im selben Design`() {
        assertEquals(Darstellung("classic", true), darstellung("classic", helligkeit = Helligkeit.SYSTEM, systemDunkel = true))
        assertEquals(Darstellung("noppe", true), darstellung("noppe", helligkeit = Helligkeit.SYSTEM, systemDunkel = true))
        assertEquals(Darstellung("classic", false), darstellung("classic", helligkeit = Helligkeit.SYSTEM, systemDunkel = false))
    }

    @Test
    fun `Dunkel gilt auch bei hellem System, Hell auch bei dunklem`() {
        assertEquals(Darstellung("brick", true), darstellung("brick", helligkeit = Helligkeit.DUNKEL, systemDunkel = false))
        assertEquals(Darstellung("noppe", false), darstellung("noppe", helligkeit = Helligkeit.HELL, systemDunkel = true))
    }

    @Test
    fun `die fruehere Ja-Nein-Wahl wird zu System oder Hell`() {
        assertEquals(Helligkeit.SYSTEM, helligkeitGilt(null, null))
        assertEquals(Helligkeit.SYSTEM, helligkeitGilt(null, true))
        assertEquals(Helligkeit.HELL, helligkeitGilt(null, false))
        assertEquals(Helligkeit.DUNKEL, helligkeitGilt(Helligkeit.DUNKEL, false))
        assertEquals("Unbekanntes faellt auf die fruehere Wahl zurueck", Helligkeit.HELL, helligkeitGilt("blau", false))
    }

    @Test
    fun `Werkbank bleibt, wie es ist`() {
        assertEquals(Darstellung("werkbank", false), darstellung("werkbank", helligkeit = Helligkeit.SYSTEM, systemDunkel = true))
    }

    // Die Einstellungen schalten Hell/Dunkel bei Werkbank ab. Gegenprobe (02.11.2026,
    // kotlinc): helligkeitWaehlbar gibt immer true zurück → rot.
    @Test
    fun `bei Werkbank ist Hell und Dunkel nicht waehlbar`() {
        assertTrue(!helligkeitWaehlbar("werkbank"))
        assertTrue(helligkeitWaehlbar("classic"))
        assertTrue(helligkeitWaehlbar("werkbank", systemfarben = true, sdk = 31))
    }

    // Gegenprobe: in darstellung() `sdk >= SYSTEMFARBEN_AB_SDK`
    // entfernt → rot (Android 11); `dynamisch ||` entfernt → rot (Werkbank dunkel).
    @Test
    fun `Systemfarben gelten erst ab Android 12 und haben immer eine dunkle Fassung`() {
        assertEquals(Darstellung("classic", false, systemfarben = false),
            darstellung("classic", helligkeit = Helligkeit.SYSTEM, systemDunkel = false, systemfarben = true, sdk = 30))
        assertEquals(Darstellung("classic", false, systemfarben = true),
            darstellung("classic", helligkeit = Helligkeit.SYSTEM, systemDunkel = false, systemfarben = true, sdk = 31))
        assertEquals(Darstellung("werkbank", true, systemfarben = true),
            darstellung("werkbank", helligkeit = Helligkeit.SYSTEM, systemDunkel = true, systemfarben = true, sdk = 34))
        assertEquals("Ohne Wahl kein Dunkel, auch mit Systemfarben", Darstellung("brick", false, systemfarben = true),
            darstellung("brick", helligkeit = Helligkeit.HELL, systemDunkel = true, systemfarben = true, sdk = 34))
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
            Regex("""darstellung\(theme,\s*helligkeit,\s*isSystemInDarkTheme\(\),\s*systemfarben,\s*android\.os\.Build\.VERSION\.SDK_INT\)""").containsMatchIn(src))
        assertTrue("MainActivity reicht die dunkle Fassung nicht ans Theme",
            Regex("""(\w+) = darstellung\(theme,[^\n]*\n\s*BrickInventoryManagerTheme\(theme\s*=\s*\1\.design,\s*dunkel\s*=\s*\1\.dunkel,\s*systemfarben\s*=\s*\1\.systemfarben\)""").containsMatchIn(src))
    }

    /**
     * Bis zum ersten Compose-Bild zeigt Android das Fenster-Theme. War es fest
     * hell, blitzte im Dunkelmodus Weiss auf.
     */
    @Test
    fun `der Start blitzt nicht weiss auf`() {
        val res = Quellen.res
        val nacht = File(res, "values-night/themes.xml")
        assertTrue("values-night/themes.xml fehlt", nacht.isFile)
        assertTrue("Das Nacht-Theme erbt wieder von einem hellen",
            Regex("""name="Theme\.BrickInventoryManager"\s+parent="[^"]*Light""").find(nacht.readText()) == null)
        assertTrue("values-night/colors.xml setzt keinen eigenen Fensterhintergrund",
            File(res, "values-night/colors.xml").readText().contains("fenster_hintergrund"))

        val manifest = Quellen.manifest.readText()
        assertTrue("Die Activity startet nicht im SplashScreen-Theme",
            manifest.contains("@style/Theme.BrickInventoryManager.Start"))

        val src = Quellen.ohneKommentare(Quellen.lies("MainActivity.kt"))
        val splash = src.indexOf("installSplashScreen()")
        val oncreate = src.indexOf("super.onCreate(")
        assertTrue("installSplashScreen() fehlt oder steht nach super.onCreate()",
            splash in 0 until oncreate)
    }
}
