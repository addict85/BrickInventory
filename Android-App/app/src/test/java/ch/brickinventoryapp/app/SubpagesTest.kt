package ch.brickinventoryapp.app

import android.content.Context
import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.account.ui.screens.AccountRoute
import ch.brickinventoryapp.account.ui.screens.CsvImportRoute
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.account.ui.screens.PriceAlarmsRoute
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.app.testing.Examples
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.screens.PartsListRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.testing.SessionFake
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.util.Locale

/**
 * The subpages under “More” and the confirmations before actions without a way back:
 * sign-out, deleting a storage location and removing a sub-account ask first; storage locations are
 * rows with a menu instead of permanent text fields; every subpage names its title once;
 * household structures inviting and accepting; CSV import shows actions with columns;
 * the empty build list stands centered with a margin and offers no reset.
 *
 * Counter-checks (patches under counter-checks/, measured only in CI — Robolectric):
 *   logout-without-confirmation     „Abmelden“ under More signs out immediately → red “sign-out asks …”
 *   location-deletes-immediately      deleting in the menu without confirmation → red “storage locations stand as rows …”
 *   household-removes-immediately     „Entfernen“ unlinks immediately → red “household structures …”
 *   subpage-double-title   CSV import again with card header → red “CSV import shows …”
 *   build-list-empty-reset  „Zurücksetzen“ visible even without sets → red “empty build list …”
 *   location-star-as-button     star again IconButton without location → red “the default star …”
 *   household-remove-without-name „Entfernen“ without account name → red “removing names …”
 *   price-alarm-number-first     confirmation names only the number again → red “price alerts name …”
 *   account-without-retry      changing the password submits without check → red “account changes …”
 *   build-list-two-step          creating only after „+“ → red “build list is created …”
 *   build-list-plus-without-effect   „+“ in the field does not take the set → red “build list takes sets …”
 *   build-list-clears-immediately        „Zurücksetzen“ empties without confirmation → red “build list takes sets …”
 *   account-profile-without-confirmation saving without password dialog → red “account asks for the password when saving …”
 *   account-email-without-pending  the requested address not below the field → red “account names …”
 *   logout-mid-account     sign-out again as the last entry of „Konto und App“, before the
 *                                server group → red “sign-out stands apart …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SubpagesTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val before = Locale.getDefault()
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

    /** The world responds in ticks; drive the main looper until [done] holds. */
    private fun wait(name: String, done: () -> Boolean) {
        driveUntil(name, ready = done)
        compose.waitForIdle()
    }

    /** The build list as the graph shows it: route with ViewModel, without network. */
    @Composable
    private fun PartsList(vm: PartListViewModel) =
        PartsListRoute(serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(),
            onScanBarcode = {}, hasSubAccounts = false, barcodeSetNumber = null, onBarcodeConsumed = {},
            listState = androidx.compose.foundation.lazy.rememberLazyListState(), requestManualEntry = false,
            onManualEntryAcknowledged = {}, vm = vm)

    private fun inDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun settings() = world.t.track(SettingsViewModel(world.t.session, world.t.filter(), world.t.hints, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null
        }))

    @Test
    fun `sign-out asks first`() {
        var loggedOut = 0
        show { MoreScreen({}, isAdmin = false, updateAvailable = false, onLogout = { loggedOut++ }) }
        val logout = ctx.getString(R.string.main_menu_logout)
        compose.onNodeWithText(logout).performClick()
        compose.waitForIdle()
        assertEquals("a tap alone does not sign out", 0, loggedOut)
        compose.onNodeWithText(ctx.getString(R.string.logout_confirm_title)).fetchSemanticsNode()
        inDialog(logout).performClick()
        compose.waitForIdle()
        assertEquals("confirmed, it signs out", 1, loggedOut)
    }

    /** Between „Einstellungen“ and the server group sign-out lay where one keeps tapping. */
    @Test
    fun `sign-out stands apart as the last entry, after the server group`() {
        show { MoreScreen({}, isAdmin = true, updateAvailable = false, onLogout = {}) }
        fun situation(id: Int) = compose.onNodeWithText(ctx.getString(id)).fetchSemanticsNode().boundsInRoot
        val logout = situation(R.string.main_menu_logout)
        for (id in listOf(R.string.nav_settings, R.string.main_menu_monitoring, R.string.account_title, R.string.vouchers_title)) {
            assertTrue("“${ctx.getString(id)}” stands below sign out", situation(id).bottom <= logout.top)
        }
    }

    /** The dot on the settings says in words what it stands for. */
    @Test
    fun `update dot is labelled`() {
        show { MoreScreen({}, isAdmin = false, updateAvailable = true, onLogout = {}) }
        compose.onNodeWithText(ctx.getString(R.string.update_badge)).fetchSemanticsNode()
    }

    @Test
    fun `storage locations stand as rows with a menu and delete only after confirmation`() {
        world.paths.responses["/api/v2/storage/locations"] = """{"success":true,"locations":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        val vm = settings().also { it.loadOwnLocations() }
        val message = SnackbarHostState()
        show { LocationsRoute(vm, message, onBack = {}) }
        wait("storage locations") { vm.storageState.value.own.size == 3 }
        // No location as a permanent text field, the title only in the app bar.
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        compose.onAllNodesWithText(ctx.getString(R.string.storage_manage), ignoreCase = true).assertCountEquals(1)
        compose.onNodeWithText("Regal Wohnzimmer").fetchSemanticsNode()

        compose.onNodeWithContentDescription(ctx.getString(R.string.storage_menu_cd, "Keller")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.common_delete)).performClick()
        compose.waitForIdle()
        assertTrue("deleted before the confirmation: ${world.paths.requests}", world.paths.requests.none { it.startsWith("DELETE") })
        compose.onNodeWithText(ctx.getString(R.string.storage_delete_title)).fetchSemanticsNode()
        // Confirmed is only marked: the location is missing, the server learns of it only when the
        // snackbar ends without „Rückgängig“. The clock stands still so that it does not expire by itself.
        compose.mainClock.autoAdvance = false
        inDialog(ctx.getString(R.string.common_delete)).performClick()
        repeat(5) {
            compose.mainClock.advanceTimeBy(100)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        assertTrue("no snackbar with undo", message.currentSnackbarData != null)
        compose.onAllNodesWithText("Keller").assertCountEquals(0)
        assertTrue("deleted before the snackbar ran out", world.paths.requests.none { it.startsWith("DELETE") })
        message.currentSnackbarData?.dismiss()
        compose.mainClock.autoAdvance = true
        // The end of the snackbar continues the LaunchedEffect; it runs at the pace of the
        // Compose clock, which driveUntil (only the main looper) does not advance.
        compose.waitForIdle()
        wait("delete") { world.paths.requests.any { it.startsWith("DELETE") && it.endsWith("/storage/locations/3") } }
    }

    @Test
    fun `household structures inviting and accepting and removes only after confirmation`() {
        world.paths.responses["/api/v2/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        show { HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        wait("household") { vm.householdState.value.status != null }

        val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)
        for (title in listOf(R.string.household_invite_section, R.string.household_redeem_title)) {
            compose.onNode(hasText(ctx.getString(title)) and heading).fetchSemanticsNode()
        }
        compose.onAllNodesWithText(ctx.getString(R.string.household_title), ignoreCase = true).assertCountEquals(1)
        // The code field carries a label, not only a placeholder.
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.household_invite_label))).fetchSemanticsNode()

        compose.onAllNodes(hasText(ctx.getString(R.string.household_remove)) and hasClickAction())[0].performClick()
        compose.waitForIdle()
        assertTrue("disconnected before the confirmation", world.paths.requests.none { "household/unlink" in it })
        compose.onNodeWithText(ctx.getString(R.string.household_remove_text, "lena")).fetchSemanticsNode()
        inDialog(ctx.getString(R.string.household_remove)).performClick()
        wait("unlink") { world.paths.requests.any { "household/unlink" in it } }
    }

    @Test
    fun `CSV import shows one action per kind with its columns and the title once`() {
        val vm = settings()
        show { CsvImportRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        compose.onAllNodesWithText(ctx.getString(R.string.csv_upload_title), ignoreCase = true).assertCountEquals(1)
        compose.onNode(hasText(ctx.getString(R.string.csv_upload_sets)) and hasClickAction() and
            SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.csv_format_parts), useUnmergedTree = true).fetchSemanticsNode()
    }

    /** Counter-check (run here): `onAcknowledged()` removed from FocusOnManualEntry → red “acknowledged once”. */
    @Test
    fun `after an unsuccessful scan the build list puts the cursor into the set field and acknowledges`() {
        var acknowledged = 0
        show {
            PartsListScreen(PartListUiState(), serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(),
                onScanBarcode = {}, requestManualEntry = true, onManualEntryAcknowledged = { acknowledged++ })
        }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number))).assertIsFocused()
        assertEquals("acknowledged once", 1, acknowledged)
    }

    @Test
    fun `empty build list stands centered and offers no reset`() {
        show {
            PartsListScreen(PartListUiState(),
                serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {})
        }
        compose.onAllNodes(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertCountEquals(0)
        val density = ctx.resources.displayMetrics.density
        val width = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        for (text in listOf(R.string.partslist_empty_title, R.string.partslist_empty_hint)) {
            val b = compose.onNodeWithText(ctx.getString(text)).fetchSemanticsNode().boundsInRoot
            assertTrue("${ctx.getString(text)} sticks to the edge (${b.left / density} dp)", b.left >= 16 * density)
            assertTrue("${ctx.getString(text)} is not centered ($b in $width)",
                kotlin.math.abs((b.left + b.right) / 2 - width / 2) < 2 * density)
        }
    }

    @Test
    fun `the default star is a switch with the name of the location`() {
        world.paths.responses["/api/v2/storage/locations"] = """{"success":true,"locations":[{"id":3,"name":"Keller"}]}"""
        val vm = settings().also { it.loadOwnLocations() }
        show { LocationsRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        wait("storage locations") { vm.storageState.value.own.size == 1 }
        val stern = compose.onNodeWithContentDescription(ctx.getString(R.string.storage_default_cd, "Keller")).fetchSemanticsNode()
        assertEquals("TalkBack hears on/off", ToggleableState.Off, stern.config.getOrNull(SemanticsProperties.ToggleableState))
    }

    @Test
    fun `removing names the account in the household`() {
        world.paths.responses["/api/v2/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.track(HouseholdViewModel(world.t.session, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        show { HouseholdRoute(vm, remember { SnackbarHostState() }, onBack = {}) }
        wait("household") { vm.householdState.value.status != null }
        val remove = ctx.getString(R.string.household_remove)
        for (name in listOf("lena", "tim")) {
            compose.onNode(hasContentDescription(ctx.getString(R.string.action_for, remove, name)) and hasClickAction())
                .fetchSemanticsNode("„$remove“ nennt $name nicht")
        }
    }

    @Test
    fun `price alerts name the name first and in the confirmation`() {
        world.paths.responses["/api/v2/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"below","threshold":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
        val vm = settings()
        show {
            PriceAlarmsRoute(vm = vm,
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onBack = {}, reportToggle = {})
        }
        wait("alerts") { vm.alarmOverview.value.loaded }
        val name = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val number = compose.onNodeWithText("75192-1", substring = true, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("name ($name) above the number ($number)", name.bottom <= number.top)
        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_for, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.alerts_confirm_delete, "Millennium Falcon")).fetchSemanticsNode()
    }

    @Test
    fun `account changes the password only with a matching repetition and marks it otherwise`() {
        world.paths.responses["/api/v2/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val account = world.t.track(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        show {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                account = account, onBack = {})
        }
        wait("profile") { account.accountState.value.profile != null }
        fun field(label: Int) = compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(label)))[0]
        val switch = compose.onNode(hasText(ctx.getString(R.string.account_password_button)) and hasClickAction())
        val switched = { world.paths.requests.count { "password" in it } }
        field(R.string.account_password_current).performTextInput("altes-passwort-1")
        field(R.string.account_password_new).performTextInput("neues-passwort-12")
        field(R.string.register_password_repeat).performTextInput("anderes-passwort-1")
        compose.waitForIdle()
        // Tappable; nothing is submitted, the cursor stands in the repetition.
        switch.performScrollTo().assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals("sent with a wrong repetition", 0, switched())
        field(R.string.register_password_repeat).assertIsFocused()
        field(R.string.register_password_repeat).performTextClearance()
        field(R.string.register_password_repeat).performTextInput("neues-passwort-12")
        switch.performScrollTo().performClick()
        wait("password change") { switched() == 1 }
    }

    /** A new address applies only after the link: the field shows the current one, below it the requested one. */
    @Test
    fun `account names the requested e-mail below the field`() {
        world.paths.responses["/api/v2/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true,
            "new_email":"neu@example.org"}}"""
        val account = world.t.track(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        show {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                account = account, onBack = {})
        }
        wait("profile") { account.accountState.value.profile != null }
        compose.onNode(hasSetTextAction() and hasText("marco@example.org")).fetchSemanticsNode("Das Feld zeigt die geltende Adresse nicht")
        compose.onNodeWithText(ctx.getString(R.string.account_email_pending, "neu@example.org"), useUnmergedTree = true)
            .fetchSemanticsNode("Die beantragte Adresse fehlt unter dem Feld")
    }

    /** Changed via the text action, not by typing: no focused field. */
    @Test
    fun `account asks for the password when saving the profile`() {
        world.paths.responses["/api/v2/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val account = world.t.track(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.messages, world.t.session, SessionFake()))
        show {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                account = account, onBack = {})
        }
        wait("profile") { account.accountState.value.profile != null }
        compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(R.string.register_first_name)))[0]
            .performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("Marc")) }
        compose.waitForIdle()
        val save = compose.onNode(hasText(ctx.getString(R.string.account_save)) and hasClickAction())
        save.performScrollTo()
        // If a dialog with a text field stands on this page, Compose under Robolectric
        // no longer comes to rest. Therefore without waitForIdle: stop the clock, drain the looper and
        // look up the dialog window at Robolectric ourselves.
        compose.mainClock.autoAdvance = false
        save.performClick()
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("no password dialog when saving", dialog?.isShowing == true)
        assertTrue("saved without a password: ${world.paths.requests}", world.paths.requests.none { it.startsWith("PUT") })
        dialog?.dismiss()
        Shadows.shadowOf(Looper.getMainLooper()).idle()
    }

    /** Resetting throws away sets and list and therefore asks first. */
    @Test
    fun `build list takes sets via the plus in the field and resets them only after confirmation`() {
        val vm = world.buildList()
        show { PartsList(vm) }
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number)))
            .performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("21318")) }
        compose.waitForIdle()
        compose.onNodeWithContentDescription(ctx.getString(R.string.partslist_add_set)).performClick()
        compose.waitForIdle()
        val chip = hasText("21318-1") and hasClickAction()
        compose.onNode(chip).fetchSemanticsNode("Das Set steht nicht in der Liste")
        compose.onNode(hasText(ctx.getString(R.string.partslist_generate)) and hasClickAction()).assertIsEnabled()
        compose.onNode(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNode(chip).fetchSemanticsNode("Zurückgesetzt ohne Rückfrage")
        compose.onNode(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction() and
            hasAnyAncestor(isDialog())).performClick()
        compose.waitForIdle()
        compose.onAllNodes(chip).assertCountEquals(0)
        compose.onAllNodes(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun `build list is created in one step from the typed number`() {
        val resolved = mutableListOf<String>()
        val vm = world.buildList { nr -> resolved += nr; "Baumhaus" to emptyList() }
        show { PartsList(vm) }
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number))).performTextInput("21318")
        compose.onNode(hasText(ctx.getString(R.string.partslist_generate)) and hasClickAction()).assertIsEnabled().performClick()
        wait("build list") { resolved.isNotEmpty() }
        assertEquals(listOf("21318-1"), resolved)
    }
}
