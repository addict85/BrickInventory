package ch.brickinventoryapp.app

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.zustand.ui.AnmeldeFormular
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import java.util.Locale

/**
 * Anmelden, Registrieren und Einrichten stehen ohne Gerüst auf dem ganzen Fenster
 * (enableEdgeToEdge). Ausgeführt mit gemeldeten Leisten (Status 24 dp, Gesten 48 dp)
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   anmeldung-hinter-tastatur     imePadding() aus ausserhalbDerSystemleisten → rot „Registrieren bleibt …“
 *   anmeldung-unter-leisten       systemBarsPadding() aus ausserhalbDerSystemleisten → rot „Anmelden beginnt …“
 *   erweitert-ohne-zustand        Semantik am Knopf „Erweitert“ entfernt → rot „Erweitert meldet …“
 *   registrieren-tablet-einspaltig  zweispaltig erst ab 4000 dp → rot „auf dem Tablet …“
 *   weiter-wieder-tonal           „Weiter“ wieder FilledTonalButton → rot „Weiter hebt sich …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class AnmeldeRandTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() = Locale.setDefault(vorher)

    private fun text(id: Int) = compose.activity.getString(id)
    private val dichte get() = compose.activity.resources.displayMetrics.density
    private fun px(dp: Int) = dp * dichte

    private fun zeige(design: String = "classic", dunkel: Boolean = false, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = design, dunkel = dunkel) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    @Composable
    private fun Anmeldung(formular: AnmeldeFormular) = LoginScreen(
        serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
        formular = formular, registrierungOffen = true, kontoLaeuft = false,
        kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
        onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
    )

    /** Meldet Leisten und Tastatur wie ein Gerät, auf dem die App unter die Leisten zeichnet. */
    private fun leisten(tastatur: Int = 0) {
        val b = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, px(24).roundToInt(), 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px(48).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(), true)
        if (tastatur > 0) b.setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, px(tastatur).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.ime(), true)
        val inhalt = compose.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        compose.runOnUiThread { ViewCompat.dispatchApplyWindowInsets(inhalt, b.build()) }
        compose.waitForIdle()
    }

    private fun hoehe() = compose.onRoot().fetchSemanticsNode().boundsInRoot.height

    /** Die Rollfläche ist der sichtbare Ausschnitt: Sie muss zwischen den Leisten liegen. */
    private fun pruefeZwischenLeisten(was: String) {
        val flaeche = compose.onNode(hasScrollAction()).fetchSemanticsNode().boundsInRoot
        assertTrue("$was beginnt unter der Statusleiste: ${flaeche.top / dichte} dp", flaeche.top >= px(24) - 1f)
        assertTrue("$was endet unter der Gestenleiste: ${(hoehe() - flaeche.bottom) / dichte} dp frei",
            flaeche.bottom <= hoehe() - px(48) + 1f)
        val marke = compose.onNode(hasText(text(R.string.app_name))).fetchSemanticsNode().boundsInRoot
        assertTrue("$was: Marke zu nah an der Statusleiste (${marke.top / dichte} dp)", marke.top >= px(24 + 16) - 1f)
    }

    @Test
    fun `Anmelden beginnt unter der Statusleiste und endet ueber der Gestenleiste`() {
        zeige { Anmeldung(AnmeldeFormular.ANMELDEN) }
        leisten()
        pruefeZwischenLeisten("Anmelden")
    }

    @Test
    fun `Registrieren liegt zwischen den Leisten bis zum letzten Knopf`() {
        zeige { Anmeldung(AnmeldeFormular.REGISTRIEREN) }
        leisten()
        pruefeZwischenLeisten("Registrieren")
        val zurueck = compose.onNode(hasText(text(R.string.login_back)) and hasClickAction())
        zurueck.performScrollTo()
        compose.waitForIdle()
        val unten = zurueck.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("„Zurück zur Anmeldung“ unter der Gestenleiste", unten <= hoehe() - px(48) + 1f)
    }

    @Test
    fun `Einrichten liegt zwischen den Leisten`() {
        zeige { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
        leisten()
        pruefeZwischenLeisten("Einrichten")
    }

    @Test
    fun `Registrieren bleibt ueber der Tastatur erreichbar`() {
        zeige { Anmeldung(AnmeldeFormular.REGISTRIEREN) }
        leisten(tastatur = 300)
        val knopf = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
        knopf.performScrollTo()
        compose.waitForIdle()
        val unten = knopf.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("Registrieren bleibt hinter der Tastatur: unten ${unten / dichte} dp, Tastatur ab " +
            "${(hoehe() - px(300)) / dichte} dp", unten <= hoehe() - px(300) + 1f)
    }

    @Test
    fun `Erweitert meldet ob der Bereich offen ist`() {
        zeige { Anmeldung(AnmeldeFormular.ANMELDEN) }
        val knopf = compose.onNode(hasText(text(R.string.login_erweitert)) and hasClickAction())
        knopf.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.zustand_eingeklappt)))
        knopf.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Expand))
        knopf.performClick()
        compose.waitForIdle()
        knopf.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.zustand_ausgeklappt)))
        knopf.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Collapse))
    }

    @Test
    fun `Registrieren steht auf dem Tablet ohne Rollen im Bild`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { Anmeldung(AnmeldeFormular.REGISTRIEREN) }
        val knopf = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Registrieren auf dem Tablet unter dem Falz: unten ${knopf.bottom / dichte} dp von ${hoehe() / dichte}",
            knopf.bottom <= hoehe() - px(24))
        val marke = compose.onNode(hasText(text(R.string.app_name))).fetchSemanticsNode().boundsInRoot
        assertTrue("Marke klebt am oberen Rand: ${marke.top / dichte} dp", marke.top >= px(24))
    }

    private fun kontrast(a: Color, b: Color): Double {
        val (hell, dunkel) = max(a.luminance(), b.luminance()) to min(a.luminance(), b.luminance())
        return (hell + 0.05) / (dunkel + 0.05)
    }

    /** Die Fläche eines Knopfs, links innen in halber Höhe — dort steht keine Schrift. */
    private fun flaeche(id: Int): Color {
        val bild = compose.onNode(hasText(text(id)) and hasClickAction()).captureToImage().toPixelMap()
        return bild[bild.width / 16, bild.height / 2]
    }

    @Test
    fun `Weiter hebt sich in jedem Design von der Karte und vom gesperrten Zustand ab`() {
        // Ein setContent je Test: Design und Adresse wechseln über den Zustand.
        var fall by mutableStateOf(Triple("classic", false, "https://brick.fritz.box"))
        var karte = Color.Unspecified
        compose.setContent {
            val (design, dunkel, url) = fall
            BrickInventoryManagerTheme(theme = design, dunkel = dunkel) {
                karte = MaterialTheme.colorScheme.surface
                Surface(color = MaterialTheme.colorScheme.background) {
                    key(fall) { SetupScreen(currentUrl = url, onSave = {}, entwicklung = false) }
                }
            }
        }
        val befunde = listOf("classic", "brick", "noppe").flatMap { d -> listOf(false, true).map { d to it } }
            .flatMap { (design, dunkel) ->
                fall = Triple(design, dunkel, "https://brick.fritz.box")
                compose.waitForIdle()
                val aktiv = flaeche(R.string.setup_continue)
                fall = Triple(design, dunkel, "")
                compose.waitForIdle()
                val gesperrt = flaeche(R.string.setup_continue)
                val name = "$design/${if (dunkel) "dunkel" else "hell"}"
                listOfNotNull(
                    kontrast(aktiv, karte).takeIf { it < 3.0 }?.let { "$name: Weiter zur Karte $it:1" },
                    kontrast(aktiv, gesperrt).takeIf { it < 1.5 }?.let { "$name: aktiv zu gesperrt $it:1" },
                )
            }
        assertTrue(befunde.joinToString("\n"), befunde.isEmpty())
    }
}
