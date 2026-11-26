package ch.brickinventoryapp.app

import android.os.Build
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
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
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.collection.ui.screens.AddSetDialog
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.contract.Voucher
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.finances.ui.VoucherConfirmation
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.finances.ui.screens.VoucherCardActions
import ch.brickinventoryapp.finances.ui.screens.VouchersCard
import ch.brickinventoryapp.login.ui.screens.LoginActions
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.LoginScreenState
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.LocalStepGuard
import ch.brickinventoryapp.ui.components.StepGuard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * The core flows as a UI test on the JVM (Robolectric): sign in, add a
 * set, change the quantity, view a voucher. Every action runs through the
 * accessibility check (ATF): a button without a label, a too small
 * target or too little contrast makes the test fail.
 *
 * Counter-checks (a) and (c) are measured by the CI job `counter-checks` (Android-App/
 * counter-checks/ablauf-*.patch, it requires red); (b) and (d) are not measured yet:
 *   (a) in the sign-in button `onLogin(password, username, …)` swapped → red
 *       “sign-in passes on name and password”
 *   (b) the plus button without description → ATF red in “changing the quantity …”
 *   (c) AddSetDialog passes the quantity as a fixed 1 → red “adding a set …”
 *   (d) voucher PIN always visible → red “a voucher shows the PIN …”
 *   (e) in VouchersCard revealing without step guard (`switchOnPin(g.id)`
 *       directly) → red “without confirming the device lock the PIN stays hidden”
 *       (counter-checks/voucher-pin-without-device-lock.patch)
 *   (f) the number copied without step guard → red “without device lock the
 *       number is not copied either” (counter-checks/voucher-number-without-device-lock.patch)
 *   (g) VouchersCard shows the delete question also while it runs (`&& !it.operation.running`
 *       removed) → red “deleting asks a plain question …”
 *       (counter-checks/voucher-question-while-running.patch)
 *   (h) in the set detail the trash always with confirmation → red “a set deletes
 *       immediately with undo …” (counter-checks/set-delete-double-confirmed.patch)
 *   (i) adding without a number does not mark the field → red “a set without a number says …”
 *       (counter-checks/capture-without-reason.patch)
 *   (j) VouchersCard without SecretCopyWarning() → red “below Android 13 the
 *       voucher page warns …” (counter-checks/voucher-copy-without-warning.patch)
 */
