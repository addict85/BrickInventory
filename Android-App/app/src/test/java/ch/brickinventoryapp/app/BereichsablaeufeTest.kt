package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.testing.text
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Katalogsortierung
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ComposeTimeoutException
import android.os.Looper
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
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.collection.ui.BarcodeUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeDialogZustand
import ch.brickinventoryapp.collection.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.model.domain.WantedItemAlarmView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.account.ui.screens.HouseholdRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.screens.WantedItemUndoRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.collection.ui.viewmodel.ErfassungAktionen
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
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
 * Abläufe über einen Bildschirm hinaus: Löschen mit Rückgängig, Fehler- und Leerzustände
 * des Katalogs, Erfassen nach dem Scan, Merkliste im Katalog, Haushalt.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   merkposten-loeschen-sofort         Löschen wieder sofort am Server → rot „ein Merkposten laesst sich …“
 *   katalog-fehler-eigen               eigener Fehlerzustand mit Trefferzahl → rot „der Katalog zeigt im …“
 *   katalog-leer-ohne-zuruecksetzen    leerer Katalog ohne Knopf → rot „ein leerer Katalog mit …“
 *   scanner-ohne-anzahl                Anzahl nicht weitergereicht → rot „die Erfassung nach dem …“
 *   katalog-ohne-merkliste             Detail kennt den Merkposten nicht → rot „das Katalog-Detail zeigt den …“
 *   haushalt-ohne-teilen               Einladung nur zum Kopieren → rot „die Einladung laesst sich …“
 *   teile-fehler-mit-plus              „+“ auch im Fehlerzustand → rot „im Fehlerzustand steht kein …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class BereichsablaeufeTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val bilder = SampleImages.loader(ctx)
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

    /** Den Hauptlooper treiben, bis [bereit] gilt — der Server antwortet in einem eigenen Faden. */
    private fun wait(was: String, bereit: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); bereit() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: nach 10 s nicht da", e)
        }
        compose.waitForIdle()
    }

    @Test
    fun `a wishlist item can be restored after deleting, including its alert`() {
        val vm = world.merkliste().also { it.loadWanted() }
        wait("Merkliste") { vm.wantedState.value.merkposten.isNotEmpty() }
        zeige {
            val meldung = remember { SnackbarHostState() }
            Scaffold(snackbarHost = { SnackbarHost(meldung) }) { innen ->
                WantedItemUndoRoute(vm, meldung)
                Box(Modifier.padding(innen)) {
                    WantedRoute(vm = vm, imageLoader = bilder, sideBySide = true, onScan = {}, onOpenSingle = { _, _ -> })
                }
            }
        }
        // fmtMoney setzt ein festes Leerzeichen zwischen Code und Betrag.
        val alarm = ctx.getString(R.string.wanted_alert_below, fmtMoney(349.0, Waehrung("CHF")))
        compose.onAllNodesWithText(alarm, substring = true).fetchSemanticsNodes()
            .let { assertTrue("Alarm vor dem Löschen", it.isNotEmpty()) }
        compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).performClick()
        wait("Detail") { !vm.wantedItemDetailState.value.abruf.laedt }
        // Ab hier die Uhr von Hand: Sonst liefe die Snackbar im Takt der Testuhr sofort ab.
        compose.mainClock.autoAdvance = false
        fun schritt() = repeat(5) { compose.mainClock.advanceTimeBy(100); shadowOf(Looper.getMainLooper()).idle() }
        compose.onNodeWithContentDescription(ctx.getString(R.string.common_delete)).performClick()
        schritt()
        compose.onNodeWithText(ctx.getString(R.string.wanted_deleted, "Lion Knights' Castle")).fetchSemanticsNode("Keine Snackbar")
        assertTrue("Schon gelöscht, bevor die Snackbar endet", world.paths.requestsAn("DELETE").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        schritt()
        wait("zurück") { vm.wantedState.value.merkposten.any { it.setNumber == "10305-1" } }
        schritt()
        compose.onAllNodesWithText(alarm, substring = true)
            .fetchSemanticsNodes().let { assertTrue("Alarm wieder sichtbar", it.isNotEmpty()) }
        assertTrue("Nach Rückgängig nie gelöscht", world.paths.requestsAn("DELETE").isEmpty())
    }

    private object NoCatalogActions : KatalogAktionen {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(nummer: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: Katalogsortierung) = Unit
    }

    @Test
    fun `the catalog shows the same error state as the gallery, without a hit count`() {
        zeige {
            CatalogScreen(CatalogUiState(abruf = Laden.Fehler(Fehlerklasse.SERVER, Meldung.Text("Serverfehler (500)"))),
                serverUrl = "", katalog = NoCatalogActions, imageLoader = bilder, onSetClick = {})
        }
        compose.onNodeWithText(ctx.getString(R.string.fehler_server_titel)).fetchSemanticsNode("Fehler ohne Klasse")
        compose.onNodeWithText(ctx.getString(R.string.common_retry)).fetchSemanticsNode("Kein „Erneut versuchen“")
        compose.onAllNodesWithText("Sets im Katalog", substring = true).assertCountEquals(0)
    }

    @Test
    fun `an empty catalog with a filter offers reset, afterwards tiles are shown`() {
        val sets = listOf(KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, numParts = 4514))
        var zustand by mutableStateOf(CatalogUiState(themeId = 721))
        val aktionen = object : KatalogAktionen by NoCatalogActions {
            override fun setCatalogTheme(themeId: Int?) {
                zustand = CatalogUiState(themeId = themeId, loadedPages = mapOf(1 to sets), total = sets.size)
            }
        }
        zeige { CatalogScreen(zustand, serverUrl = "", katalog = aktionen, imageLoader = bilder, onSetClick = {}) }
        compose.onNodeWithText(ctx.getString(R.string.filter_reset_all)).performClick()
        compose.waitForIdle()
        compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).fetchSemanticsNode("Keine Kachel nach dem Zurücksetzen")
    }

    @Test
    fun `adding after the scan has a quantity and keeps inputs across a rotation`() {
        var menge = 0
        var preis: Geld? = null
        val aktionen = object : ErfassungAktionen {
            override fun confirmAddBarcode(wish: Erfassungswunsch) { menge = wish.menge; preis = wish.kaufpreis }
            override fun cancelBarcode() = Unit
            override fun abortCheckAb() = Unit
        }
        val zustand = BarcodeDialogZustand(AppUiState(), ScopeUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", ownershipQuantity = 2), LagerUiState())
        val rotate = StateRestorationTester(compose)
        rotate.setContent { BrickInventoryManagerTheme { BarcodeResultDialog(zustand, aktionen, bilder) } }
        compose.onNodeWithText(ctx.getString(R.string.barcode_schon_besessen, 2)).fetchSemanticsNode("Besitz nicht genannt")
        val anzahl = hasSetTextAction() and hasText(ctx.getString(R.string.common_quantity))
        compose.onNode(anzahl).performTextClearance()
        compose.onNode(anzahl).performTextInput("2")
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.barcode_purchase_price))).performTextInput("650")
        rotate.emulateSavedInstanceStateRestore()
        compose.onNode(anzahl).fetchSemanticsNode().let { n ->
            val text = n.config.getOrNull(SemanticsProperties.EditableText)?.text
            assertEquals("Anzahl nach der Drehung", "2", text)
        }
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        assertEquals(2, menge)
        assertEquals(Geld.aus(650.0), preis)
    }

    @Test
    fun `the catalog detail shows the wishlist item and opens it`() {
        var geoeffnet: Pair<String, Zustand>? = null
        val gemerkt = WantedItemView(setNumber = "10305-1", condition = Zustand.NEU, name = "Lion Knights' Castle", waehrung = Waehrung("CHF"),
            alarm = WantedItemAlarmView(richtung = Alarmrichtung.UNTER, schwelle = Geld.aus(349.0)!!))
        zeige {
            CatalogDetailScreen(setNumber = "10305-1",
                geladen = Laden.Daten(CatalogDetailView(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022)),
                imageLoader = bilder, serverUrl = "", onLoad = {},
                onAddToGallery = {}, onWish = {}, onOpenInGallery = {}, onBack = {},
                gemerkt = gemerkt, onOpenWantedItem = { sn, z -> geoeffnet = sn to z })
        }
        compose.onNodeWithText(ctx.getString(R.string.catalog_auf_merkliste)).fetchSemanticsNode("Merkliste nicht genannt")
        compose.onAllNodesWithText(ctx.getString(R.string.wanted_add_submit)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.catalog_merkposten_oeffnen)).performScrollTo().performClick()
        assertEquals("10305-1" to Zustand.NEU, geoeffnet)
    }

    @Test
    fun `the invitation can be shared and copied, with validity and lock reason`() {
        world.paths.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF","sub_accounts":[]}"""
        world.paths.antworten["/api/v1/settings/household/invite"] = """{"success":true,"code":"ABCD-1234","expires_in":86400}"""
        val vm = world.t.merke(HouseholdViewModel(world.t.sitzung, world.t.filter(), world.t.sync,
            testHouseholdRepository(world.t.api), testAccountRepository(world.t.api)))
        zeige { HouseholdRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        wait("Haushalt") { vm.householdState.value.status != null }
        compose.onNodeWithText(ctx.getString(R.string.household_redeem_sperrgrund)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_create)).performScrollTo().performClick()
        wait("Code") { vm.householdState.value.inviteCode != null }
        compose.onNodeWithText(ctx.getString(R.string.household_invite_teilen)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_copy)).fetchSemanticsNode()
        compose.onAllNodesWithText("Gültig bis", substring = true).fetchSemanticsNodes()
            .let { assertTrue("Gültigkeit fehlt", it.isNotEmpty()) }
    }

    @Test
    fun `in the error state there is no add button, as in gallery and wishlist`() {
        world.paths.codes["/api/v1/parts"] = 500
        val vm = world.teile().also { it.loadParts() }
        wait("Fehler") { vm.teileState.value.let { it.partsFetch is Laden.Fehler } }
        zeige { PartsRoute(vm = vm, imageLoader = bilder) }
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.parts_add)).assertCountEquals(0)
    }
}
