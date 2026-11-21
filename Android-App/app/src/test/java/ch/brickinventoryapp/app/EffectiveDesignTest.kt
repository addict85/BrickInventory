package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ui.theme.Darstellung
import ch.brickinventoryapp.ui.theme.darstellung
import ch.brickinventoryapp.model.ui.theme.Helligkeit
import ch.brickinventoryapp.model.ui.theme.darkAfterSystemApplies
import ch.brickinventoryapp.model.ui.theme.brightnessApplies
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ch.brickinventoryapp.ui.theme.brightnessSelectable
import java.io.File
import ch.brickinventoryapp.testing.Quellen

/**
 * System, Hell oder Dunkel je Gerät: die dunkle Fassung DESSELBEN Designs bei
 * „Dunkel“ immer, bei „System“ nur, wenn das System dunkel ist; Werkbank ist schon
 * dunkel. Ohne gespeicherte Wahl folgt die App dem System, eine frühere bleibt.
 *
 * Gegenproben (29.10.2026, gemessen gegen ui/theme/Darstellung.kt bzw.
 * MainActivity.kt):
 *   A  in darstellung() das `&& systemDark` entfernt → rot „mit Wahl dunkel
 *      nur bei dunklem System, im selben Design“
 *   B  `?: true` → `?: false` → rot „without a saved choice the app follows the system"
 *   C  MainActivity ohne `dunkel = view.dunkel` → rot „MainActivity
 *      zeichnet das wirksame Design“
 *   D  installSplashScreen() hinter super.onCreate() → rot „the start does not flash white"
 *   E  `&& hatDarkVersion(design)` entfernt → rot „Workbench stays as it is“
 *   F  in darstellung() der Zweig `Helligkeit.DARK -> true` entfernt →
 *      rot „Dunkel gilt auch bei hellem System …“
 *   G  in brightnessApplies() die Prüfung auf bekannte Werte entfernt →
 *      rot „die fruehere Ja-Nein-Wahl …“ („blau“ kam durch)
 */
class EffectiveDesignTest {

    @Test
    fun `without a choice the server's design applies, also with a dark system`() {
        assertEquals(Darstellung(Design.BRICK, false), darstellung(Design.BRICK, helligkeit = Helligkeit.LIGHT, systemDark = true))
    }

    @Test
    fun `with a choice dark only with a dark system, in the same design`() {
        assertEquals(Darstellung(Design.CLASSIC, true), darstellung(Design.CLASSIC, helligkeit = Helligkeit.SYSTEM, systemDark = true))
        assertEquals(Darstellung(Design.NOPPE, true), darstellung(Design.NOPPE, helligkeit = Helligkeit.SYSTEM, systemDark = true))
        assertEquals(Darstellung(Design.CLASSIC, false), darstellung(Design.CLASSIC, helligkeit = Helligkeit.SYSTEM, systemDark = false))
    }

    @Test
    fun `Dark applies also with a light system, Light also with a dark one`() {
        assertEquals(Darstellung(Design.BRICK, true), darstellung(Design.BRICK, helligkeit = Helligkeit.DARK, systemDark = false))
        assertEquals(Darstellung(Design.NOPPE, false), darstellung(Design.NOPPE, helligkeit = Helligkeit.LIGHT, systemDark = true))
    }

    @Test
    fun `the former yes-no choice becomes System or Light`() {
        assertEquals(Helligkeit.SYSTEM, brightnessApplies(null, null))
        assertEquals(Helligkeit.SYSTEM, brightnessApplies(null, true))
        assertEquals(Helligkeit.LIGHT, brightnessApplies(null, false))
        assertEquals(Helligkeit.DARK, brightnessApplies(Helligkeit.DARK, false))
        assertEquals("Unbekanntes faellt auf die fruehere Wahl zurueck", Helligkeit.LIGHT, brightnessApplies("blau", false))
    }

    @Test
    fun `Workbench stays as it is`() {
        assertEquals(Darstellung(Design.WERKBANK, false), darstellung(Design.WERKBANK, helligkeit = Helligkeit.SYSTEM, systemDark = true))
    }

    // Die Einstellungen schalten Hell/Dunkel bei Werkbank ab. Gegenprobe (02.11.2026,
    // kotlinc): brightnessSelectable gibt immer true zurück → rot.
    @Test
    fun `with Workbench Light and Dark cannot be chosen`() {
        assertTrue(!brightnessSelectable(Design.WERKBANK))
        assertTrue(brightnessSelectable(Design.CLASSIC))
        assertTrue(brightnessSelectable(Design.WERKBANK, systemfarben = true, sdk = 31))
    }

    // Gegenprobe: in darstellung() `sdk >= SYSTEMFARBEN_AB_SDK`
    // entfernt → rot (Android 11); `dynamisch ||` entfernt → rot (Werkbank dunkel).
    @Test
    fun `system colors apply only from Android 12 and always have a dark version`() {
        assertEquals(Darstellung(Design.CLASSIC, false, systemfarben = false),
            darstellung(Design.CLASSIC, helligkeit = Helligkeit.SYSTEM, systemDark = false, systemfarben = true, sdk = 30))
        assertEquals(Darstellung(Design.CLASSIC, false, systemfarben = true),
            darstellung(Design.CLASSIC, helligkeit = Helligkeit.SYSTEM, systemDark = false, systemfarben = true, sdk = 31))
        assertEquals(Darstellung(Design.WERKBANK, true, systemfarben = true),
            darstellung(Design.WERKBANK, helligkeit = Helligkeit.SYSTEM, systemDark = true, systemfarben = true, sdk = 34))
        assertEquals("Ohne Wahl kein Dunkel, auch mit Systemfarben", Darstellung(Design.BRICK, false, systemfarben = true),
            darstellung(Design.BRICK, helligkeit = Helligkeit.LIGHT, systemDark = true, systemfarben = true, sdk = 34))
    }

    @Test
    fun `without a saved choice the app follows the system`() {
        assertTrue(darkAfterSystemApplies(null))
    }

    @Test
    fun `an explicit choice persists`() {
        assertEquals(false, darkAfterSystemApplies(false))
        assertEquals(true, darkAfterSystemApplies(true))
    }

    @Test
    fun `MainActivity draws the effective design`() {
        val src = Quellen.withoutComments(Quellen.lies("app/MainActivity.kt"))
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
    fun `the start does not flash white`() {
        val res = Quellen.res
        val night = File(res, "values-night/themes.xml")
        assertTrue("values-night/themes.xml fehlt", night.isFile)
        assertTrue("Das Nacht-Theme erbt wieder von einem hellen",
            Regex("""name="Theme\.BrickInventoryManager"\s+parent="[^"]*Light""").find(night.readText()) == null)
        assertTrue("values-night/colors.xml setzt keinen eigenen Fensterhintergrund",
            File(res, "values-night/colors.xml").readText().contains("fenster_hintergrund"))

        val manifest = Quellen.manifest.readText()
        assertTrue("Die Activity startet nicht im SplashScreen-Theme",
            manifest.contains("@style/Theme.BrickInventoryManager.Start"))

        val src = Quellen.withoutComments(Quellen.lies("app/MainActivity.kt"))
        val splash = src.indexOf("installSplashScreen()")
        val oncreate = src.indexOf("super.onCreate(")
        assertTrue("installSplashScreen() fehlt oder steht nach super.onCreate()",
            splash in 0 until oncreate)
    }
}
