package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
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
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.katalog.ui.CatalogUiState
import ch.brickinventoryapp.model.ui.Fehlerklasse
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.sammlung.ui.dialogs.BarcodeDialogZustand
import ch.brickinventoryapp.sammlung.ui.dialogs.BarcodeResultDialog
import ch.brickinventoryapp.model.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.model.MerkpostenAlarmAnsicht
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.katalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.katalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.konto.ui.screens.HaushaltRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerklisteRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerkpostenRueckgaengigRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungAktionen
import ch.brickinventoryapp.konto.ui.viewmodel.HaushaltViewModel
import ch.brickinventoryapp.katalog.ui.viewmodel.KatalogAktionen
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
 * Die Befunde der Ablaufprüfung 17, ausgeführt: Löschen mit Rückgängig, Fehler- und
 * Leerzustände des Katalogs, Erfassen nach dem Scan, Merkliste im Katalog, Haushalt.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   merkposten-loeschen-sofort         Löschen wieder sofort am Server → rot „H1 …“
 *   katalog-fehler-eigen               eigener Fehlerzustand mit Trefferzahl → rot „M2 …“
 *   katalog-leer-ohne-zuruecksetzen    leerer Katalog ohne Knopf → rot „M3 …“
 *   scanner-ohne-anzahl                Anzahl nicht weitergereicht → rot „M4 …“
 *   katalog-ohne-merkliste             Detail kennt den Merkposten nicht → rot „M6 …“
 *   haushalt-ohne-teilen               Einladung nur zum Kopieren → rot „M8 …“
 *   teile-fehler-mit-plus              „+“ auch im Fehlerzustand → rot „N1 …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
class AblaufBefundeTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val bilder = Beispielbilder.loader(ctx)
    private val welt = Beispiele.Welt(KontextTexte())

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
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
    private fun warte(was: String, bereit: () -> Boolean) {
        try {
            compose.waitUntil(10_000) { shadowOf(Looper.getMainLooper()).idle(); bereit() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("$was: nach 10 s nicht da", e)
        }
        compose.waitForIdle()
    }

    @Test
    fun `H1 ein Merkposten laesst sich nach dem Loeschen zurueckholen, samt Alarm`() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        warte("Merkliste") { vm.merklisteState.value.merkposten.isNotEmpty() }
        zeige {
            val meldung = remember { SnackbarHostState() }
            Scaffold(snackbarHost = { SnackbarHost(meldung) }) { innen ->
                MerkpostenRueckgaengigRoute(vm, meldung)
                Box(Modifier.padding(innen)) {
                    MerklisteRoute(vm = vm, imageLoader = bilder, nebeneinander = true, onScan = {}, onOeffnenEinzeln = { _, _ -> })
                }
            }
        }
        // fmtMoney setzt ein festes Leerzeichen zwischen Code und Betrag.
        val alarm = ctx.getString(R.string.wanted_alert_below, fmtMoney(349.0, Waehrung("CHF")))
        compose.onAllNodesWithText(alarm, substring = true).fetchSemanticsNodes()
            .let { assertTrue("Alarm vor dem Löschen", it.isNotEmpty()) }
        compose.onNode(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).performClick()
        warte("Detail") { !vm.merkpostenDetailState.value.laedt }
        // Ab hier die Uhr von Hand: Sonst liefe die Snackbar im Takt der Testuhr sofort ab.
        compose.mainClock.autoAdvance = false
        fun schritt() = repeat(5) { compose.mainClock.advanceTimeBy(100); shadowOf(Looper.getMainLooper()).idle() }
        compose.onNodeWithContentDescription(ctx.getString(R.string.common_delete)).performClick()
        schritt()
        compose.onNodeWithText(ctx.getString(R.string.wanted_deleted, "Lion Knights' Castle")).fetchSemanticsNode("Keine Snackbar")
        assertTrue("Schon gelöscht, bevor die Snackbar endet", welt.pfade.anfragenAn("DELETE").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        schritt()
        warte("zurück") { vm.merklisteState.value.merkposten.any { it.setNumber == "10305-1" } }
        schritt()
        compose.onAllNodesWithText(alarm, substring = true)
            .fetchSemanticsNodes().let { assertTrue("Alarm wieder sichtbar", it.isNotEmpty()) }
        assertTrue("Nach Rückgängig nie gelöscht", welt.pfade.anfragenAn("DELETE").isEmpty())
    }

    private object KeineKatalogAktionen : KatalogAktionen {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogSichtbar(ersteSeite: Int, letzteSeite: Int) = Unit
        override fun scrollCatalogTo(nummer: Int) = Unit
        override fun setCatalogScrollPos(index: Int, offset: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: Katalogsortierung) = Unit
    }

    @Test
    fun `M2 der Katalog zeigt im Fehler denselben Zustand wie die Galerie, ohne Trefferzahl`() {
        zeige {
            CatalogScreen(CatalogUiState(error = "Serverfehler (500)", fehlerKlasse = Fehlerklasse.SERVER),
                serverUrl = "", katalog = KeineKatalogAktionen, imageLoader = bilder, onSetClick = {})
        }
        compose.onNodeWithText(ctx.getString(R.string.fehler_server_titel)).fetchSemanticsNode("Fehler ohne Klasse")
        compose.onNodeWithText(ctx.getString(R.string.common_retry)).fetchSemanticsNode("Kein „Erneut versuchen“")
        compose.onAllNodesWithText("Sets im Katalog", substring = true).assertCountEquals(0)
    }

    @Test
    fun `M3 ein leerer Katalog mit Filter bietet Zuruecksetzen, danach stehen Kacheln da`() {
        val sets = listOf(KatalogSetAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, numParts = 4514))
        var zustand by mutableStateOf(CatalogUiState(themeId = 721))
        val aktionen = object : KatalogAktionen by KeineKatalogAktionen {
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
    fun `M4 die Erfassung nach dem Scan hat eine Anzahl und behaelt Eingaben ueber eine Drehung`() {
        var menge = 0
        var preis: Double? = null
        val aktionen = object : ErfassungAktionen {
            override fun confirmAddBarcode(wunsch: Erfassungswunsch) { menge = wunsch.menge; preis = wunsch.kaufpreis }
            override fun cancelBarcode() = Unit
            override fun brichPruefungAb() = Unit
        }
        val zustand = BarcodeDialogZustand(AppUiState(), BlickfeldUiState(),
            BarcodeUiState(result = "75192-1", setName = "Millennium Falcon", besitzMenge = 2), LagerUiState())
        val drehen = StateRestorationTester(compose)
        drehen.setContent { BrickInventoryManagerTheme { BarcodeResultDialog(zustand, aktionen, bilder) } }
        compose.onNodeWithText(ctx.getString(R.string.barcode_schon_besessen, 2)).fetchSemanticsNode("Besitz nicht genannt")
        val anzahl = hasSetTextAction() and hasText(ctx.getString(R.string.common_quantity))
        compose.onNode(anzahl).performTextClearance()
        compose.onNode(anzahl).performTextInput("2")
        compose.onNode(hasSetTextAction() and hasText(ctx.getString(R.string.barcode_purchase_price))).performTextInput("650")
        drehen.emulateSavedInstanceStateRestore()
        compose.onNode(anzahl).fetchSemanticsNode().let { n ->
            val text = n.config.getOrNull(SemanticsProperties.EditableText)?.text
            assertEquals("Anzahl nach der Drehung", "2", text)
        }
        compose.onNodeWithText(ctx.getString(R.string.barcode_add)).performClick()
        assertEquals(2, menge)
        assertEquals(650.0, preis)
    }

    @Test
    fun `M6 das Katalog-Detail zeigt den Merkposten und oeffnet ihn`() {
        var geoeffnet: Pair<String, Zustand>? = null
        val gemerkt = MerkpostenAnsicht(setNumber = "10305-1", condition = Zustand.NEU, name = "Lion Knights' Castle", waehrung = Waehrung("CHF"),
            alarm = MerkpostenAlarmAnsicht(richtung = "unter", schwelle = 349.0))
        zeige {
            CatalogDetailScreen(setNumber = "10305-1",
                detail = KatalogDetailAnsicht(setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022),
                isLoading = false, imageLoader = bilder, serverUrl = "", onLoad = {},
                onAddToGallery = {}, onWish = { _, _, _, _, _ -> }, onOpenInGallery = {}, onBack = {},
                gemerkt = gemerkt, onOeffneMerkposten = { sn, z -> geoeffnet = sn to z })
        }
        compose.onNodeWithText(ctx.getString(R.string.catalog_auf_merkliste)).fetchSemanticsNode("Merkliste nicht genannt")
        compose.onAllNodesWithText(ctx.getString(R.string.wanted_add_submit)).assertCountEquals(0)
        compose.onNodeWithText(ctx.getString(R.string.catalog_merkposten_oeffnen)).performScrollTo().performClick()
        assertEquals("10305-1" to Zustand.NEU, geoeffnet)
    }

    @Test
    fun `M8 die Einladung laesst sich teilen und kopieren, mit Gueltigkeit und Sperrgrund`() {
        welt.pfade.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF","sub_accounts":[]}"""
        welt.pfade.antworten["/api/v1/settings/household/invite"] = """{"success":true,"code":"ABCD-1234","expires_in":86400}"""
        val vm = welt.t.merke(HaushaltViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise, welt.t.bestand, HaushaltRepository(welt.t.api, welt.t.cache),
            KontoRepository(welt.t.api, welt.t.cache)))
        zeige { HaushaltRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        warte("Haushalt") { vm.householdState.value.status != null }
        compose.onNodeWithText(ctx.getString(R.string.household_redeem_sperrgrund)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_create)).performScrollTo().performClick()
        warte("Code") { vm.householdState.value.inviteCode != null }
        compose.onNodeWithText(ctx.getString(R.string.household_invite_teilen)).performScrollTo()
        compose.onNodeWithText(ctx.getString(R.string.household_invite_copy)).fetchSemanticsNode()
        compose.onAllNodesWithText("Gültig bis", substring = true).fetchSemanticsNodes()
            .let { assertTrue("Gültigkeit fehlt", it.isNotEmpty()) }
    }

    @Test
    fun `N1 im Fehlerzustand steht kein Erfassen-Knopf, wie in Galerie und Merkliste`() {
        welt.pfade.codes["/api/v1/parts"] = 500
        val vm = welt.teile().also { it.loadParts() }
        warte("Fehler") { vm.partsState.value.let { !it.partsLoading && it.partsFehler != null } }
        zeige { PartsRoute(vm = vm, imageLoader = bilder) }
        compose.onAllNodesWithContentDescription(ctx.getString(R.string.parts_add)).assertCountEquals(0)
    }
}
