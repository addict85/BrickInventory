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
import ch.brickinventoryapp.anmeldung.ui.AnmeldeFormular
import ch.brickinventoryapp.anmeldung.ui.screens.LoginScreen
import ch.brickinventoryapp.anmeldung.ui.screens.SetupScreen
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.finanzen.ui.screens.FinanceRoute
import ch.brickinventoryapp.katalog.ui.CatalogUiState
import ch.brickinventoryapp.katalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.katalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.konto.ui.KontoUiState
import ch.brickinventoryapp.konto.ui.UpdateUiState
import ch.brickinventoryapp.konto.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.konto.ui.screens.EinstellungenZustand
import ch.brickinventoryapp.konto.ui.screens.SettingsScreen
import ch.brickinventoryapp.konto.ui.screens.StartpasswortMaske
import ch.brickinventoryapp.konto.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.konto.ui.viewmodel.EinstellungenAktionen
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateAktionen
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.fach.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.sammlung.ui.screens.GalleryRoute
import ch.brickinventoryapp.sammlung.ui.screens.MerklisteRoute
import ch.brickinventoryapp.sammlung.ui.screens.SetDetailRoute
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.teile.ui.screens.MinifigsRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.testing.testKatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungAktionen
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
class TippzielUndNameTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val welt = Beispiele.Welt(KontextTexte())
    private val bilder = Beispielbilder.loader(ctx)
    private val vorher = Locale.getDefault()

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    /** Eine Schnittstelle, deren Aufrufe nichts tun; nur Rückgaben ohne Wert werden gebraucht. */
    private inline fun <reified T> keine(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T

    /** Zeigt [inhalt], sobald [bereit] gilt, und prüft jedes antippbare Element. */
    private fun pruefe(name: String, bereit: () -> Boolean = { true }, inhalt: @Composable () -> Unit) {
        treibeBis(name, anfragen = { welt.pfade.anfragen.size }, bereit = bereit)
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        treibeBis("$name (angezeigt)", anfragen = { welt.pfade.anfragen.size }, bereit = bereit)
        compose.waitForIdle()
        val dichte = ctx.resources.displayMetrics.density
        val mindest = 48 * dichte - 0.5f
        val antippbar = compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsActions.OnClick)).fetchSemanticsNodes()
        assertTrue("$name: nichts Antippbares gefunden — greift die Suche noch?", antippbar.isNotEmpty())
        val klein = antippbar.filter { n ->
            val ziel = n.touchBoundsInRoot
            maxOf(n.size.width.toFloat(), ziel.width) < mindest || maxOf(n.size.height.toFloat(), ziel.height) < mindest
        }.map { "${beschreibe(it)} (${(it.size.width / dichte).toInt()}×${(it.size.height / dichte).toInt()} dp)" }
        val namenlos = antippbar.filter { !hatNamen(it) }.map { beschreibe(it) }
        assertTrue("$name: Tippziel unter 48 dp: $klein", klein.isEmpty())
        assertTrue("$name: ohne Namen: $namenlos", namenlos.isEmpty())
    }

    private fun hatNamen(n: SemanticsNode): Boolean {
        val c = n.config
        return c.getOrNull(SemanticsProperties.Text).orEmpty().any { it.text.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.isNotBlank() } ||
            c.getOrNull(SemanticsProperties.EditableText) != null
    }

    private fun beschreibe(n: SemanticsNode): String {
        val c = n.config
        val text = (c.getOrNull(SemanticsProperties.ContentDescription).orEmpty() +
            c.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }).joinToString(" ").take(40)
        return "„$text“ #${n.id}"
    }

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.sitzung, welt.t.filter(), welt.t.hinweise,
        testSetsRepository(welt.t.api), welt.t.setKatalog(), welt.t.merkliste(), testKatalogRepository(welt.t.api),
        object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    @Test
    fun galerie() {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        pruefe("Galerie", { vm.galleryState.value.sets.isNotEmpty() }) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = welt.setDetail()
        pruefe("Set-Detail", { vm.setDetailState.value.let { it.setDetail != null && !it.preisAbruf.laedt } }) {
            SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})
        }
    }

    @Test
    fun teile() {
        val vm = welt.teile().also { it.loadParts() }
        pruefe("Teile", { vm.teileState.value.parts.isNotEmpty() }) { PartsRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun figuren() {
        val vm = welt.figuren().also { it.loadMinifigs() }
        pruefe("Figuren", { vm.figurenZustand.value.minifigs.isNotEmpty() }) { MinifigsRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun finanzen() {
        val vm = welt.finanzen().also { it.loadValuation() }
        pruefe("Finanzen", { vm.financeState.value.valuation != null }) { FinanceRoute(vm = vm, imageLoader = bilder) }
    }

    @Test
    fun merkliste() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        pruefe("Merkliste", { vm.merklisteState.value.merkposten.isNotEmpty() }) {
            MerklisteRoute(vm = vm, imageLoader = bilder, onScan = {}, onOeffnenEinzeln = { _, _ -> })
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
    fun registrieren() = pruefe("Registrieren") { login(AnmeldeFormular.REGISTRIEREN) }

    @Test
    fun einrichten() = pruefe("Einrichten") { SetupScreen(currentUrl = "https://brick.example.org", onSave = {}, entwicklung = false) }

    @Test
    fun startpasswort() = pruefe("Startpasswort") { StartpasswortMaske(KontoUiState(), { _, _, _ -> }, {}) }

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
