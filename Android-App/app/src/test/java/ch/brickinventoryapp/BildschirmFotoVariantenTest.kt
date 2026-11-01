package ch.brickinventoryapp

import android.os.Looper
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetAnlegenSchritt
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.screens.FinanceScreen
import ch.brickinventoryapp.ui.screens.GalleryScreen
import ch.brickinventoryapp.ui.screens.LoginScreen
import ch.brickinventoryapp.ui.screens.MerklisteScreen
import ch.brickinventoryapp.ui.screens.SetDetailScreen
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale

/**
 * Was BildschirmFotoTest nicht abdeckt, je einmal statt im vollen Raster (die
 * Laufzeit wächst mit jedem Bild): die drei übrigen Designs, Deutsch (de-CH),
 * Schrift 130 % und 200 %, das Gerüst mit App-Leiste, Schublade und Kontomenü,
 * zwei Dialoge sowie Lade-, Fehler- und Leerzustand. Namen wie dort:
 * `<bildschirm>[-variante]_<design>_<hell|dunkel>_<gerät>.png`.
 *
 * Gegenprobe wie bei BildschirmFotoTest erst mit eingecheckten Referenzen möglich
 * (eine Farbe in Theme.kt ändern → verifyRoborazziDebug rot); ohne Android-SDK
 * hier nicht messbar.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class BildschirmFotoVariantenTest {

    @get:Rule
    val compose = createComposeRule()

    private val welt = Beispiele.Welt()
    private val bilder = coil3.ImageLoader.Builder(ApplicationProvider.getApplicationContext()).build()
    private val vorher = Locale.getDefault()

    @After
    fun zu() {
        Locale.setDefault(vorher)
        welt.close()
    }

    /** Wie BildschirmFotoTest.bereitstellen: den Hauptlooper treiben, bis der Server ruht. */
    private fun bereitstellen(name: String, bereit: () -> Boolean, zustand: () -> Any?) {
        val ende = System.nanoTime() + 10_000_000_000L
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

    private fun pfad(name: String, design: String, dunkel: Boolean, geraet: String) =
        "src/test/bildschirmfotos/${name}_${design}_${if (dunkel) "dunkel" else "hell"}_$geraet.png"

    /**
     * Zeigt [inhalt] und wartet auf die Daten; das Foto nimmt der Aufrufer, damit
     * er vorher tippen (Schublade, Dialog) oder die Uhr anhalten kann (Laden).
     */
    private fun zeige(
        name: String, design: String = "classic", dunkel: Boolean = false, geraet: String = "telefon",
        sprache: String? = null, schrift: Float = 1f, bereit: () -> Boolean = { true }, zustand: () -> Any? = { null },
        warten: Boolean = true, inhalt: @Composable () -> Unit,
    ) {
        val maske = if (geraet == "tablet") "w1280dp-h800dp-land-xhdpi" else "w411dp-h891dp-port-xxhdpi"
        RuntimeEnvironment.setQualifiers(if (sprache != null) "$sprache-$maske" else maske)
        if (sprache != null) Locale.setDefault(Locale.forLanguageTag(sprache.replace("-r", "-")))
        if (warten) bereitstellen(name, bereit, zustand)
        compose.setContent {
            BrickInventoryManagerTheme(theme = design, dunkel = dunkel) {
                val dichte = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(dichte.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        if (warten) {
            bereitstellen("$name (angezeigt)", bereit, zustand)
            compose.waitForIdle()
        }
    }

    private fun foto(name: String, design: String = "classic", dunkel: Boolean = false, geraet: String = "telefon") =
        compose.onRoot().captureRoboImage(pfad(name, design, dunkel, geraet))

    private fun erfassung() = welt.t.merke(ErfassungViewModel(welt.t.dienste, SetsRepository(welt.t.api, welt.t.cache),
        KatalogRepository(welt.t.api, welt.t.cache), object : SetAnleger {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?,
                                 ownerUserId: Int?, storage: String?): Flow<SetAnlegenSchritt> = emptyFlow()
        }))

    private fun galerieFertig(vm: ch.brickinventoryapp.ui.viewmodel.GalerieViewModel) =
        { vm.galleryState.value.let { it.sets.isNotEmpty() && it.stats != null && !it.galleryLoading } }

    private fun detailFertig(vm: ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel) = {
        vm.setDetailState.value.let { s ->
            s.setDetail != null && s.setPrice != null && s.priceHistory != null && s.acquisitions.isNotEmpty() &&
                !s.setDetailLoading && !s.setPriceLoading && !s.priceHistoryLoading && !s.acquisitionsLoading }
    }

    @Composable
    private fun Galerie(vm: ch.brickinventoryapp.ui.viewmodel.GalerieViewModel) =
        GalleryScreen(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})

    @Composable
    private fun Detail(vm: ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel) =
        SetDetailScreen(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})

    private fun galerieFoto(name: String, design: String = "classic", dunkel: Boolean = false,
                            sprache: String? = null, schrift: Float = 1f) {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige(name, design, dunkel, sprache = sprache, schrift = schrift, bereit = galerieFertig(vm),
            zustand = { vm.galleryState.value }) { Galerie(vm) }
        foto(name, design, dunkel)
    }

    private fun detailFoto(name: String, design: String = "classic", dunkel: Boolean = false,
                           sprache: String? = null, schrift: Float = 1f) {
        val vm = welt.setDetail().also { it.ladeAlles() }
        zeige(name, design, dunkel, sprache = sprache, schrift = schrift, bereit = detailFertig(vm),
            zustand = { vm.setDetailState.value }) { Detail(vm) }
        foto(name, design, dunkel)
    }

    private fun anmeldenFoto(name: String, schrift: Float) {
        zeige(name, schrift = schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = AnmeldeFormular.ANMELDEN, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        foto(name)
    }

    // ── Die drei Designs, die das Raster in BildschirmFotoTest nicht trägt ──
    // Je ein Test, weil eine Compose-Regel nur einmal je Test zeichnen darf.

    @Test fun galerieFarbfaecherHell() = galerieFoto("galerie", "farbfaecher")
    @Test fun galerieFarbfaecherDunkel() = galerieFoto("galerie", "farbfaecher", dunkel = true)
    @Test fun galerieHochglanzHell() = galerieFoto("galerie", "hochglanz")
    @Test fun galerieHochglanzDunkel() = galerieFoto("galerie", "hochglanz", dunkel = true)
    @Test fun galerieWerkbank() = galerieFoto("galerie", "werkbank")
    @Test fun detailFarbfaecher() = detailFoto("set-detail", "farbfaecher")
    @Test fun detailHochglanzDunkel() = detailFoto("set-detail", "hochglanz", dunkel = true)
    @Test fun detailWerkbank() = detailFoto("set-detail", "werkbank")

    // ── Deutsch (de-CH): Texte, Zahlen, Beträge und Achsen ──

    @Test fun galerieDeutsch() = galerieFoto("galerie-de-ch", sprache = "de-rCH")
    @Test fun detailDeutsch() = detailFoto("set-detail-de-ch", sprache = "de-rCH")

    @Test
    fun finanzenDeutsch() {
        val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        zeige("finanzen-de-ch", sprache = "de-rCH", bereit = { vm.financeState.value.let { it.valuation != null &&
            it.pnl != null && it.historyPoints.isNotEmpty() && !it.valuationLoading && !it.historyLoading } },
            zustand = { vm.financeState.value }) { FinanceScreen(vm = vm, imageLoader = bilder) }
        foto("finanzen-de-ch")
    }

    // ── Grosse Schrift: 130 % und 200 % ──

    @Test fun anmeldenSchrift130() = anmeldenFoto("anmelden-schrift130", 1.3f)
    @Test fun anmeldenSchrift200() = anmeldenFoto("anmelden-schrift200", 2.0f)
    @Test fun galerieSchrift130() = galerieFoto("galerie-schrift130", schrift = 1.3f)
    @Test fun galerieSchrift200() = galerieFoto("galerie-schrift200", schrift = 2.0f)
    @Test fun detailSchrift130() = detailFoto("set-detail-schrift130", schrift = 1.3f)
    @Test fun detailSchrift200() = detailFoto("set-detail-schrift200", schrift = 2.0f)

    // ── Gerüst: App-Leiste mit Reitern, Schublade „Mehr“, Kontomenü ──

    @Composable
    private fun Geruest(galerie: ch.brickinventoryapp.ui.viewmodel.GalerieViewModel) {
        val nav = rememberNavController()
        val reiter = remember {
            listOf<Triple<Screen, @Composable () -> Unit, String>>(
                Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Collection"),
                Triple(Screen.PartsList, { Icon(Icons.AutoMirrored.Filled.ListAlt, null) }, "Parts list"),
                Triple(Screen.Finance, { Icon(Icons.AutoMirrored.Filled.ShowChart, null) }, "Finance"),
                Triple(Screen.Wanted, { Icon(Icons.Default.StarBorder, null) }, "Wanted"),
                Triple(Screen.Catalog, { Icon(Icons.AutoMirrored.Filled.MenuBook, null) }, "Catalog"),
            )
        }
        MainScaffold(
            title = "Collection", navController = nav, bottomNavItems = reiter,
            snackbarHostState = remember { SnackbarHostState() },
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, onLogout = {}, serverUrl = "", isAdmin = true, onTabAngetippt = {},
        ) {
            NavHost(nav, startDestination = Screen.Gallery.route) {
                composable(Screen.Gallery.route) { Galerie(galerie) }
            }
        }
    }

    private fun geruestFoto(geraet: String) {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest", geraet = geraet, bereit = galerieFertig(galerie), zustand = { galerie.galleryState.value }) { Geruest(galerie) }
        foto("geruest", geraet = geraet)
    }

    @Test fun geruestTelefon() = geruestFoto("telefon")
    @Test fun geruestTablet() = geruestFoto("tablet")

    @Test
    fun geruestSchublade() {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest-schublade", dunkel = true, bereit = galerieFertig(galerie), zustand = { galerie.galleryState.value }) { Geruest(galerie) }
        compose.onNodeWithContentDescription("More").performClick()
        compose.waitForIdle()
        foto("geruest-schublade", dunkel = true)
    }

    @Test
    fun geruestKontomenue() {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest-kontomenue", bereit = galerieFertig(galerie), zustand = { galerie.galleryState.value }) { Geruest(galerie) }
        compose.onNodeWithContentDescription("Account").performClick()
        compose.waitForIdle()
        // Das Menü ist ein eigenes Fenster; das Foto zeigt es allein.
        compose.onNode(androidx.compose.ui.test.isPopup()).captureRoboImage(pfad("geruest-kontomenue", "classic", false, "telefon"))
    }

    // ── Dialoge ──

    @Test
    fun dialogSetLoeschen() {
        val vm = welt.setDetail().also { it.ladeAlles() }
        zeige("dialog-set-loeschen", design = "noppe", bereit = detailFertig(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        compose.onNodeWithContentDescription("Delete").performClick()
        compose.waitForIdle()
        compose.onNode(isDialog()).captureRoboImage(pfad("dialog-set-loeschen", "noppe", false, "telefon"))
    }

    @Test
    fun dialogMerkpostenAnlegen() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("dialog-merkposten", dunkel = true, bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            MerklisteScreen(vm = vm, imageLoader = bilder, onScan = {}, onOeffnen = { _, _ -> })
        }
        compose.onNodeWithContentDescription("Add a wanted item").performClick()
        compose.waitForIdle()
        compose.onNode(isDialog()).captureRoboImage(pfad("dialog-merkposten", "classic", true, "telefon"))
    }

    // ── Laden, Fehler, leer ──

    @Test
    fun galerieLaedt() {
        // Die Antwort bleibt aus; die Uhr steht, damit die Ladeanimation ein festes Bild ergibt.
        welt.pfade.verzoegert["/api/v1/sets"] = 60_000L
        val galerie = welt.galerie().also { it.loadSets() }
        compose.mainClock.autoAdvance = false
        zeige("galerie-laedt", warten = false) { Galerie(galerie) }
        compose.mainClock.advanceTimeBy(300)
        foto("galerie-laedt")
    }

    @Test
    fun galerieFehler() {
        welt.pfade.codes["/api/v1/sets"] = 500
        val galerie = welt.galerie().also { it.loadSets() }
        zeige("galerie-fehler", bereit = { galerie.galleryState.value.let { !it.galleryLoading && it.galleryFehler != null } },
            zustand = { galerie.galleryState.value }) { Galerie(galerie) }
        foto("galerie-fehler")
    }

    @Test
    fun merklisteLeer() {
        welt.pfade.antworten["/api/v1/wanted"] = """{"success":true,"merkposten":[]}"""
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("merkliste-leer", dunkel = true, bereit = { vm.merklisteState.value.let { !it.laedt && it.fehler == null } },
            zustand = { vm.merklisteState.value }) {
            MerklisteScreen(vm = vm, imageLoader = bilder, onScan = {}, onOeffnen = { _, _ -> })
        }
        foto("merkliste-leer", dunkel = true)
    }
}
