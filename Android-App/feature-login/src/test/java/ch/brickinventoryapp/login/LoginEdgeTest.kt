package ch.brickinventoryapp.login

import ch.brickinventoryapp.model.ui.theme.Design
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
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
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
 *   anmeldung-hinter-tastatur     imePadding() aus outsideTheSystemBars → rot „Registrieren bleibt …“
 *   anmeldung-unter-leisten       systemBarsPadding() aus outsideTheSystemBars → rot „Anmelden beginnt …“
 *   erweitert-ohne-zustand        Semantik am Knopf „Erweitert“ entfernt → rot „Erweitert meldet …“
 *   registrieren-tablet-einspaltig  zweispaltig erst ab 4000 dp → rot „auf dem Tablet …“
 *   weiter-wieder-tonal           „Weiter“ wieder FilledTonalButton → rot „Weiter hebt sich …“
 *   adresse-langes-etikett        setup_url_label wieder „Serveradresse der BrickInventory Manager Web-App“
 *                                 → rot „das Adressfeld traegt ein kurzes Etikett …“ (zwei Zeilen)
 *   anmelden-gesperrt-ohne-felder Knopf wieder nur mit Name und Passwort aktiv → rot „Anmelden bleibt tippbar …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class LoginEdgeTest {

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
            BrickInventoryManagerTheme(theme = checkNotNull(Design.aus(design)) { design }, dunkel = dunkel) {
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
    private fun bars(keyboard: Int = 0) {
        val b = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, px(24).roundToInt(), 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px(48).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(), true)
        if (keyboard > 0) b.setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, px(keyboard).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.ime(), true)
        val inhalt = compose.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        compose.runOnUiThread { ViewCompat.dispatchApplyWindowInsets(inhalt, b.build()) }
        compose.waitForIdle()
    }

    private fun hoehe() = compose.onRoot().fetchSemanticsNode().boundsInRoot.height

    /** Die Rollfläche ist der sichtbare Ausschnitt: Sie muss zwischen den Leisten liegen. */
    private fun checkBetweenBars(was: String) {
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
        bars()
        checkBetweenBars("Anmelden")
    }

    @Test
    fun `Registrieren liegt zwischen den Leisten bis zum letzten Knopf`() {
        zeige { Anmeldung(AnmeldeFormular.REGISTER) }
        bars()
        checkBetweenBars("Registrieren")
        val zurueck = compose.onNode(hasText(text(R.string.login_back)) and hasClickAction())
        zurueck.performScrollTo()
        compose.waitForIdle()
        val unten = zurueck.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("„Zurück zur Anmeldung“ unter der Gestenleiste", unten <= hoehe() - px(48) + 1f)
    }

    @Test
    fun `Einrichten liegt zwischen den Leisten`() {
        zeige { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
        bars()
        checkBetweenBars("Einrichten")
    }

    /** Gesperrt und blass liess der Knopf raten, warum nichts geschieht; jetzt sagt es das Feld. */
    @Test
    fun `Anmelden bleibt tippbar und nennt bei leeren Feldern am Feld, was fehlt`() {
        var logins = 0
        zeige {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> logins++ }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        val button = compose.onNode(hasText(text(R.string.login_button)) and hasClickAction())
        button.performScrollTo()
        button.assertIsEnabled()
        assertTrue("Vor dem Tipp kein Fehler", compose.onAllNodes(hasText(text(R.string.login_username_fehlt)))
            .fetchSemanticsNodes().isEmpty())
        button.performClick()
        compose.waitForIdle()
        assertEquals("Mit leeren Feldern geht nichts hinaus", 0, logins)
        for (id in listOf(R.string.login_username_fehlt, R.string.login_password_fehlt)) {
            assertEquals(text(id), 1, compose.onAllNodes(hasText(text(id))).fetchSemanticsNodes().size)
        }
    }

    /** Ein Satz als Etikett brach schon bei 100 % Schrift um und stand beim Tippen über dem Feld. */
    @Test
    fun `das Adressfeld traegt ein kurzes Etikett in einer Zeile, die Erklaerung steht darunter`() {
        zeige { SetupScreen(currentUrl = "", onSave = {}, entwicklung = false) }
        val zeilen = compose.onAllNodes(hasText(text(R.string.setup_url_label)), useUnmergedTree = true)
            .fetchSemanticsNodes().mapNotNull { node ->
                node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.let { holen ->
                    mutableListOf<TextLayoutResult>().also { holen(it) }.firstOrNull()?.lineCount
                }
            }
        assertTrue("Kein Etikett gefunden", zeilen.isNotEmpty())
        assertTrue("Das Etikett bricht um: $zeilen Zeilen", zeilen.all { it == 1 })
        val feld = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = feld.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("Die Erklärung fehlt unter dem Feld: $texts", text(R.string.setup_url_supporting) in texts)
    }

    @Test
    fun `Registrieren bleibt ueber der Tastatur erreichbar`() {
        zeige { Anmeldung(AnmeldeFormular.REGISTER) }
        bars(keyboard = 300)
        val button = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
        button.performScrollTo()
        compose.waitForIdle()
        val unten = button.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("Registrieren bleibt hinter der Tastatur: unten ${unten / dichte} dp, Tastatur ab " +
            "${(hoehe() - px(300)) / dichte} dp", unten <= hoehe() - px(300) + 1f)
    }

    @Test
    fun `Erweitert meldet ob der Bereich offen ist`() {
        zeige { Anmeldung(AnmeldeFormular.ANMELDEN) }
        val button = compose.onNode(hasText(text(R.string.login_erweitert)) and hasClickAction())
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.zustand_eingeklappt)))
        button.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Expand))
        button.performClick()
        compose.waitForIdle()
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.zustand_ausgeklappt)))
        button.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Collapse))
    }

    @Test
    fun `Registrieren steht auf dem Tablet ohne Rollen im Bild`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        zeige { Anmeldung(AnmeldeFormular.REGISTER) }
        val button = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Registrieren auf dem Tablet unter dem Falz: unten ${button.bottom / dichte} dp von ${hoehe() / dichte}",
            button.bottom <= hoehe() - px(24))
        val marke = compose.onNode(hasText(text(R.string.app_name))).fetchSemanticsNode().boundsInRoot
        assertTrue("Marke klebt am oberen Rand: ${marke.top / dichte} dp", marke.top >= px(24))
    }

    private fun contrast(a: Color, b: Color): Double {
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
            BrickInventoryManagerTheme(theme = checkNotNull(Design.aus(design)) { design }, dunkel = dunkel) {
                karte = MaterialTheme.colorScheme.surface
                Surface(color = MaterialTheme.colorScheme.background) {
                    key(fall) { SetupScreen(currentUrl = url, onSave = {}, entwicklung = false) }
                }
            }
        }
        val findings = listOf("classic", "brick", "noppe").flatMap { d -> listOf(false, true).map { d to it } }
            .flatMap { (design, dunkel) ->
                fall = Triple(design, dunkel, "https://brick.fritz.box")
                compose.waitForIdle()
                val aktiv = flaeche(R.string.setup_continue)
                fall = Triple(design, dunkel, "")
                compose.waitForIdle()
                val gesperrt = flaeche(R.string.setup_continue)
                val name = "$design/${if (dunkel) "dunkel" else "hell"}"
                listOfNotNull(
                    contrast(aktiv, karte).takeIf { it < 3.0 }?.let { "$name: Weiter zur Karte $it:1" },
                    contrast(aktiv, gesperrt).takeIf { it < 1.5 }?.let { "$name: aktiv zu gesperrt $it:1" },
                )
            }
        assertTrue(findings.joinToString("\n"), findings.isEmpty())
    }
}