@RunWith(RobolectricTestRunner::class)
// NATIVE as for the screenshots: ATF's contrast check reads a
// screenshot, and in Robolectric's LEGACY graphics mode there is none.
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FlowTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val ctx get() = compose.activity

    @Before
    fun setUp() = compose.enableAccessibilityChecks()

    private var world: Examples.World? = null

    @After
    fun tearDown() { world?.close() }

    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) =
        compose.setContent { BrickInventoryManagerTheme { Surface { content() } } }

    @Test
    fun `sign-in passes on name and password`() {
        var sent: Triple<String, String, String?>? = null
        show {
            LoginScreen(
                LoginScreenState(serverUrl = "https://brick.example.org", registrationOpen = false),
                object : LoginActions {
                    override fun login(username: String, password: String, code: String?) { sent = Triple(username, password, code) }
                },
            )
        }
        compose.onNodeWithText(ctx.getString(R.string.login_username)).performTextInput("marco")
        compose.onNodeWithText(ctx.getString(R.string.login_password)).performTextInput("geheim")
        // Like a human: scroll there first, then tap. The button lies below the edge
        // on a small screen.
        compose.onNode(hasText(ctx.getString(R.string.login_button)) and hasClickAction())
            .performScrollTo().performClick()
        assertEquals(Triple("marco", "geheim", null), sent)
    }

    @Test
    fun `adding a set takes number and quantity`() {
        var recorded: Pair<String, Int>? = null
        show { AddSetDialog(onDismiss = {}, onAdd = { recorded = it.setNumber to it.quantity }) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("75192")
        compose.onNodeWithText(ctx.getString(R.string.common_quantity)).performTextReplacement("3")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        assertEquals("75192" to 3, recorded)
    }

    /** Adding without a number adds nothing but says at the field what is missing (instead of gray without a reason). */
    @Test
    fun `a set without a number says what is missing when tapping Add`() {
        var recorded = 0
        show { AddSetDialog(onDismiss = {}, onAdd = { recorded++ }, immediatelyFocus = false) }
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("without a number nothing is entered", 0, recorded)
        compose.onNodeWithText(ctx.getString(R.string.record_number_missing), useUnmergedTree = true).assertIsDisplayed()
    }

    /**
     * Every field of “Add set” carries a help line; without it the fields stood
     * unevenly far apart, and the hint about the price vanished as a placeholder while typing.
     * Counter-check: quantity field again without help line (only on error) → red, „Anzahl“ missing
     * (counter-checks/capture-quantity-without-help-line.patch).
     */
    @Test
    fun `every field when adding a set has a help line, also while typing`() {
        show { AddSetDialog(onDismiss = {}, onAdd = {}, immediatelyFocus = false) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_purchase_price)).performTextInput("12")
        compose.waitForIdle()
        for (id in listOf(R.string.gallery_set_number_placeholder, R.string.gallery_quantity_hint,
                R.string.common_unit_price_placeholder)) {
            compose.onNodeWithText(ctx.getString(id), useUnmergedTree = true).assertExists()
        }
    }

    /**
     * A number that is not a set number ("--") is not added and is explained at the field.
     * Counter-check: in numberError() the branch `!NumericInput.isSetNumber(number)` removed
     * → added is 1 and the hint is missing, both checks red.
     */
    @Test
    fun `a set with a nonsensical number says what is expected when adding`() {
        var recorded = 0
        show { AddSetDialog(onDismiss = {}, onAdd = { recorded++ }, immediatelyFocus = false) }
        compose.onNodeWithText(ctx.getString(R.string.gallery_set_number)).performTextInput("--")
        compose.onNode(hasText(ctx.getString(R.string.gallery_add)) and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("a nonsensical number is not entered", 0, recorded)
        compose.onNodeWithText(ctx.getString(R.string.record_number_invalid), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `changing the quantity sends a step to the server`() {
        val w = Examples.World().also { world = it }
        val vm = w.setDetail()
        w.paths.responses["/api/v2/sets/75192-1"] =
            """{"success":true,"quantity":3,"set":{"set_number":"75192-1","name":"Millennium Falcon","quantity":2}}"""
        show {
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
        compose.waitUntil(10_000) { w.paths.requestsTo("PUT /api/v2/sets/75192-1").isNotEmpty() }
        assertTrue(w.paths.bodyBytes.any { it.contains("\"quantity_delta\":1") })
    }

    /** One safeguard suffices: with “Undo” below no confirmation, without it there is one. */
    @Test
    fun `a set deletes immediately with undo, without undo only after confirmation`() {
        val w = Examples.World().also { world = it }
        val vm = w.setDetail()
        var undo by mutableStateOf(true)
        val deleted = mutableListOf<String>()
        show {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "",
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), onBack = {}, onDelete = { deleted += it },
                undoPossible = undo)
        }
        compose.waitUntil(10_000) { vm.setDetailState.value.setDetail != null }
        val name = vm.setDetailState.value.setDetail?.name ?: Examples.SET
        val trash = compose.onNodeWithContentDescription(ctx.getString(R.string.cd_set_delete, name))
        trash.performClick()
        compose.waitForIdle()
        assertEquals("with undo marked right away", listOf(Examples.SET), deleted)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertDoesNotExist()

        undo = false
        compose.waitForIdle()
        trash.performClick()
        compose.waitForIdle()
        assertEquals("without undo only after the confirmation", 1, deleted.size)
        compose.onNode(androidx.compose.ui.test.isDialog()).assertExists()
    }

    /** The state of the voucher card; the tests of the confirmation change it. */
    private var condition by mutableStateOf(VoucherUiState(vouchers = listOf(
        Voucher(id = 7, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = CurrencyCode("CHF")).asView())))

    /** The Android level the page chooses by; Robolectric itself runs against API 35. */
    private var level by mutableStateOf(Build.VERSION.SDK_INT)

    /** A voucher with PIN 4711; [protection] stands for the device lock. */
    private var confirmed = 0

    private fun showVoucher(protection: StepGuard, copied: MutableList<String> = mutableListOf()) {
        show {
            CompositionLocalProvider(LocalStepGuard provides protection, LocalSdkLevel provides level) {
                VouchersCard(
                    condition = condition,
                    actions = object : VoucherCardActions {
                        override fun switchPin(id: Int) { condition = condition.copy(pinVisible = condition.pinVisible + id) }
                        override fun copy(id: Int, isNumber: Boolean) { copied += id.toString() }
                        override fun confirm() { confirmed++ }
                    },
                )
            }
        }
    }

    /** Copying stays (number and PIN move into a payment field), but below Android 13 with a warning. */
    @Test
    fun `below Android 13 the voucher page warns before copying, from 13 on not`() {
        level = 32
        showVoucher(protection = { _, next -> next() })
        compose.onNodeWithText(ctx.getString(R.string.secret_copy_warning)).assertExists()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, "6061 2345 6789")).assertExists()
        level = 33
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.secret_copy_warning)).assertDoesNotExist()
    }

    @Test
    fun `a voucher shows the PIN only on request`() {
        showVoucher(protection = { _, next -> next() })
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertIsDisplayed()
    }

    /** pruef6 N2: whoever briefly has the unlocked phone sees and copies no PIN. */
    @Test
    fun `without confirming the device lock the PIN stays hidden`() {
        val asked = mutableListOf<String>()
        val copied = mutableListOf<String>()
        showVoucher({ reason, _ -> asked += reason }, copied)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_pin_show)).performClick()
        compose.onNodeWithText("4711", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_pin, "6061 2345 6789"))
            .performClick()
        assertEquals("nothing copied without confirmation", emptyList<String>(), copied)
        assertEquals(List(2) { ctx.getString(R.string.step_voucher) }, asked)
    }

    /** The number alone is no money but plaintext — it too only after the lock. */
    @Test
    fun `without device lock the number is not copied either`() {
        val asked = mutableListOf<String>()
        val copied = mutableListOf<String>()
        showVoucher({ reason, _ -> asked += reason }, copied)
        compose.onNodeWithContentDescription(ctx.getString(R.string.vouchers_cd_copy_number, "6061 2345 6789"))
            .performClick()
        assertEquals("nothing copied without confirmation", emptyList<String>(), copied)
        assertEquals(listOf(ctx.getString(R.string.step_voucher)), asked)
    }

    /**
     * The login is enough: deleting asks only „are you sure“, without a password field, and
     * a step that is already running (plain text, PDF, the delete itself) shows no dialog.
     */
    @Test
    fun `deleting asks a plain question without a password, a running step shows none`() {
        condition = condition.copy(confirmation = VoucherConfirmation(VoucherStep.PIN_SHOW, 7, Operation.Running))
        showVoucher(protection = { _, next -> next() })
        compose.onNodeWithText(ctx.getString(R.string.vouchers_delete_title)).assertDoesNotExist()
        compose.onNodeWithText(ctx.getString(R.string.account_password_current)).assertDoesNotExist()

        condition = condition.copy(confirmation = VoucherConfirmation(VoucherStep.DELETE, 7))
        compose.onNodeWithText(ctx.getString(R.string.vouchers_delete_title)).assertIsDisplayed()
        compose.onNodeWithText(ctx.getString(R.string.account_password_current)).assertDoesNotExist()
        compose.onNodeWithText(ctx.getString(R.string.common_delete)).performClick()
        assertEquals(1, confirmed)

        condition = condition.copy(confirmation = condition.confirmation?.copy(operation = Operation.Running))
        compose.onNodeWithText(ctx.getString(R.string.vouchers_delete_title)).assertDoesNotExist()
    }
}
