package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.resources.R
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.finances.ui.VoucherConfirmation
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.finances.ui.screens.GutscheineCard
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.Schrittschutz
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import android.os.Build

/**
 * The core flows as a UI test on the JVM (Robolectric): sign in, add a
 * set, change the quantity, view a voucher. Every action runs through the
 * accessibility check (ATF): a button without a label, a too small
 * target or too little contrast makes the test fail.
 *
 * Counter-checks (a) and (c) are measured by the CI job `gegenproben` (Android-App/
 * gegenproben/ablauf-*.patch, it requires red); (b) and (d) are not measured yet:
 *   (a) in the sign-in button `onLogin(password, username, …)` swapped → red
 *       “sign-in passes on name and password”
 *   (b) the plus button without description → ATF red in “changing the quantity …”
 *   (c) AddSetDialog passes the quantity as a fixed 1 → red “adding a set …”
 *   (d) voucher PIN always visible → red “a voucher shows the PIN …”
 *   (e) in GutscheineCard revealing without step guard (`switchOnPin(g.id)`
 *       directly) → red “without confirming the device lock the PIN stays hidden”
 *       (gegenproben/gutschein-pin-ohne-geraetesperre.patch)
 *   (f) the number copied without step guard → red “without device lock the
 *       number is not copied either” (gegenproben/gutschein-nummer-ohne-geraetesperre.patch)
 *   (g) in PasswordPrompt the code field never shown → red “the confirmation shows the
 *       code field only on demand” (gegenproben/gutschein-rueckfrage-ohne-code.patch)
 *   (g2) the refusal does not scroll into view → the same red, „Bitte den Code eingeben.“ is
 *       not visible (gegenproben/rueckfrage-meldung-ausser-sicht.patch; the state before
 *       the fix, red in CI on 0223f52)
 *   (h) in the set detail the trash always with confirmation → red “a set deletes
 *       immediately with undo …” (gegenproben/set-loeschen-doppelt-gesichert.patch)
 *   (i) adding without a number does not mark the field → red “a set without a number says …”
 *       (gegenproben/erfassen-ohne-grund.patch)
 *   (j) GutscheineCard without SecretKopierWarning() → red “below Android 13 the
 *       voucher page warns …” (gegenproben/gutschein-kopieren-ohne-warnung.patch)
 */
