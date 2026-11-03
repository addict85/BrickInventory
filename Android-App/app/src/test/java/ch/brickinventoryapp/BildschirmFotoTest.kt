package ch.brickinventoryapp

import android.os.Looper
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.GutscheinUiState
import ch.brickinventoryapp.ui.screens.FinanceScreen
import ch.brickinventoryapp.ui.screens.GalleryScreen
import ch.brickinventoryapp.ui.screens.GutscheineCard
import ch.brickinventoryapp.ui.screens.LoginScreen
import ch.brickinventoryapp.ui.screens.MerklisteScreen
import ch.brickinventoryapp.ui.screens.MinifigsScreen
import ch.brickinventoryapp.ui.screens.PartsScreen
import ch.brickinventoryapp.ui.screens.SetDetailScreen
import ch.brickinventoryapp.ui.screens.SetupScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Bildschirmfotos der Hauptbildschirme mit Beispieldaten (Beispiele), je in
 * drei Designs, hell und dunkel, auf Telefon und Tablet, auf Deutsch (de-CH) wie
 * die meisten Nutzer; Englisch fotografiert BildschirmFotoVariantenTest. Liegen Referenzbilder
 * in src/test/bildschirmfotos, vergleicht die CI gegen sie (verifyRoborazziDebug),
 * sonst nimmt sie auf; eingecheckt werden sie per Workflow (bildschirmfotos=true).
 *
 * Die Gutscheine stehen als eigene Seite unter „Mehr“; fotografiert wird ihr
 * Baustein (GutscheineCard), weil die Seite ihr ViewModel über Hilt holt.
 *
 * Gegenprobe: Ein Foto, das nichts vergleicht, kann nicht rot werden. Sie ist
 * erst mit eingecheckten Referenzen möglich (eine Farbe in Theme.kt ändern →
 * verifyRoborazziDebug rot) und hier ohne Android-SDK nicht messbar; bis dahin
 * prüft BeispieldatenTest, dass die Bilder Inhalt zeigen.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class BildschirmFotoTest(private val design: String, private val dunkel: Boolean, private val geraet: String) {

    companion object {
        private val GERAETE = mapOf(
            "telefon" to "w411dp-h891dp-port-xxhdpi",
            "tablet" to "w1280dp-h800dp-land-xhdpi",
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}-{2}")
        fun faelle(): List<Array<Any>> =
            listOf("classic", "brick", "noppe").flatMap { d ->
                listOf(false, true).flatMap { dk -> GERAETE.keys.map { g -> arrayOf<Any>(d, dk, g) } }
            }
    }

    @get:Rule
    val compose = createComposeRule()

    private val welt = Beispiele.Welt(KontextTexte())
    private val bilder = Beispielbilder.loader(ApplicationProvider.getApplicationContext())
    private val vorher = java.util.Locale.getDefault()

    @After
    fun zu() {
        java.util.Locale.setDefault(vorher)
        welt.close()
    }

    /**
     * Die Daten kommen vor dem Bildschirm. Ihre Abrufe kehren über den
     * Hauptlooper zurück; den treibt diese Schleife selbst. Hinge er stattdessen
     * an compose.waitUntil, läuft er nur so oft, wie die Testuhr Bilder zeichnet
     * — und solange geladen wird, zeichnet sie Ladeanimationen ohne Ende.
     */
    private fun bereitstellen(name: String, bereit: () -> Boolean, zustand: () -> Any?) {
        val ende = System.nanoTime() + 10_000_000_000L
        // Bereit allein genügt nicht: Ein Bildschirm lädt oft noch Beiwerk nach
        // (Kennzahlen, Bewertungen). Erst wenn der Testserver eine Weile keine
        // neue Anfrage sah und der Looper ihre Antworten verarbeitet hat.
        var anfragen = welt.pfade.anfragen.size
        var ruhigSeit = System.nanoTime()
        while (!bereit() || System.nanoTime() - ruhigSeit < 500_000_000L) {
            if (System.nanoTime() > ende) throw AssertionError("$name: Daten nach 10 s nicht da: ${zustand()}")
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
            val jetzt = welt.pfade.anfragen.size
            if (jetzt != anfragen) { anfragen = jetzt; ruhigSeit = System.nanoTime() }
        }
    }

    private fun foto(name: String, bereit: () -> Boolean = { true }, zustand: () -> Any? = { null },
                     inhalt: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("de-rCH-" + GERAETE.getValue(geraet))
        java.util.Locale.setDefault(java.util.Locale.forLanguageTag("de-CH"))
        bereitstellen(name, bereit, zustand)
        compose.setContent {
            BrickInventoryManagerTheme(theme = design, dunkel = dunkel) {
                Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
            }
        }
        // Der Bildschirm lädt beim Erscheinen teils nach (etwa die Käufe). Auch
        // diese Antworten kommen über den Hauptlooper, also wieder selbst treiben.
        bereitstellen("$name (angezeigt)", bereit, zustand)
        compose.waitForIdle()
        val hell = if (dunkel) "dunkel" else "hell"
        compose.onRoot().captureRoboImage("src/test/bildschirmfotos/${name}_${design}_${hell}_$geraet.png")
    }

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.dienste, SetsRepository(welt.t.api, welt.t.cache),
        KatalogRepository(welt.t.api, welt.t.cache), object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    @Test
    fun galerie() {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        foto("galerie", { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.galleryLoading } }, { vm.galleryState.value }) {
            GalleryScreen(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
    }

    @Test
    fun setDetail() {
        val vm = welt.setDetail().also { it.ladeAlles() }
        // Alle Abschnitte, nicht nur das Set: Preis, Verlauf und Käufe kommen
        // in eigenen Abrufen, und ein Foto mitten im Laden weicht vom Referenzbild ab.
        val fertig = { vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.setDetailLoading && !s.setPriceLoading && !s.priceHistoryLoading && !s.acquisitionsLoading } }
        foto("set-detail", fertig, { vm.setDetailState.value }) {
            SetDetailScreen(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder,
                onBack = {}, onDelete = {})
        }
    }

    @Test
    fun teile() {
        val vm = welt.teile().also { it.loadParts() }
        foto("teile", { vm.partsState.value.parts.isNotEmpty() }, { vm.partsState.value }) {
            PartsScreen(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun figuren() {
        val vm = welt.teile().also { it.loadMinifigs() }
        foto("figuren", { vm.partsState.value.minifigs.isNotEmpty() }, { vm.partsState.value }) {
            MinifigsScreen(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun finanzen() {
        val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        // Teile, Figuren und G&V lädt loadValuation() erst nach der Bewertung nach.
        foto("finanzen", { vm.financeState.value.let { it.valuation != null && it.partsValuation != null &&
            it.figsValuation != null && it.pnl != null && it.historyPoints.isNotEmpty() &&
            !it.valuationLoading && !it.historyLoading } }, { vm.financeState.value }) {
            FinanceScreen(vm = vm, imageLoader = bilder)
        }
    }

    @Test
    fun merkliste() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        foto("merkliste", { vm.merklisteState.value.merkposten.isNotEmpty() }, { vm.merklisteState.value }) {
            MerklisteScreen(vm = vm, imageLoader = bilder, onScan = {}, onOeffnen = { _, _ -> })
        }
    }

    @Test
    fun anmelden() {
        foto("anmelden") {
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
        foto("einrichten") { SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, entwicklung = false) }
    }

    /** Eine gespeicherte http-Adresse aus einer älteren Fassung: oben die Anleitung zu https. */
    @Test
    fun einrichtenAltbestand() {
        foto("einrichten-altbestand") { SetupScreen(currentUrl = "http://nas:3000", onSave = {}, entwicklung = false) }
    }

    @Test
    fun gutscheine() {
        foto("gutscheine") { Gutscheine() }
    }
}

/** Zwei Gutscheine, einer mit PIN und Guthabenstand, einer ohne — die beiden Zeilenformen. */
@Composable
internal fun Gutscheine() {
    val gutscheine = GutscheinUiState(gutscheine = listOf(
        Gutschein(id = 1, number = "6061 2345 6789", pin = "4711", amount = 50.0, currency = "CHF").alsAnsicht(),
        Gutschein(id = 2, number = "6061 9876 5432", amount = 20.0, currency = "CHF").alsAnsicht()))
    androidx.compose.foundation.layout.Column {
        GutscheineCard(
            zustand = gutscheine, onFeld = { _, _, _, _ -> }, onPinSchalten = {}, onBearbeiten = {},
            onAbbrechen = {}, onSpeichern = {}, onLoeschen = {}, onPdfOeffnen = {}, onKopieren = { _, _ -> },
            onGuthaben = {}, onExportieren = {}, onGuthabenAlle = {}, onGuthabenAbbrechen = {}, onErneut = {},
            onBestaetigen = { _, _ -> }, onBestaetigungAbbrechen = {},
        )
    }
}

/**
 * Texte der ViewModels aus den echten Ressourcen, damit ein Foto „Serverfehler (500)“
 * zeigt statt des Platzhalters „fehler“ der JVM-Tests (NummernTexte).
 */
internal class KontextTexte(
    private val ctx: android.content.Context = ApplicationProvider.getApplicationContext(),
) : ch.brickinventoryapp.ui.viewmodel.Texte {
    override fun text(id: Int, vararg args: Any?): String =
        if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
    override fun menge(id: Int, anzahl: Int, vararg args: Any?): String =
        ctx.resources.getQuantityString(id, anzahl, *args)
    override fun meldung(fehler: ch.brickinventoryapp.data.repository.Result.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        val id = ch.brickinventoryapp.ui.fehlerTextId(fehler.art)
        return if (ch.brickinventoryapp.ui.fehlerTextBrauchtCode(fehler.art)) text(id, fehler.httpCode ?: 0) else text(id)
    }
    override fun angemeldet() = true
}
