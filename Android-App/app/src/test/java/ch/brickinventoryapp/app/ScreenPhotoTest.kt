package ch.brickinventoryapp.app

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import ch.brickinventoryapp.account.ui.AccountUiState
import ch.brickinventoryapp.account.ui.ZweiterFaktorUiState
import ch.brickinventoryapp.finances.ui.screens.FinanceRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.finances.ui.screens.GutscheineCard
import ch.brickinventoryapp.login.ui.screens.LoginScreen
import ch.brickinventoryapp.collection.ui.screens.WantedRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.collection.ui.screens.SetDetailRoute
import ch.brickinventoryapp.login.ui.screens.SetupScreen
import ch.brickinventoryapp.account.ui.screens.StartPasswordMask
import ch.brickinventoryapp.account.ui.screens.ZweiterFaktorPflichtMaske
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.fehlerTextId
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import android.content.Context
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.remember
import ch.brickinventoryapp.finances.ui.screens.VouchersPage
import java.util.Locale

/**
 * Screenshots of the main screens with sample data (Beispiele), each in
 * three designs, light and dark, on phone and tablet, in German (de-CH) like
 * most users; English is photographed by ScreenPhotoVariantsTest. If reference images lie
 * in src/test/bildschirmfotos, CI compares against them (verifyRoborazziDebug),
 * otherwise it records; they are checked in via workflow (bildschirmfotos=true).
 *
 * The vouchers stand as their own page under “More”; photographed is their
 * building block (GutscheineCard), because the page gets its ViewModel via Hilt.
 *
 * Counter-check: a photo that compares nothing cannot turn red. It is
 * only possible with checked-in references (change a color in Theme.kt →
 * verifyRoborazziDebug red) and not measurable here without the Android SDK; until then
 * SampleDataTest checks that the images show content.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ScreenPhotoTest(private val design: String, private val dunkel: Boolean, private val geraet: String) {

    companion object {
        private val DEVICES = mapOf(
            "telefon" to "w411dp-h891dp-port-xxhdpi",
            "tablet" to "w1280dp-h800dp-land-xhdpi",
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}-{2}")
        fun faelle(): List<Array<Any>> =
            listOf("classic", "brick", "noppe").flatMap { d ->
                listOf(false, true).flatMap { dk -> DEVICES.keys.map { g -> arrayOf<Any>(d, dk, g) } }
            }
    }

    @get:Rule
    val compose = createComposeRule()

    private val world = Examples.Welt(ContextTexts())
    private val bilder = SampleImages.loader(ApplicationProvider.getApplicationContext())
    private val vorher = Locale.getDefault()

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    /** The data comes before the screen; the world responds in ticks. */
    private fun bereitstellen(name: String, bereit: () -> Boolean, zustand: () -> Any?) {
        driveUntil(name, requests = { world.paths.requests.size }, zustand = zustand, bereit = bereit)
    }

    private fun photo(name: String, bereit: () -> Boolean = { true }, zustand: () -> Any? = { null },
                     inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-" + DEVICES.getValue(geraet))
        Locale.setDefault(Locale.forLanguageTag("de-CH"))
        bereitstellen(name, bereit, zustand)
        compose.setContent {
            BrickInventoryManagerTheme(theme = checkNotNull(Design.aus(design)) { design }, dunkel = dunkel) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        // The screen partly loads more on appearing (e.g. the purchases). These
        // responses also come via the main looper, so drive it again.
        bereitstellen("$name (angezeigt)", bereit, zustand)
        compose.waitForIdle()
        val hell = if (dunkel) "dunkel" else "hell"
        compose.onRoot().captureRoboImage("src/test/bildschirmfotos/${name}_${design}_${hell}_$geraet.png")
    }

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(),
        testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    @Test
    fun galerie() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        photo("galerie", { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.abruf.laedt } }, { vm.galleryState.value }) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = world.setDetail()
        // All sections, not only the set: price, history and purchases come
        // in separate fetches, and a photo in the middle of loading deviates from the reference image.
        val fertig = { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.detailFetch.laedt && !s.priceFetch.laedt && !s.historyFetch.laedt && !s.purchasesFetch.laedt } }
        photo("set-detail", fertig, { vm.setDetailState.value }) {
            SetDetailRoute(setNumber = Examples.SET, vm = vm, serverUrl = "", imageLoader = bilder,
                onBack = {}, onDelete = {})
        }
    }

    @Test
    fun teile() {
        val vm = world.teile().also { it.loadParts() }
        photo("teile", { vm.teileState.value.parts.isNotEmpty() }, { vm.teileState.value }) {
            PartsRoute(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun figuren() {
        val vm = world.figuren().also { it.loadMinifigs() }
        photo("figuren", { vm.minifigsState.value.minifigs.isNotEmpty() }, { vm.minifigsState.value }) {
            MinifigsRoute(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun finanzen() {
        val vm = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        // loadValuation() loads parts, figures and P&L only after the valuation.
        photo("finanzen", { vm.financeState.value.let { it.valuation != null && it.partsValuation != null &&
            it.figsValuation != null && it.pnl != null && it.historyPoints.isNotEmpty() &&
            !it.bewertung.laedt && !it.verlauf.laedt } }, { vm.financeState.value }) {
            FinanceRoute(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun merkliste() {
        val vm = world.merkliste().also { it.loadWanted() }
        photo("merkliste", { vm.wantedState.value.merkposten.isNotEmpty() }, { vm.wantedState.value }) {
            WantedRoute(vm = vm, imageLoader = bilder, onScan = {}, onOpenSingle = { _, _ -> })
        }
    }

    @Test
    fun anmelden() {
        photo("anmelden") {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
    }

    @Test
    fun einrichten() {
        photo("einrichten") { SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, entwicklung = false) }
    }

    /** A saved http address from an older version: at the top the instructions for https. */
    @Test
    fun setUpLegacyStock() {
        photo("einrichten-altbestand") { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
    }

    @Test
    fun gutscheine() {
        photo("gutscheine") { Gutscheine() }
    }

    @Test
    fun registrieren() {
        photo("registrieren") {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.REGISTER, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
    }

    /** The mandatory forms are dead ends until the end — hence in every design. */
    @Test
    fun startpasswort() {
        photo("startpasswort") { StartPasswordMask(AccountUiState(), { _, _, _ -> }, {}) }
    }

    @Test
    fun zweiterFaktor() {
        photo("zweiter-faktor") { ZweiterFaktorPflichtMaske(ZweiterFaktorUiState(aktiv = false), {}, {}, {}, {}) }
    }
}

/**
 * Two vouchers, one with PIN and balance, one without — the two row forms —
 * on their page with a menu in the bar and the floating button for creating.
 */
@Composable
internal fun Gutscheine() {
    val gutscheine = GutscheinUiState(gutscheine = listOf(
        Gutschein(id = 1, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = Waehrung("CHF")).alsAnsicht(),
        Gutschein(id = 2, number = "6061 9876 5432", amount = 20.0, currency = Waehrung("CHF")).alsAnsicht()))
    VouchersPage(gutscheine, remember { SnackbarHostState() }, onZurueck = {}, onBalanceAll = {}, exportOn = {}) { neu, onNew ->
        GutscheineCard(
            zustand = gutscheine, onFeld = { _, _, _, _ -> }, switchOnPin = {}, editOn = {},
            onAbbrechen = {}, onSpeichern = {}, deleteOn = {}, openOnPdf = {}, onKopieren = { _, _ -> },
            onBalance = {}, cancelOnBalance = {}, onErneut = {},
            onBestaetigen = { _, _ -> }, cancelOnConfirmation = {}, neu = neu, onNew = onNew,
        )
    }
}

/**
 * Texts of the ViewModels from the real resources, so that a photo shows „Serverfehler (500)“
 * instead of the placeholder „fehler“ of the JVM tests (NumbersTexts).
 */
internal class ContextTexts(
    private val ctx: Context = ApplicationProvider.getApplicationContext(),
) : Texte {
    override fun text(id: Int, vararg args: Any?): String =
        if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
    override fun menge(id: Int, anzahl: Int, vararg args: Any?): String =
        ctx.resources.getQuantityString(id, anzahl, *args)
    override fun meldung(fehler: Ergebnis.Fehler): String {
        if (fehler.message.isNotBlank()) return fehler.message
        val id = fehlerTextId(fehler)
        return errorTextArgument(fehler)?.let { text(id, it) } ?: text(id)
    }
    override fun angemeldet() = true
}
