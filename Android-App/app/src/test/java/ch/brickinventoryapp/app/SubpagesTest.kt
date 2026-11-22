package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.account.ui.screens.CsvImportRoute
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.account.ui.screens.AccountRoute
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListRoute
import ch.brickinventoryapp.parts.ui.screens.PartsListScreen
import ch.brickinventoryapp.account.ui.screens.PreisalarmeRoute
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import android.content.Context
import android.os.Looper
import java.util.Locale
import org.robolectric.Shadows
import org.robolectric.shadows.ShadowDialog
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.SessionFake
import ch.brickinventoryapp.testing.testPartsRepository

/**
 * The subpages under “More” and the confirmations before actions without a way back:
 * sign-out, deleting a storage location and removing a sub-account ask first; storage locations are
 * rows with a menu instead of permanent text fields; every subpage names its title once;
 * household structures inviting and accepting; CSV import shows actions with columns;
 * the empty build list stands centered with a margin and offers no reset.
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
 *   abmelden-ohne-rueckfrage     „Abmelden“ under More signs out immediately → red “sign-out asks …”
 *   lagerort-loescht-sofort      deleting in the menu without confirmation → red “storage locations stand as rows …”
 *   haushalt-entfernt-sofort     „Entfernen“ unlinks immediately → red “household structures …”
 *   unterseite-doppelter-titel   CSV import again with card header → red “CSV import shows …”
 *   bauliste-leer-zuruecksetzen  „Zurücksetzen“ visible even without sets → red “empty build list …”
 *   lagerort-stern-als-knopf     star again IconButton without location → red “the default star …”
 *   haushalt-entfernen-ohne-name „Entfernen“ without account name → red “removing names …”
 *   preisalarm-nummer-zuerst     confirmation names only the number again → red “price alerts name …”
 *   konto-ohne-wiederholung      changing the password submits without check → red “account changes …”
 *   bauliste-zweistufig          creating only after „+“ → red “build list is created …”
 *   bauliste-plus-ohne-wirkung   „+“ in the field does not take the set → red “build list takes sets …”
 *   bauliste-leert-sofort        „Zurücksetzen“ empties without confirmation → red “build list takes sets …”
 *   konto-profil-ohne-rueckfrage saving without password dialog → red “account asks for the password when saving …”
 *   konto-email-ohne-ausstehend  the requested address not below the field → red “account names …”
 *   abmelden-mitten-im-konto     sign-out again as the last entry of „Konto und App“, before the
 *                                server group → red “sign-out stands apart …”
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class SubpagesTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val vorher = Locale.getDefault()
    private val world = Examples.Welt(ContextTexts())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private fun zeige(inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        compose.waitForIdle()
    }

    /** The world responds in ticks; drive the main looper until [fertig] holds. */
    private fun wait(name: String, fertig: () -> Boolean) {
        driveUntil(name, bereit = fertig)
        compose.waitForIdle()
    }

    /** The build list as the graph shows it: route with ViewModel, without network. */
    @Composable
    private fun bauliste(vm: PartListViewModel) =
        PartsListRoute(serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(),
            onScanBarcode = {}, hatUnterkonten = false, barcodeSetNumber = null, onBarcodeConsumed = {},
            listState = androidx.compose.foundation.lazy.rememberLazyListState(), manuelleErfassungAnfordern = false,
            onManuelleErfassungQuittiert = {}, vm = vm)

    private fun inDialog(text: String) = compose.onNode(hasText(text) and hasClickAction() and hasAnyAncestor(isDialog()))

    private fun einstellungen() = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api),
        world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader {
            override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null
        }))

    @Test
    fun `sign-out asks first`() {
        var abgemeldet = 0
        zeige { MehrBildschirm({}, isAdmin = false, updateVerfuegbar = false, onAbmelden = { abgemeldet++ }) }
        val abmelden = ctx.getString(R.string.main_menu_logout)
        compose.onNodeWithText(abmelden).performClick()
        compose.waitForIdle()
        assertEquals("Ein Tipp allein meldet nicht ab", 0, abgemeldet)
        compose.onNodeWithText(ctx.getString(R.string.logout_confirm_title)).fetchSemanticsNode()
        inDialog(abmelden).performClick()
        compose.waitForIdle()
        assertEquals("Bestätigt meldet ab", 1, abgemeldet)
    }

    /** Between „Einstellungen“ and the server group sign-out lay where one keeps tapping. */
    @Test
    fun `sign-out stands apart as the last entry, after the server group`() {
        zeige { MehrBildschirm({}, isAdmin = true, updateVerfuegbar = false, onAbmelden = {}) }
        fun situation(id: Int) = compose.onNodeWithText(ctx.getString(id)).fetchSemanticsNode().boundsInRoot
        val abmelden = situation(R.string.main_menu_logout)
        for (id in listOf(R.string.nav_settings, R.string.main_menu_monitoring, R.string.konto_title, R.string.vouchers_title)) {
            assertTrue("„${ctx.getString(id)}“ steht unter Abmelden", situation(id).bottom <= abmelden.top)
        }
    }

    /** The dot on the settings says in words what it stands for. */
    @Test
    fun `update dot is labelled`() {
        zeige { MehrBildschirm({}, isAdmin = false, updateVerfuegbar = true, onAbmelden = {}) }
        compose.onNodeWithText(ctx.getString(R.string.update_badge)).fetchSemanticsNode()
    }

    @Test
    fun `storage locations stand as rows with a menu and delete only after confirmation`() {
        world.paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        val vm = einstellungen().also { it.loadOwnLocations() }
        val meldung = SnackbarHostState()
        zeige { LocationsRoute(vm, meldung, onZurueck = {}) }
        wait("Lagerorte") { vm.storageState.value.eigene.size == 3 }
        // No location as a permanent text field, the title only in the app bar.
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        compose.onAllNodesWithText(ctx.getString(R.string.storage_manage), ignoreCase = true).assertCountEquals(1)
        compose.onNodeWithText("Regal Wohnzimmer").fetchSemanticsNode()

        compose.onNodeWithContentDescription(ctx.getString(R.string.storage_menu_cd, "Keller")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.common_delete)).performClick()
        compose.waitForIdle()
        assertTrue("Gelöscht vor der Rückfrage: ${world.paths.requests}", world.paths.requests.none { it.startsWith("DELETE") })
        compose.onNodeWithText(ctx.getString(R.string.storage_delete_title)).fetchSemanticsNode()
        // Confirmed is only marked: the location is missing, the server learns of it only when the
        // snackbar ends without „Rückgängig“. The clock stands still so that it does not expire by itself.
        compose.mainClock.autoAdvance = false
        inDialog(ctx.getString(R.string.common_delete)).performClick()
        repeat(5) {
            compose.mainClock.advanceTimeBy(100)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        assertTrue("Keine Snackbar mit Rückgängig", meldung.currentSnackbarData != null)
        compose.onAllNodesWithText("Keller").assertCountEquals(0)
        assertTrue("Gelöscht vor Ablauf der Snackbar", world.paths.requests.none { it.startsWith("DELETE") })
        meldung.currentSnackbarData?.dismiss()
        compose.mainClock.autoAdvance = true
        // The end of the snackbar continues the LaunchedEffect; it runs at the pace of the
        // Compose clock, which driveUntil (only the main looper) does not advance.
        compose.waitForIdle()
        wait("Löschen") { world.paths.requests.any { it.startsWith("DELETE") && it.endsWith("/storage/locations/3") } }
    }

    @Test
    fun `household structures inviting and accepting and removes only after confirmation`() {
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        zeige { HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        wait("Haushalt") { vm.householdState.value.status != null }

        val heading = SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)
        for (titel in listOf(R.string.household_invite_section, R.string.household_redeem_title)) {
            compose.onNode(hasText(ctx.getString(titel)) and heading).fetchSemanticsNode()
        }
        compose.onAllNodesWithText(ctx.getString(R.string.household_title), ignoreCase = true).assertCountEquals(1)
        // The code field carries a label, not only a placeholder.
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.household_invite_label))).fetchSemanticsNode()

        compose.onAllNodes(hasText(ctx.getString(R.string.household_remove)) and hasClickAction())[0].performClick()
        compose.waitForIdle()
        assertTrue("Getrennt vor der Rückfrage", world.paths.requests.none { "household/unlink" in it })
        compose.onNodeWithText(ctx.getString(R.string.household_remove_text, "lena")).fetchSemanticsNode()
        inDialog(ctx.getString(R.string.household_remove)).performClick()
        wait("Trennen") { world.paths.requests.any { "household/unlink" in it } }
    }

    @Test
    fun `CSV import shows one action per kind with its columns and the title once`() {
        val vm = einstellungen()
        zeige { CsvImportRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        compose.onAllNodesWithText(ctx.getString(R.string.csv_upload_title), ignoreCase = true).assertCountEquals(1)
        compose.onNode(hasText(ctx.getString(R.string.csv_upload_sets)) and hasClickAction() and
            SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)).fetchSemanticsNode()
        compose.onNodeWithText(ctx.getString(R.string.csv_format_parts), useUnmergedTree = true).fetchSemanticsNode()
    }

    @Test
    fun `empty build list stands centered and offers no reset`() {
        zeige {
            PartsListScreen(TeilelisteUiState(),
                serverUrl = "", imageLoader = coil3.ImageLoader.Builder(ctx).build(), onScanBarcode = {})
        }
        compose.onAllNodes(hasText(ctx.getString(R.string.partslist_reset)) and hasClickAction()).assertCountEquals(0)
        val dichte = ctx.resources.displayMetrics.density
        val breite = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        for (text in listOf(R.string.partslist_empty_title, R.string.partslist_empty_hint)) {
            val b = compose.onNodeWithText(ctx.getString(text)).fetchSemanticsNode().boundsInRoot
            assertTrue("${ctx.getString(text)} klebt am Rand (${b.left / dichte} dp)", b.left >= 16 * dichte)
            assertTrue("${ctx.getString(text)} steht nicht mittig ($b in $breite)",
                kotlin.math.abs((b.left + b.right) / 2 - breite / 2) < 2 * dichte)
        }
    }

    @Test
    fun `the default star is a switch with the name of the location`() {
        world.paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[{"id":3,"name":"Keller"}]}"""
        val vm = einstellungen().also { it.loadOwnLocations() }
        zeige { LocationsRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        wait("Lagerorte") { vm.storageState.value.eigene.size == 1 }
        val stern = compose.onNodeWithContentDescription(ctx.getString(R.string.storage_vorgabe_cd, "Keller")).fetchSemanticsNode()
        assertEquals("TalkBack hört an/aus", ToggleableState.Off, stern.config.getOrNull(SemanticsProperties.ToggleableState))
    }

    @Test
    fun `removing names the account in the household`() {
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api, world.t.io))).also { it.loadHousehold() }
        zeige { HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        wait("Haushalt") { vm.householdState.value.status != null }
        val entfernen = ctx.getString(R.string.household_remove)
        for (name in listOf("lena", "tim")) {
            compose.onNode(hasContentDescription(ctx.getString(R.string.aktion_fuer, entfernen, name)) and hasClickAction())
                .fetchSemanticsNode("„$entfernen“ nennt $name nicht")
        }
    }

    @Test
    fun `price alerts name the name first and in the confirmation`() {
        world.paths.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","direction":"unter","threshold":750.0,"currency_code":"CHF","name":"Millennium Falcon"}]}"""
        val vm = einstellungen()
        zeige {
            PreisalarmeRoute(vm = vm,
                imageLoader = coil3.ImageLoader.Builder(ctx).build(), serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, reportToggle = {})
        }
        wait("Alarme") { vm.alarmOverview.value.geladen }
        val name = compose.onNodeWithText("Millennium Falcon", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val nummer = compose.onNodeWithText("75192-1", substring = true, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue("Name ($name) über der Nummer ($nummer)", name.bottom <= nummer.top)
        compose.onNodeWithContentDescription(ctx.getString(R.string.alerts_delete_fuer, "Millennium Falcon")).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.alerts_confirm_delete, "Millennium Falcon")).fetchSemanticsNode()
    }

    @Test
    fun `account changes the password only with a matching repetition and marks it otherwise`() {
        world.paths.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val konto = world.t.merke(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        zeige {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        wait("Profil") { konto.kontoState.value.profile != null }
        fun feld(label: Int) = compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(label)))[0]
        val wechseln = compose.onNode(hasText(ctx.getString(R.string.konto_password_button)) and hasClickAction())
        val switched = { world.paths.requests.count { "password" in it } }
        feld(R.string.konto_password_current).performTextInput("altes-passwort-1")
        feld(R.string.konto_password_new).performTextInput("neues-passwort-12")
        feld(R.string.register_password_repeat).performTextInput("anderes-passwort-1")
        compose.waitForIdle()
        // Tappable; nothing is submitted, the cursor stands in the repetition.
        wechseln.performScrollTo().assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals("Mit falscher Wiederholung abgeschickt", 0, switched())
        feld(R.string.register_password_repeat).assertIsFocused()
        feld(R.string.register_password_repeat).performTextClearance()
        feld(R.string.register_password_repeat).performTextInput("neues-passwort-12")
        wechseln.performScrollTo().performClick()
        wait("Passwortwechsel") { switched() == 1 }
    }

    /** A new address applies only after the link: the field shows the current one, below it the requested one. */
    @Test
    fun `account names the requested e-mail below the field`() {
        world.paths.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true,
            "new_email":"neu@example.org"}}"""
        val konto = world.t.merke(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        zeige {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        wait("Profil") { konto.kontoState.value.profile != null }
        compose.onNode(hasSetTextAction() and hasText("marco@example.org")).fetchSemanticsNode("Das Feld zeigt die geltende Adresse nicht")
        compose.onNodeWithText(ctx.getString(R.string.konto_email_ausstehend, "neu@example.org"), useUnmergedTree = true)
            .fetchSemanticsNode("Die beantragte Adresse fehlt unter dem Feld")
    }

    /** Changed via the text action, not by typing: no focused field. */
    @Test
    fun `account asks for the password when saving the profile`() {
        world.paths.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true}}"""
        val konto = world.t.merke(AccountViewModel(
            testAccountRepository(world.t.api, world.t.io),
            world.t.meldungen, world.t.sitzung, SessionFake()))
        zeige {
            AccountRoute(snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        wait("Profil") { konto.kontoState.value.profile != null }
        compose.onAllNodes(hasSetTextAction() and hasText(ctx.getString(R.string.register_first_name)))[0]
            .performSemanticsAction(SemanticsActions.SetText) { it(AnnotatedString("Marc")) }
        compose.waitForIdle()
        val speichern = compose.onNode(hasText(ctx.getString(R.string.konto_save)) and hasClickAction())
        speichern.performScrollTo()
        // If a dialog with a text field stands on this page, Compose under Robolectric
        // no longer comes to rest. Therefore without waitForIdle: stop the clock, drain the looper and
        // look up the dialog window at Robolectric ourselves.
        compose.mainClock.autoAdvance = false
        speichern.performClick()
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
        }
        val dialog = ShadowDialog.getLatestDialog()
        assertTrue("Kein Passwortdialog beim Speichern", dialog?.isShowing == true)
        assertTrue("Gespeichert ohne Passwort: ${world.paths.requests}", world.paths.requests.none { it.startsWith("PUT") })
        dialog?.dismiss()
        Shadows.shadowOf(Looper.getMainLooper()).idle()
    }

    /** Resetting throws away sets and list and therefore asks first. */
    @Test
    fun `build list takes sets via the plus in the field and resets them only after confirmation`() {
        val vm = world.bauliste()
        zeige { bauliste(vm) }
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
        val aufgeloest = mutableListOf<String>()
        val vm = world.bauliste { nr -> aufgeloest += nr; "Baumhaus" to emptyList() }
        zeige { bauliste(vm) }
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.gallery_set_number))).performTextInput("21318")
        compose.onNode(hasText(ctx.getString(R.string.partslist_generate)) and hasClickAction()).assertIsEnabled().performClick()
        wait("Bauliste") { aufgeloest.isNotEmpty() }
        assertEquals(listOf("21318-1"), aufgeloest)
    }
}
