package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailActions
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.collection.ui.screens.WantedItemUndoRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryActions
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.WantedItemAlarmView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.ui.ErrorClass
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.util.fmtMoney
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Flows beyond one screen: deleting with undo, error and empty states
 * of the catalog, adding after the scan, wishlist in the catalog, household.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   merkposten-loeschen-sofort         deleting again immediately at the server → red “a wishlist item can be …”
 *   katalog-fehler-eigen               own error state with hit count → red “the catalog shows the same …”
 *   katalog-leer-ohne-zuruecksetzen    empty catalog without button → red “an empty catalog with …”
 *   scanner-ohne-anzahl                quantity not passed on → red “adding after the scan …”
 *   katalog-ohne-merkliste             detail does not know the wishlist item → red “the catalog detail shows the …”
 *   haushalt-ohne-teilen               invitation only for copying → red “the invitation can be …”
 *   teile-fehler-mit-plus              „+“ also in the error state → red “in the error state there is no …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class AreaFlowsTest {

    @get:Rule
    val compose = createComposeRule()

    private val before = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val images = SampleImages.loader(ctx)
    private val world = Examples.World(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun tearDown() {
        Locale.setDefault(before)
        world.close()
    }

    private fun show(content: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { content() }
            }
        }
        compose.waitForIdle()
    }

    /** Drive the main looper until [ready] holds — the server responds in its own thread. */
    private fun wait(was: String, ready: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); ready() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: nach 10 s nicht da", e)
        }
        compose.waitForIdle()
    }

    @Test
    fun `a wishlist item can be restored after deleting, including its alert`() {
        val vm = world.wantedList().also { it.loadWanted() }
        wait("Merkliste") { vm.wantedState.value.wantedItem.isNotEmpty() }
        show {
            val message = remember { SnackbarHostState() }
            Scaffold(snackbarHost = { SnackbarHost(message) }) { inner ->
                WantedItemUndoRoute(vm, message)
                Box(Modifier.padding(inner)) {
                    WantedRoute(vm = vm, imageLoader = images, sideBySide = true, onScan = {}, onOpenSingle = { _, _ -> })
                }
            }
        }
        // fmtMoney puts a non-breaking space between code and amount.
        val alarm = ctx.getString(R.string.wanted_alert_below, fmtMoney(349.0, CurrencyCode("CHF")))
        compose.onAllNodesWithText(alarm, substring = true).fetchSemanticsNodes()
            .let { assertTrue("Alarm vor dem Löschen", it.isNotEmpty()) }
        compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).performClick()
        wait("Detail") { !vm.wantedItemDetailState.value.fetch.loading }
        // From here the clock by hand: otherwise the snackbar would expire immediately at the test clock's pace.
        compose.mainClock.autoAdvance = false
        fun step() = repeat(5) { compose.mainClock.advanceTimeBy(100); shadowOf(Looper.getMainLooper()).idle() }
        compose.onNodeWithContentDescription(ctx.getString(R.string.common_delete)).performClick()
        step()
        compose.onNodeWithText(ctx.getString(R.string.wanted_deleted, "Lion Knights' Castle")).fetchSemanticsNode("Keine Snackbar")
        assertTrue("Schon gelöscht, bevor die Snackbar endet", world.paths.requestsTo("DELETE").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        step()
        wait("zurück") { vm.wantedState.value.wantedItem.any { it.setNumber == "10305-1" } }
        step()
        compose.onAllNodesWithText(alarm, substring = true)
            .fetchSemanticsNodes().let { assertTrue("Alarm wieder sichtbar", it.isNotEmpty()) }
        assertTrue("Nach Rückgängig nie gelöscht", world.paths.requestsTo("DELETE").isEmpty())
    }

    private object NoCatalogActions : CatalogActions {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(number: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: CatalogSort) = Unit
    }

    @Test
    fun `the catalog shows the same error state as the gallery, without a hit count`() {
        show {
            CatalogScreen(CatalogUiState(fetch = Load.Failure(ErrorClass.SERVER, Message.Text("Serverfehler (500)"))),
                serverUrl = "", catalog = NoCatalogActions, imageLoader = images, onSetClick = {})
        }
        compose.onNodeWithText(ctx.getString(R.string.error_server_title)).fetchSemanticsNode("Fehler ohne Klasse")
        compose.onNodeWithText(ctx.getString(R.string.common_retry)).fetchSemanticsNode("Kein „Erneut versuchen“")
        compose.onAllNodesWithText("Sets im Katalog", substring = true).assertCountEquals(0)
    }

    @Test
    fun `an empty catalog with a filter offers reset, afterwards tiles are shown`() {
        val sets = listOf(CatalogSetView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, numParts = 4514))
        var condition by mutableStateOf(CatalogUiState(themeId = 721))
        val actions = object : CatalogActions by NoCatalogActions {
            override fun setCatalogTheme(themeId: Int?) {
                condition = CatalogUiState(themeId = themeId, loadedPages = mapOf(1 to sets), total = sets.size)
            }
        }
        show { CatalogScreen(condition, serverUrl = "", catalog = actions, imageLoader = images, onSetClick = {}) }
        compose.onNodeWithText(ctx.getString(R.string.filter_reset_all)).performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).fetchSemanticsNode("Keine Kachel nach dem Zurücksetzen")
    }

    @Test
    fun `adding after the scan has a quantity and keeps inputs across a rotation`() {
        var quantity = 0
        var price: Money? = null
        val actions = object : EntryActions {
            override fun confirmAddBarcode(wish: EntryRequest) { quantity = wish.quantity; price = wish.purchasePrice }
            override fun cancelBarcode() = Unit
            override fun cancelCheck() = Unit
        }
        val condition = BarcodeDialogState(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 2), StorageUiState())
        val rotate = StateRestorationTester(compose)
        rotate.setContent { BrickInventoryManagerTheme { BarcodeResultDialog(condition, actions, images) } }
        compose.onNodeWithText(ctx.getString(R.string.barcode_already_owned, 2)).fetchSemanticsNode("Besitz nicht genannt")
        val count = hasSetTextAction() and hasText(ctx.getString(R.string.common_quantity))
        compose.onNode(count).performTextClearance()
        compose.onNode(count).performTextInput("2")
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.barcode_purchase_price))).performTextInput("650")
        rotate.emulateSavedInstanceStateRestore()
        compose.onNode(count).fetchSemanticsNode().let { n ->
            val text = n.config.getOrNull(SemanticsProperties.EditableText)?.text
            assertEquals("Anzahl nach der Drehung", "2", text)
        }
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        assertEquals(2, quantity)
        assertEquals(Money.from(650.0), price)
    }

    @Test
    fun `the catalog detail shows the wishlist item and opens it`() {
        var opened: Pair<String, Condition>? = null
        val wanted = WantedItemView(setNumber = "10305-1", condition = Condition.NEW, name = "Lion Knights' Castle", currency = CurrencyCode("CHF"),
            alarm = WantedItemAlarmView(direction = AlarmDirection.BELOW, threshold = Money.from(349.0)!!))
        show {
            CatalogDetailScreen(setNumber = "10305-1", loaded = Load.Data(CatalogDetailView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022)), imageLoader = images, serverUrl = "", wanted = wanted,
                actions = object : CatalogDetailActions {
                    override fun openWantedItem(setNumber: String, condition: Condition) { opened = setNumber to condition }
                })
        }
        compose.onNodeWithText(ctx.getString(R.string.catalog_on_wanted_list)).fetchSemanticsNode("Merkliste nicht genannt")
        compose.onAllNodesWithText(ctx.getString(R.string.wanted_add_submit)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.catalog_wanted_item_open)).performScrollTo().performClick()
        assertEquals("10305-1" to Condition.NEW, opened)
    }

    @Test
    fun `the invitation can be shared and copied, with validity and lock reason`() {
        world.paths.responses["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF","sub_accounts":[]}"""
        world.paths.responses["/api/v1/settings/household/invite"] = """{"success":true,"code":"ABCD-1234","expires_in":86400}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api)))
        show { HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        wait("Haushalt") { vm.householdState.value.status != null }
        compose.onNodeWithText(ctx.getString(R.string.household_redeem_lock_reason)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_create)).performScrollTo().performClick()
        wait("Code") { vm.householdState.value.inviteCode != null }
        compose.onNodeWithText(ctx.getString(R.string.household_invite_share)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_copy)).fetchSemanticsNode()
        compose.onAllNodesWithText("Gültig bis", substring = true).fetchSemanticsNodes()
            .let { assertTrue("Gültigkeit fehlt", it.isNotEmpty()) }
    }

    @Test
    fun `in the error state there is no add button, as in gallery and wishlist`() {
        world.paths.codes["/api/v1/parts"] = 500
        val vm = world.parts().also { it.loadParts() }
        wait("Fehler") { vm.partsState.value.let { it.partsFetch is Load.Failure } }
        show { PartsRoute(vm = vm, imageLoader = images) }
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.parts_add)).assertCountEquals(0)
    }
}
