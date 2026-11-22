package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Brightness
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.theme.brightnessApplies
import ch.brickinventoryapp.model.ui.theme.darkAfterSystemApplies
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.theme.Appearance
import ch.brickinventoryapp.ui.theme.appearance
import ch.brickinventoryapp.ui.theme.brightnessSelectable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * System, light or dark per device: the dark version of the SAME design with
 * „Dunkel“ always, with „System“ only if the system is dark; Workbench is already
 * dark. Without a saved choice the app follows the system, an earlier one stays.
 *
 * Counter-checks (29.10.2026, measured against ui/theme/Appearance.kt or
 * MainActivity.kt):
 *   A  in appearance() the `&& systemDark` removed → red “with a choice dark
 *      only with a dark system, in the same design”
 *   B  `?: true` → `?: false` → red “without a saved choice the app follows the system"
 *   C  MainActivity without `dark = view.dark` → red in MainActivityDesignTest
 *   D  installSplashScreen() after super.onCreate() → red “the start does not flash white"
 *   E  `&& hasDarkVersion(design)` removed → red “Workbench stays as it is“
 *   F  in appearance() the branch `Brightness.DARK -> true` removed →
 *      red “Dark applies also with a light system …”
 *   G  in brightnessApplies() the check for known values removed →
 *      red “the former yes-no choice …” („blau“ got through)
 */
class EffectiveDesignTest {

    @Test
    fun `without a choice the server's design applies, also with a dark system`() {
        assertEquals(Appearance(Design.BRICK, false), appearance(Design.BRICK, brightness = Brightness.LIGHT, systemDark = true))
    }

    @Test
    fun `with a choice dark only with a dark system, in the same design`() {
        assertEquals(Appearance(Design.CLASSIC, true), appearance(Design.CLASSIC, brightness = Brightness.SYSTEM, systemDark = true))
        assertEquals(Appearance(Design.STUD, true), appearance(Design.STUD, brightness = Brightness.SYSTEM, systemDark = true))
        assertEquals(Appearance(Design.CLASSIC, false), appearance(Design.CLASSIC, brightness = Brightness.SYSTEM, systemDark = false))
    }

    @Test
    fun `Dark applies also with a light system, Light also with a dark one`() {
        assertEquals(Appearance(Design.BRICK, true), appearance(Design.BRICK, brightness = Brightness.DARK, systemDark = false))
        assertEquals(Appearance(Design.STUD, false), appearance(Design.STUD, brightness = Brightness.LIGHT, systemDark = true))
    }

    @Test
    fun `the former yes-no choice becomes System or Light`() {
        assertEquals(Brightness.SYSTEM, brightnessApplies(null, null))
        assertEquals(Brightness.SYSTEM, brightnessApplies(null, true))
        assertEquals(Brightness.LIGHT, brightnessApplies(null, false))
        assertEquals(Brightness.DARK, brightnessApplies(Brightness.DARK, false))
        assertEquals("unknown falls back to the earlier choice", Brightness.LIGHT, brightnessApplies("blau", false))
    }

    @Test
    fun `Workbench stays as it is`() {
        assertEquals(Appearance(Design.WORKBENCH, false), appearance(Design.WORKBENCH, brightness = Brightness.SYSTEM, systemDark = true))
    }

    // The settings switch off light/dark for Workbench. Counter-check (02.11.2026,
    // kotlinc): brightnessSelectable always returns true → red.
    @Test
    fun `with Workbench Light and Dark cannot be chosen`() {
        assertTrue(!brightnessSelectable(Design.WORKBENCH))
        assertTrue(brightnessSelectable(Design.CLASSIC))
        assertTrue(brightnessSelectable(Design.WORKBENCH, systemColors = true, sdk = 31))
    }

    // Counter-check: in appearance() `sdk >= SYSTEM_COLORS_AB_SDK`
    // removed → red (Android 11); `dynamic ||` removed → red (Workbench dark).
    @Test
    fun `system colors apply only from Android 12 and always have a dark version`() {
        assertEquals(Appearance(Design.CLASSIC, false, systemColors = false),
            appearance(Design.CLASSIC, brightness = Brightness.SYSTEM, systemDark = false, systemColors = true, sdk = 30))
        assertEquals(Appearance(Design.CLASSIC, false, systemColors = true),
            appearance(Design.CLASSIC, brightness = Brightness.SYSTEM, systemDark = false, systemColors = true, sdk = 31))
        assertEquals(Appearance(Design.WORKBENCH, true, systemColors = true),
            appearance(Design.WORKBENCH, brightness = Brightness.SYSTEM, systemDark = true, systemColors = true, sdk = 34))
        assertEquals("without a choice no dark, even with system colors", Appearance(Design.BRICK, false, systemColors = true),
            appearance(Design.BRICK, brightness = Brightness.LIGHT, systemDark = true, systemColors = true, sdk = 34))
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

    /**
     * Until the first Compose frame Android shows the window theme. If it was fixed
     * light, white flashed in dark mode.
     */
    @Test
    fun `the start does not flash white`() {
        val res = Sources.res
        val night = File(res, "values-night/themes.xml")
        assertTrue("values-night/themes.xml is missing", night.isFile)
        assertTrue("the night theme inherits from a light one again",
            Regex("""name="Theme\.BrickInventoryManager"\s+parent="[^"]*Light""").find(night.readText()) == null)
        assertTrue("values-night/colors.xml sets no window background of its own",
            File(res, "values-night/colors.xml").readText().contains("window_background"))

        val manifest = Sources.manifest.readText()
        assertTrue("the activity does not start in the SplashScreen theme",
            manifest.contains("@style/Theme.BrickInventoryManager.Start"))

        val src = Sources.withoutComments(Sources.read("app/MainActivity.kt"))
        val splash = src.indexOf("installSplashScreen()")
        val oncreate = src.indexOf("super.onCreate(")
        assertTrue("installSplashScreen() is missing or stands after super.onCreate()",
            splash in 0 until oncreate)
    }
}
