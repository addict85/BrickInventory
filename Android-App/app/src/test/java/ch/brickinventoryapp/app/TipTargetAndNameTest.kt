package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.UpdateUiState
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.account.ui.screens.EinstellungenZustand
import ch.brickinventoryapp.account.ui.screens.SettingsScreen
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.account.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.account.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.state.ui.viewmodel.DarstellungAktionen
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.lang.reflect.Proxy
import java.util.Locale

/**
 * Barrierefreiheit der Hauptbildschirme mit Beispieldaten: Jedes antippbare Element hat
 * ein Tippziel von mindestens 48 × 48 dp (Layout oder Tippfläche) und trägt einen Namen
 * (Text, Beschreibung oder Feld); eine Rolle allein sagt nur „Schaltfläche“, nicht welche.
 * Ersetzt die Quelltextsuche nach kleinen IconButtons (TouchTargetSizeTest).
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   tippziel-klein         „Nach Update suchen“ ohne heightIn, Material-Knopf 40 dp → rot „einstellungen“
 *                          (eine 40-dp-Zeile ohne eigene Form blieb grün: touchBoundsInRoot dehnt sie auf 48 dp)
 *   tippziel-ohne-namen    Erfassen-Knopf ohne Beschreibung → rot „galerie“ (ohne Namen)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TipTargetAndNameTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.Welt(ContextTexts())
    private val bilder = SampleImages.loader(ctx)
    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    /** Eine Schnittstelle, deren Aufrufe nichts tun; nur Rückgaben ohne Wert werden gebraucht. */
    private inline fun <reified T> keine(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T

    /** Zeigt [inhalt], sobald [bereit] gilt, und prüft jedes antippbare Element. */
    private fun pruefe(name: String, bereit: () -> Boolean = { true }, inhalt: @Composable () -> Unit) {
        driveUntil(name, requests = { world.paths.requests.size }, bereit = bereit)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        driveUntil("$name (angezeigt)", requests = { world.paths.requests.size }, bereit = bereit)
        compose.waitForIdle()
        val dichte = ctx.resources.displayMetrics.density
        val mindest = 48 * dichte - 0.5f
        val antippbar = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick)).fetchSemanticsNodes()
        assertTrue("$name: nichts Antippbares gefunden — greift die Suche noch?", antippbar.isNotEmpty())
        val klein = antippbar.filter { n ->
            val ziel = n.touchBoundsInRoot
            maxOf(n.size.width.toFloat(), ziel.width) < mindest || maxOf(n.size.height.toFloat(), ziel.height) < mindest
        }.map { "${describe(it)} (${(it.size.width / dichte).toInt()}×${(it.size.height / dichte).toInt()} dp)" }
        val nameless = antippbar.filter { !hatNames(it) }.map { describe(it) }
        assertTrue("$name: Tippziel unter 48 dp: $klein", klein.isEmpty())
        assertTrue("$name: ohne Namen: $nameless", nameless.isEmpty())
    }

    private fun hatNames(n: SemanticsNode): Boolean {
        val c = n.config
        return c.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.EditableText) != null
    }

    private fun describe(n: SemanticsNode): String {
        val c = n.config
        val text = (c.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            c.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }).joinToString(" ").take(40)
        return "„$text“ #${n.id}"
    }

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    @Test
    fun galerie() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        pruefe("Galerie", { vm.galleryState.value.sets.isNotEmpty() }) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = world.setDetail()
        pruefe("Set-Detail", { vm.setDetailState.value.let { it.setDetail != null && !it.priceFetch.laedt } }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    @Test
    fun teile() {
        val vm = world.teile().also { it.loadParts() }
        pruefe("Teile", { vm.teileState.value.parts.isNotEmpty() }) { PartsRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun figuren() {
        val vm = world.figuren().also { it.loadMinifigs() }
        pruefe("Figuren", { vm.minifigsState.value.minifigs.isNotEmpty() }) { MinifigsRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun finanzen() {
        val vm = world.finanzen().also { it.loadValuation() }
        pruefe("Finanzen", { vm.financeState.value.valuation != null }) { FinanceRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun merkliste() {
        val vm = world.merkliste().also { it.loadWanted() }
        pruefe("Merkliste", { vm.wantedState.value.merkposten.isNotEmpty() }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
        }
    }

    @Test
    fun katalog() {
        val sets = (1..4).map { KatalogSetAnsicht(setNumber = "1030$it-1", name = "Beispielset $it", year = 2020 + it, numParts = 500 * it) }
        pruefe("Katalog") {
            CatalogScreen(CatalogUiState(loadedPages = mapOf(1 to sets), total = sets.size), serverUrl = "",
                katalog = keine<KatalogAktionen>(), imageLoader = bilder, onSetClick = {})
        }
    }

    @Test
    fun gutscheine() = pruefe("Gutscheine") { Gutscheine() }

    @Test
    fun einstellungen() = pruefe("Einstellungen") {
        SettingsScreen(
            zustand = EinstellungenZustand(AppUiState(serverUrl = "https://brick.example.org"), UpdateUiState(),
                "system", Design.CLASSIC, false, false, false, false),
            aktionen = keine<EinstellungenAktionen>(), update = keine<UpdateAktionen>(),
            darstellung = keine<DarstellungAktionen>(), onNutzerCa = {}, onLogout = {}, onServerWechseln = {},
            scrollState = androidx.compose.foundation.rememberScrollState(),
        )
    }

    @Test
    fun anmelden() = pruefe("Anmelden") { login(AnmeldeFormular.ANMELDEN) }

    @Test
    fun registrieren() = pruefe("Registrieren") { login(AnmeldeFormular.REGISTER) }

    @Test
    fun einrichten() = pruefe("Einrichten") { SetupScreen(currentUrl = "https://brick.example.org", onSave = {}, entwicklung = false) }

    @Test
    fun startpasswort() = pruefe("Startpasswort") { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }

    @Test
    fun zweiterFaktor() = pruefe("Zweiter Faktor") { ZweiterFaktorPflichtMaske(ZweiterFaktorUiState(aktiv = false), {}, {}, {}, {}) }

    @Composable
    private fun login(formular: AnmeldeFormular) = LoginScreen(
        serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
        formular = formular, registrierungOffen = true, kontoLaeuft = false,
        kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
        onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
    )
}