@RunWith(RobolectricTestRunner::class)
// NATIVE as for the screenshots: ATF's contrast check reads a
// screenshot, and in Robolectric's LEGACY graphics mode there is none.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AblaufTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Before
    fun auf() = compose.enableAccessibilityChecks()

    private var world: Examples.Welt? = null

    @After
    fun zu() { world?.close() }

    private fun zeige(inhalt: @androidx.compose.runtime.Composable () -> Unit) =
        compose.setContent { BrickInventoryManagerTheme { Surface { inhalt() } } }

    @Test
    fun `sign-in passes on name and password`() {
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
        // Like a human: scroll there first, then tap. The button lies below the edge
        // on a small screen.
        compose.onNode(hasText(ctx.getString(R.string.login_button)) and hasClickAction())
            .performScrollTo().performClick()
        assertEquals(Triple("marco", "geheim", null), gesendet)
    }

    @Test
    fun `adding a set takes number and quantity`() {
        var erfasst: Pair<String, Int>? = null
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst = it.setNumber to it.menge }) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("75192")
        compose.onNodeWithText(ctx.getString(R.string.common_quantity)).performTextReplacement("3")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        assertEquals("75192" to 3, erfasst)
    }

    /** Adding without a number adds nothing but says at the field what is missing (instead of gray without a reason). */
    @Test
    fun `a set without a number says what is missing when tapping Add`() {
        var erfasst = 0
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst++ }, immediatelyFocus = false) }
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Ohne Nummer wird nichts erfasst", 0, erfasst)
        compose.onNodeWithText(ctx.getString(R.string.erfassen_nummer_fehlt), useUnmergedTree = true).assertIsDisplayed()
    }

    /**
     * Every field of “Add set” carries a help line; without it the fields stood
     * unevenly far apart, and the hint about the price vanished as a placeholder while typing.
     * Counter-check: quantity field again without help line (only on error) → red, „Anzahl“ missing
     * (gegenproben/erfassen-menge-ohne-hilfezeile.patch).
     */
    @Test
    fun `every field when adding a set has a help line, also while typing`() {
        zeige { AddSetDialog(onDismiss = {}, onAdd = {}, immediatelyFocus = false) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_purchase_price)).performTextInput("12")
        compose.waitForIdle()
        for (id in listOf(R.string.gallery_set_number_placeholder, R.string.gallery_quantity_hint,
                R.string.common_unit_price_placeholder)) {
            compose.onNodeWithText(ctx.getString(id), useUnmergedTree = true).assertExists()
        }
    }

    /**
     * A number that is not a set number ("--") is not added and is explained at the field.
     * Counter-check: in numberError() the branch `!NumericInput.isSetNumber(nummer)` removed
     * → added is 1 and the hint is missing, both checks red.
     */
    @Test
    fun `a set with a nonsensical number says what is expected when adding`() {
        var erfasst = 0
        zeige { AddSetDialog(onDismiss = {}, onAdd = { erfasst++ }, immediatelyFocus = false) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("--")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Eine unsinnige Nummer wird nicht erfasst", 0, erfasst)
        compose.onNodeWithText(ctx.getString(R.string.erfassen_nummer_ungueltig), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `changing the quantity sends a step to the server`() {
        val w = Examples.Welt().also { world = it }
        val vm = w.setDetail()
        w.paths.antworten["/api/v1/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Millennium Falcon","quantity":2}}"""
        zeige {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = {})
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        // The quantity stands below value tiles and market price; on the small
        // Robolectric screen (320 × 470 dp) it is only there after scrolling.
        val plus = androidx.compose.ui.test.hasContentDescription(ctx.getString(R.string.cd_qty_increase))
        compose.onNode(androidx.compose.ui.test.hasScrollToNodeAction() and
            SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange))
            .performScrollToNode(plus)
        compose.onNode(plus).performClick()
        compose.waitUntil(10_000) { w.paths.requestsAn("PUT /api/v1/sets/75192-1").isNotEmpty() }
        assertTrue(w.paths.koerper.any { it.contains("\"quantity_delta\":1") })
    }

    /** One safeguard suffices: with “Undo” below no confirmation, without it there is one. */
    @Test
    fun `a set deletes immediately with undo, without undo only after confirmation`() {
        val w = Examples.Welt().also { world = it }
        val vm = w.setDetail()
        var rueckgaengig by mutableStateOf(true)
        val geloescht = mutableListOf<String>()
        zeige {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = { geloescht += it },
                rueckgaengigMoeglich = rueckgaengig)
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        val name = vm.setDetailState.value.setDetail?.name ?: Examples.SET
        val papierkorb = compose.onNodeWithContentDescription(ctx.getString(R.string.cd_set_delete, name))
        papierkorb.performClick()
        compose.waitForIdle()
        assertEquals("Mit Rückgängig sofort vorgemerkt", listOf(Examples.SET), geloescht)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertDoesNotExist()

        rueckgaengig = false
        compose.waitForIdle()
        papierkorb.performClick()
        compose.waitForIdle()
        assertEquals("Ohne Rückgängig erst nach der Rückfrage", 1, geloescht.size)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertExists()
    }

    /** The state of the voucher card; the tests of the confirmation change it. */
    private var zustand by mutableStateOf(GutscheinUiState(gutscheine = listOf(
        Gutschein(id = 7, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = Waehrung("CHF")).alsAnsicht())))

    /** The Android level the page chooses by; Robolectric itself runs against API 35. */
    private var stufe by mutableStateOf(Build.VERSION.SDK_INT)

    /** A voucher with PIN 4711; [protection] stands for the device lock. */
    private fun showVoucher(protection: Schrittschutz, kopiert: MutableList<String> = mutableListOf()) {
        zeige {
            CompositionLocalProvider(LocalSchrittschutz provides protection, LocalSdkLevel provides stufe) {
                GutscheineCard(
                    zustand = zustand, onFeld = { _, _, _, _ -> },
                    switchOnPin = { id -> zustand = zustand.copy(pinSichtbar = zustand.pinSichtbar + id) },
                    editOn = {}, onAbbrechen = {}, onSpeichern = {}, deleteOn = {}, openOnPdf = {},
                    onKopieren = { id, _ -> kopiert += id.toString() }, onBalance = {},
                    cancelOnBalance = {}, onErneut = {}, onBestaetigen = { _, _ -> }, cancelOnConfirmation = {},
                )
            }
        }
    }

    /** Copying stays (number and PIN move into a payment field), but below Android 13 with a warning. */
    @Test
    fun `below Android 13 the voucher page warns before copying, from 13 on not`() {
        stufe = 32
        showVoucher(protection = { _, weiter -> weiter() })
        compose.onNodeWithText(ctx.getString(R.string.geheim_kopieren_warnung)).assertExists()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, "6061 2345 6789")).assertExists()
        stufe = 33
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.geheim_kopieren_warnung)).assertDoesNotExist()
    }

    @Test
    fun `a voucher shows the PIN only on request`() {
        showVoucher(protection = { _, weiter -> weiter() })
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertIsDisplayed()
    }

    /** pruef6 N2: whoever briefly has the unlocked phone sees and copies no PIN. */
    @Test
    fun `without confirming the device lock the PIN stays hidden`() {
        val gefragt = mutableListOf<String>()
        val kopiert = mutableListOf<String>()
        showVoucher({ grund, _ -> gefragt += grund }, kopiert)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, "6061 2345 6789"))
            .performClick()
        assertEquals("Ohne Bestätigung nichts kopiert", emptyList<String>(), kopiert)
        assertEquals(List(2) { ctx.getString(R.string.schritt_gutschein) }, gefragt)
    }

    /** The number alone is no money but plaintext — it too only after the lock. */
    @Test
    fun `without device lock the number is not copied either`() {
        val gefragt = mutableListOf<String>()
        val kopiert = mutableListOf<String>()
        showVoucher({ grund, _ -> gefragt += grund }, kopiert)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_number, "6061 2345 6789"))
            .performClick()
        assertEquals("Ohne Bestätigung nichts kopiert", emptyList<String>(), kopiert)
        assertEquals(listOf(ctx.getString(R.string.schritt_gutschein)), gefragt)
    }

    /**
     * The confirmation asks for the password; the code field comes only when the
     * server has required it. Without input “Confirm” stays off. Nothing is typed:
     * a focused field blinks, and Robolectric would never come to rest.
     */
    @Test
    fun `the confirmation shows the code field only on demand`() {
        zustand = zustand.copy(confirmation = VoucherConfirmation(VoucherStep.PIN_ZEIGEN, 7))
        showVoucher(protection = { _, weiter -> weiter() })
        compose.onNodeWithText(ctx.getString(R.string.konto_password_current)).assertIsDisplayed()
        compose.onNodeWithText(ctx.getString(R.string.login_code)).assertDoesNotExist()
        compose.onNodeWithText(ctx.getString(R.string.vouchers_confirm_button)).assertIsNotEnabled()
        zustand = zustand.copy(confirmation = zustand.confirmation?.copy(
            codeNoetig = true, operation = Vorgang.Fehlgeschlagen(Meldung.Text("Bitte den Code eingeben."))))
        compose.onNodeWithText(ctx.getString(R.string.login_code)).assertIsDisplayed()
        compose.onNodeWithText("Bitte den Code eingeben.").assertIsDisplayed()
    }
}
