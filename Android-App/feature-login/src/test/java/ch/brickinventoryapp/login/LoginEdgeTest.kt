package ch.brickinventoryapp.login

import android.graphics.drawable.ColorDrawable
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
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextLayoutResult
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import ch.brickinventoryapp.login.ui.LoginForm
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
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
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Sign-in, register and setup stand without a frame on the whole window
 * (enableEdgeToEdge). Run with reported bars (status 24 dp, gestures 48 dp)
 *
 * Counter-checks (patches under counter-checks/, measured only in the CI — Robolectric):
 *   anmeldung-hinter-tastatur     imePadding() removed from outsideTheSystemBars → red “Registrieren stays …”
 *   anmeldung-unter-leisten       systemBarsPadding() removed from outsideTheSystemBars → red “Anmelden starts …”
 *   erweitert-ohne-zustand        semantics removed from the „Erweitert“ button → red “Erweitert reports …”
 *   registrieren-tablet-einspaltig  two columns only from 4000 dp → red “on the tablet …”
 *   weiter-wieder-tonal           „Weiter“ back to FilledTonalButton → red “Weiter stands out …”
 *   adresse-langes-etikett        setup_url_label back to „Serveradresse der BrickInventory Manager Web-App“
 *                                 → red “the address field carries a short label …” (two lines)
 *   anmelden-gesperrt-ohne-felder button active again only with a name and password → red “Anmelden stays tappable …”
 *   `.background(…)` removed from TwoPartLayout → red “… the window shows through” in both
 *                                 tests below (transparent instead of the dark background)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class LoginEdgeTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val before = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() = Locale.setDefault(before)

    private fun text(id: Int) = compose.activity.getString(id)
    private val density get() = compose.activity.resources.displayMetrics.density
    private fun px(dp: Int) = dp * density

    private fun show(design: String = "classic", dark: Boolean = false, content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.from(design)) { design }, dark = dark) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        compose.waitForIdle()
    }

    @Composable
    private fun Login(form: LoginForm) = LoginScreen(
        LoginScreenState(serverUrl = "https://brick.example.org", form = form, registrationOpen = true),
        object : LoginActions {},
    )

    /** Reports bars and keyboard like a device on which the app draws under the bars. */
    private fun bars(keyboard: Int = 0) {
        val b = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, px(24).roundToInt(), 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, px(48).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars(), true)
        if (keyboard > 0) b.setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, px(keyboard).roundToInt()))
            .setVisible(WindowInsetsCompat.Type.ime(), true)
        val content = compose.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
        compose.runOnUiThread { ViewCompat.dispatchApplyWindowInsets(content, b.build()) }
        compose.waitForIdle()
    }

    private fun height() = compose.onRoot().fetchSemanticsNode().boundsInRoot.height

    /** The scroll area is the visible viewport: it must lie between the bars. */
    private fun checkBetweenBars(was: String) {
        val surface = compose.onNode(hasScrollAction()).fetchSemanticsNode().boundsInRoot
        assertTrue("$was starts under the status bar: ${surface.top / density} dp", surface.top >= px(24) - 1f)
        assertTrue("$was ends under the gesture bar: ${(height() - surface.bottom) / density} dp free",
            surface.bottom <= height() - px(48) + 1f)
        val brand = compose.onNode(hasText(text(R.string.app_name))).fetchSemanticsNode().boundsInRoot
        assertTrue("$was: brand too close to the status bar (${brand.top / density} dp)", brand.top >= px(24 + 16) - 1f)
    }

    /**
     * Before sign-in no Scaffold paints: with „Dunkel“ chosen and a light system theme the
     * light window background shone between the dark cards. Without a Surface around it, as in the app.
     */
    private fun checkOwnBackground(content: @Composable () -> Unit) {
        compose.runOnUiThread { compose.activity.window.setBackgroundDrawable(ColorDrawable(0xFFF1F5F9.toInt())) }
        var background = Color.Unspecified
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.from("classic")), dark = true) {
                background = MaterialTheme.colorScheme.background
                content()
            }
        }
        compose.waitForIdle()
        val image = compose.onRoot().captureToImage().toPixelMap()
        // The left edge beside the centered column: no card lies there.
        for (y in listOf(image.height / 4, image.height / 2, image.height * 3 / 4))
            assertEquals("at y=$y the window shows through", background.toArgb(), image[1, y].toArgb())
    }

    @Test
    fun `setup paints the dark background itself, the window shows through nowhere`() =
        checkOwnBackground { SetupScreen(currentUrl = "", onSave = {}, development = false) }

    @Test
    fun `sign-in paints the dark background itself, the window shows through nowhere`() =
        checkOwnBackground { Login(LoginForm.LOGIN) }

    @Test
    fun `sign-in starts below the status bar and ends above the gesture bar`() {
        show { Login(LoginForm.LOGIN) }
        bars()
        checkBetweenBars("Anmelden")
    }

    @Test
    fun `register lies between the bars up to the last button`() {
        show { Login(LoginForm.REGISTER) }
        bars()
        checkBetweenBars("Registrieren")
        val back = compose.onNode(hasText(text(R.string.login_back)) and hasClickAction())
        back.performScrollTo()
        compose.waitForIdle()
        val bottom = back.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("„Zurück zur Anmeldung“ under the gesture bar", bottom <= height() - px(48) + 1f)
    }

    @Test
    fun `setup lies between the bars`() {
        show { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, development = false) }
        bars()
        checkBetweenBars("Einrichten")
    }

    /** Disabled and pale, the button left one guessing why nothing happens; now the field says so. */
    @Test
    fun `sign-in stays tappable and names at the field what is missing for empty fields`() {
        var logins = 0
        show {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = true),
                object : LoginActions {
                    override fun login(username: String, password: String, code: String?) { logins++ }
                },
            )
        }
        val button = compose.onNode(hasText(text(R.string.login_button)) and hasClickAction())
        button.performScrollTo()
        button.assertIsEnabled()
        assertTrue("No error before the tap", compose.onAllNodes(hasText(text(R.string.login_username_missing)))
            .fetchSemanticsNodes().isEmpty())
        button.performClick()
        compose.waitForIdle()
        assertEquals("With empty fields nothing goes out", 0, logins)
        for (id in listOf(R.string.login_username_missing, R.string.login_password_missing)) {
            assertEquals(text(id), 1, compose.onAllNodes(hasText(text(id))).fetchSemanticsNodes().size)
        }
    }

    /** A sentence as a label already wrapped at 100 % font and stood over the field while typing. */
    @Test
    fun `the address field carries a short label in one line, the explanation is below`() {
        show { SetupScreen(currentUrl = "", onSave = {}, development = false) }
        val rows = compose.onAllNodes(hasText(text(R.string.setup_url_label)), useUnmergedTree = true)
            .fetchSemanticsNodes().mapNotNull { node ->
                node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.let { fetch ->
                    mutableListOf<TextLayoutResult>().also { fetch(it) }.firstOrNull()?.lineCount
                }
            }
        assertTrue("No label found", rows.isNotEmpty())
        assertTrue("The label wraps: $rows lines", rows.all { it == 1 })
        val field = compose.onNode(hasSetTextAction()).fetchSemanticsNode()
        val texts = field.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
        assertTrue("The explanation is missing below the field: $texts", text(R.string.setup_url_supporting) in texts)
    }

    @Test
    fun `register stays reachable above the keyboard`() {
        show { Login(LoginForm.REGISTER) }
        bars(keyboard = 300)
        val button = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
        button.performScrollTo()
        compose.waitForIdle()
        val bottom = button.fetchSemanticsNode().boundsInRoot.bottom
        assertTrue("Register stays behind the keyboard: bottom ${bottom / density} dp, keyboard from " +
            "${(height() - px(300)) / density} dp", bottom <= height() - px(300) + 1f)
    }

    @Test
    fun `Advanced reports whether the area is open`() {
        show { Login(LoginForm.LOGIN) }
        val button = compose.onNode(hasText(text(R.string.login_extended)) and hasClickAction())
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.state_collapsed)))
        button.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Expand))
        button.performClick()
        compose.waitForIdle()
        button.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, text(R.string.state_expanded)))
        button.assert(SemanticsMatcher.keyIsDefined(SemanticsActions.Collapse))
    }

    @Test
    fun `register stands in view on the tablet without scrolling`() {
        RuntimeEnvironment.setQualifiers("de-rCH-w1280dp-h800dp-land-xhdpi")
        show { Login(LoginForm.REGISTER) }
        val button = compose.onNode(hasText(text(R.string.register_button)) and hasClickAction())
            .fetchSemanticsNode().boundsInRoot
        assertTrue("Register on the tablet below the fold: bottom ${button.bottom / density} dp of ${height() / density}",
            button.bottom <= height() - px(24))
        val brand = compose.onNode(hasText(text(R.string.app_name))).fetchSemanticsNode().boundsInRoot
        assertTrue("Brand sticks to the top edge: ${brand.top / density} dp", brand.top >= px(24))
    }

    private fun contrast(a: Color, b: Color): Double {
        val (light, dark) = max(a.luminance(), b.luminance()) to min(a.luminance(), b.luminance())
        return (light + 0.05) / (dark + 0.05)
    }

    /** A button's surface, inside left at half height — no text stands there. */
    private fun surface(id: Int): Color {
        val image = compose.onNode(hasText(text(id)) and hasClickAction()).captureToImage().toPixelMap()
        return image[image.width / 16, image.height / 2]
    }

    @Test
    fun `Next stands out in every design from the card and from the disabled state`() {
        // One setContent per test: theme and address switch via the state.
        var fall by mutableStateOf(Triple("classic", false, "https://brick.fritz.box"))
        var card = Color.Unspecified
        compose.setContent {
            val (design, dark, url) = fall
            BrickInventoryManagerTheme(theme = checkNotNull(Design.from(design)) { design }, dark = dark) {
                card = MaterialTheme.colorScheme.surface
                Surface(color = MaterialTheme.colorScheme.background) {
                    key(fall) { SetupScreen(currentUrl = url, onSave = {}, development = false) }
                }
            }
        }
        val findings = listOf("classic", "brick", "noppe").flatMap { d -> listOf(false, true).map { d to it } }
            .flatMap { (design, dark) ->
                fall = Triple(design, dark, "https://brick.fritz.box")
                compose.waitForIdle()
                val active = surface(R.string.setup_continue)
                fall = Triple(design, dark, "")
                compose.waitForIdle()
                val locked = surface(R.string.setup_continue)
                val name = "$design/${if (dark) "dunkel" else "hell"}"
                listOfNotNull(
                    contrast(active, card).takeIf { it < 3.0 }?.let { "$name: Weiter zur Karte $it:1" },
                    contrast(active, locked).takeIf { it < 1.5 }?.let { "$name: aktiv zu gesperrt $it:1" },
                )
            }
        assertTrue(findings.joinToString("\n"), findings.isEmpty())
    }
}
