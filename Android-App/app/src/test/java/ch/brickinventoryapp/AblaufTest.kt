package ch.brickinventoryapp

import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.GutscheinUiState
import ch.brickinventoryapp.ui.screens.AddSetDialog
import ch.brickinventoryapp.ui.screens.GutscheineCard
import ch.brickinventoryapp.ui.screens.LoginScreen
import ch.brickinventoryapp.ui.screens.SetDetailScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Die Kernabläufe als Oberflächentest auf der JVM (Robolectric): anmelden, Set
 * erfassen, Menge ändern, Gutschein ansehen. Jede Aktion läuft durch die
 * Barrierefreiheitsprüfung (ATF): Ein Knopf ohne Beschriftung, ein zu kleines
 * Ziel oder zu wenig Kontrast lässt den Test scheitern.
 *
 * Gegenproben — in CI zu messen (hier gibt es kein Android):
 *   (a) im Anmeldeknopf `onLogin(password, username, …)` vertauscht → rot
 *       „anmelden reicht Name und Passwort weiter“; ebenso das verticalScroll
 *       im LoginScreen entfernt (der Knopf läge auf dem kleinen Robolectric-
 *       Schirm unerreichbar unter dem Rand)
 *   (b) der Plus-Knopf ohne Beschreibung → ATF rot in „die Menge aendern …“
 *   (c) AddSetDialog übergibt die Anzahl fest als 1 → rot „ein Set erfassen …“
 *   (d) Gutschein-PIN immer sichtbar → rot „ein Gutschein zeigt den PIN …“
 */
@RunWith(RobolectricTestRunner::class)
// NATIVE wie bei den Bildschirmfotos: Die Kontrastprüfung des ATF liest ein
// Bildschirmfoto, und im LEGACY-Grafikmodus von Robolectric gibt es keins.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class AblaufTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Before
    fun auf() = compose.enableAccessibilityChecks()

    private var welt: Beispiele.Welt? = null

    @After
    fun zu() { welt?.close() }

    private fun zeige(inhalt: @androidx.compose.runtime.Composable () -> Unit) =
        compose.setContent { BrickInventoryManagerTheme { Surface { inhalt() } } }

    @Test
    fun `anmelden reicht Name und Passwort weiter`() {
        var gesendet: Triple<String, String, String?>? = null
        zeige {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = false, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { n, p, c -> gesendet = Triple(n, p, c) },
                onFormular = {}, onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        compose.onNodeWithText(ctx.getString(R.string.login_username)).performTextInput("marco")
        compose.onNodeWithText(ctx.getString(R.string.login_password)).performTextInput("geheim")
        // Wie ein Mensch: erst hinrollen, dann tippen. Der Knopf liegt auf einem
        // kleinen Bildschirm unter dem Rand.
        compose.onNode(hasText(ctx.getString(R.string.login_button)) and hasClickAction())
            .performScrollTo().performClick()
        assertEquals(Triple("marco", "geheim", null), gesendet)
    }

    @Test
    fun `ein Set erfassen nimmt Nummer und Anzahl`() {
        var erfasst: Pair<String, Int>? = null
        zeige { AddSetDialog(onDismiss = {}, onAdd = { nr, anzahl, _, _, _, _ -> erfasst = nr to anzahl }) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("75192")
        compose.onNodeWithText(ctx.getString(R.string.common_quantity)).performTextReplacement("3")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        assertEquals("75192" to 3, erfasst)
    }

    @Test
    fun `die Menge aendern schickt einen Schritt an den Server`() {
        val w = Beispiele.Welt().also { welt = it }
        val vm = w.setDetail()
        w.pfade.antworten["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Millennium Falcon","quantity":2}}"""
        zeige {
            SetDetailScreen(setNumber = Beispiele.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        compose.onNodeWithContentDescription(ctx.getString(R.string.cd_qty_increase)).performClick()
        compose.waitUntil(10_000) { w.pfade.anfragenAn("PUT /api/v1/sets/75192-1").isNotEmpty() }
        assertTrue(w.pfade.koerper.any { it.contains("\"quantity_delta\":1") })
    }

    @Test
    fun `ein Gutschein zeigt den PIN erst auf Wunsch`() {
        var zustand by mutableStateOf(GutscheinUiState(gutscheine = listOf(
            Gutschein(id = 7, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = "CHF"))))
        zeige {
            GutscheineCard(
                zustand = zustand, onFeld = { _, _, _, _ -> },
                onPinSchalten = { id -> zustand = zustand.copy(pinSichtbar = zustand.pinSichtbar + id) },
                onBearbeiten = {}, onAbbrechen = {}, onSpeichern = {}, onLoeschen = {}, onPdfOeffnen = {},
                onKopieren = { _, _ -> }, onGuthaben = {}, onExportieren = {}, onGuthabenAlle = {},
                onGuthabenAbbrechen = {}, onErneut = {},
            )
        }
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertIsDisplayed()
    }
}
