package ch.brickinventoryapp

import android.os.Looper
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ShowChart
import androidx.compose.material.icons.filled.BookmarkBorder
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
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.compose.runtime.getValue
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
import ch.brickinventoryapp.ui.screens.MinifigsScreen
import ch.brickinventoryapp.ui.screens.PartsScreen
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
 * Laufzeit wächst mit jedem Bild): die drei übrigen Designs, Englisch (en-GB),
 * Schrift 130 % und 200 %, das Gerüst mit App-Leiste und der Seite „Mehr“,
 * Dialoge, Lade-, Fehler- und Leerzustand, das Detail mit vierstelligen Beträgen
 * auf 360 dp, Liste und Detail auf dem Tablet sowie die Unterseiten Lagerorte,
 * Haushalt, CSV-Import und die Bauliste. Wie dort auf Deutsch (de-CH),
 * wo nicht `-en` im Namen steht. Namen wie dort:
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

    private companion object {
        const val DEUTSCH = "de-rCH"
        const val ENGLISCH = "en-rGB"
    }

    @get:Rule
    val compose = createComposeRule()

    private val welt = Beispiele.Welt(KontextTexte())
    private val bilder = Beispielbilder.loader(ApplicationProvider.getApplicationContext())
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
     * er vorher tippen (Mehr, Dialog) oder die Uhr anhalten kann (Laden).
     */
    private fun zeige(
        name: String, design: String = "classic", dunkel: Boolean = false, geraet: String = "telefon",
        sprache: String? = DEUTSCH, schrift: Float = 1f, bereit: () -> Boolean = { true }, zustand: () -> Any? = { null },
        warten: Boolean = true, inhalt: @Composable () -> Unit,
    ) {
        val maske = when (geraet) {
            "tablet" -> "w1280dp-h800dp-land-xhdpi"
            "schmal" -> "w360dp-h740dp-port-xxhdpi"
            else -> "w411dp-h891dp-port-xxhdpi"
        }
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

    /**
     * Uhr anhalten und in festen Schritten vorstellen: Das Bild hängt dann nicht davon
     * ab, wie weit eine Animation (Ladekreis, Einblenden, Rückzug des Zieh-Indikators)
     * beim Auslösen gerade war. galerie-fehler wich zwischen Aufnahme und Prüfung ab.
     */
    private fun anhalten() {
        compose.mainClock.autoAdvance = false
        repeat(20) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
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
                            sprache: String? = DEUTSCH, schrift: Float = 1f) {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige(name, design, dunkel, sprache = sprache, schrift = schrift, bereit = galerieFertig(vm),
            zustand = { vm.galleryState.value }) { Galerie(vm) }
        foto(name, design, dunkel)
    }

    private fun detailFoto(name: String, design: String = "classic", dunkel: Boolean = false,
                           sprache: String? = DEUTSCH, schrift: Float = 1f) {
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

    // ── Vierstellige Beträge auf schmalem Telefon (360 dp) ──
    // Ein Kaufpreis über CHF 1’000 in den Wert-Kacheln: Dort brach „CHF 700.0 / 0“
    // um, und mit vier Stellen wurde es nur enger.

    private fun detailTeuerFoto(name: String, schrift: Float) {
        welt.pfade.antworten["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":1249.9,"min_price":1180.0,"max_price":1320.0,"qty_avg_price":1249.9}"""
        welt.pfade.antworten["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        val vm = welt.setDetail().also { it.ladeAlles() }
        zeige(name, geraet = "schmal", schrift = schrift, bereit = detailFertig(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        anhalten()
        foto(name, geraet = "schmal")
    }

    @Test fun detailVierstelligSchmal() = detailTeuerFoto("set-detail-vierstellig", 1f)
    @Test fun detailVierstelligSchmalSchrift200() = detailTeuerFoto("set-detail-vierstellig-schrift200", 2f)

    // ── Englisch (en-GB): Texte, Zahlen, Beträge und Achsen ──

    @Test fun galerieEnglisch() = galerieFoto("galerie-en", sprache = ENGLISCH)
    @Test fun detailEnglisch() = detailFoto("set-detail-en", sprache = ENGLISCH)

    @Test
    fun finanzenEnglisch() = finanzenFoto("finanzen-en", sprache = ENGLISCH)

    private fun finanzenFoto(name: String, sprache: String? = DEUTSCH, schrift: Float = 1f) {
        val vm = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        zeige(name, sprache = sprache, schrift = schrift, bereit = { vm.financeState.value.let { it.valuation != null &&
            it.pnl != null && it.historyPoints.isNotEmpty() && !it.valuationLoading && !it.historyLoading } },
            zustand = { vm.financeState.value }) { FinanceScreen(vm = vm, imageLoader = bilder) }
        foto(name)
    }

    // ── Grosse Schrift: 130 % und 200 % ──

    @Test fun anmeldenSchrift130() = anmeldenFoto("anmelden-schrift130", 1.3f)
    @Test fun anmeldenSchrift200() = anmeldenFoto("anmelden-schrift200", 2.0f)
    @Test fun galerieSchrift130() = galerieFoto("galerie-schrift130", schrift = 1.3f)
    @Test fun galerieSchrift200() = galerieFoto("galerie-schrift200", schrift = 2.0f)
    @Test fun detailSchrift130() = detailFoto("set-detail-schrift130", schrift = 1.3f)
    @Test fun detailSchrift200() = detailFoto("set-detail-schrift200", schrift = 2.0f)
    @Test fun finanzenSchrift200() = finanzenFoto("finanzen-schrift200", schrift = 2.0f)

    @Test
    fun merklisteSchrift200() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("merkliste-schrift200", schrift = 2.0f, bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            MerklisteScreen(vm = vm, imageLoader = bilder, onScan = {}, onOeffnen = { _, _ -> })
        }
        foto("merkliste-schrift200")
    }

    @Test
    fun teileSchrift200() {
        val vm = welt.teile().also { it.loadParts() }
        zeige("teile-schrift200", schrift = 2.0f, bereit = { vm.partsState.value.parts.isNotEmpty() },
            zustand = { vm.partsState.value }) { PartsScreen(vm = vm, imageLoader = bilder) }
        foto("teile-schrift200")
    }

    /** Das Figurenraster wächst mit der Schrift (LesbareSpalten): lange Namen ganz lesbar. */
    @Test
    fun figurenSchrift200() {
        val vm = welt.teile().also { it.loadMinifigs() }
        zeige("figuren-schrift200", schrift = 2.0f, bereit = { vm.partsState.value.minifigs.isNotEmpty() },
            zustand = { vm.partsState.value }) { MinifigsScreen(vm = vm, imageLoader = bilder) }
        foto("figuren-schrift200")
    }

    @Test
    fun gutscheineSchrift200() {
        zeige("gutscheine-schrift200", schrift = 2.0f) { Gutscheine() }
        foto("gutscheine-schrift200")
    }

    // ── Gerüst: App-Leiste mit vier Bestandszielen und „Mehr“ ──

    @Composable
    private fun Geruest(galerie: ch.brickinventoryapp.ui.viewmodel.GalerieViewModel) {
        val nav = rememberNavController()
        val reiter = remember {
            listOf<Triple<Screen, @Composable () -> Unit, String>>(
                Triple(Screen.Gallery, { Icon(Icons.Default.ViewInAr, null) }, "Sammlung"),
                Triple(Screen.Finance, { Icon(Icons.AutoMirrored.Filled.ShowChart, null) }, "Finanzen"),
                Triple(Screen.Wanted, { Icon(Icons.Default.BookmarkBorder, null) }, "Merkliste"),
                Triple(Screen.Catalog, { Icon(Icons.AutoMirrored.Filled.MenuBook, null) }, "Katalog"),
                Triple(Screen.Mehr, { Icon(Icons.Default.MoreHoriz, null) }, "Mehr"),
            )
        }
        // Der Titel folgt dem Ziel wie in der App (ToolsGraph setzt nav_more): Fest
        // „Sammlung“ zeigte das Foto von „Mehr“ mit dem falschen Titel.
        val ziel by nav.currentBackStackEntryAsState()
        val titel = if (ziel?.destination?.route == Screen.Mehr.route) "Mehr" else "Sammlung"
        MainScaffold(
            title = titel, navController = nav, bottomNavItems = reiter,
            snackbarHostState = remember { SnackbarHostState() },
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, serverUrl = "", updateVerfuegbar = true, onTabAngetippt = {},
        ) {
            NavHost(nav, startDestination = Screen.Gallery.route) {
                composable(Screen.Gallery.route) { Galerie(galerie) }
                composable(Screen.Mehr.route) {
                    MehrBildschirm(navController = nav, isAdmin = true, updateVerfuegbar = true, onAbmelden = {})
                }
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

    /** Der Umschalter Sets | Teile | Minifiguren bei 200 %: als Chips, kein Wort gebrochen. */
    @Test
    fun geruestSchrift200() {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("geruest-schrift200", schrift = 2.0f, bereit = galerieFertig(galerie),
            zustand = { galerie.galleryState.value }) { Geruest(galerie) }
        anhalten()
        foto("geruest-schrift200")
    }

    /** Die Seite „Mehr“: alle übrigen Ziele gruppiert, mit dem Punkt für eine neue Version. */
    private fun mehrFoto(geraet: String, dunkel: Boolean) {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("mehr", dunkel = dunkel, geraet = geraet, bereit = galerieFertig(galerie), zustand = { galerie.galleryState.value }) { Geruest(galerie) }
        compose.onNodeWithText("Mehr").performClick()
        compose.waitForIdle()
        foto("mehr", dunkel = dunkel, geraet = geraet)
    }

    @Test fun mehrTelefon() = mehrFoto("telefon", dunkel = true)
    @Test fun mehrTablet() = mehrFoto("tablet", dunkel = false)

    // ── Dialoge ──

    @Test
    fun dialogSetLoeschen() {
        val vm = welt.setDetail().also { it.ladeAlles() }
        zeige("dialog-set-loeschen", design = "noppe", bereit = detailFertig(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        compose.onNodeWithContentDescription("Millennium Falcon löschen").performClick()
        compose.waitForIdle()
        compose.onNode(isDialog()).captureRoboImage(pfad("dialog-set-loeschen", "noppe", false, "telefon"))
    }

    /** Die Rückfrage vor dem Abmelden — dieselbe Bauform wie beim Löschen eines Sets. */
    @Test
    fun dialogAbmelden() {
        zeige("dialog-abmelden", dunkel = true) {
            MehrBildschirm(rememberNavController(), isAdmin = false, updateVerfuegbar = true, onAbmelden = {})
        }
        compose.onNodeWithText("Abmelden").performClick()
        compose.waitForIdle()
        compose.onNode(isDialog()).captureRoboImage(pfad("dialog-abmelden", "classic", true, "telefon"))
    }

    @Test
    fun dialogMerkpostenAnlegen() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("dialog-merkposten", dunkel = true, bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            MerklisteScreen(vm = vm, imageLoader = bilder, onScan = {}, onOeffnen = { _, _ -> })
        }
        // Der Dialog fokussiert sein erstes Feld; der blinkende Cursor lässt
        // Compose nie ruhig werden. Darum die Uhr anhalten und gezielt vorstellen.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Merkposten hinzufügen").performClick()
        // Das Dialogfenster entsteht über den Hauptlooper, nicht über die Compose-Uhr.
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        compose.onNode(isDialog()).captureRoboImage(pfad("dialog-merkposten", "classic", true, "telefon"))
    }

    // ── Liste und Detail nebeneinander (Tablet) ──

    @Test
    fun merklisteMitDetailTablet() {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("merkliste-detail", geraet = "tablet", bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            ch.brickinventoryapp.ui.screens.MerklisteUndDetail(vm = vm, imageLoader = bilder, nebeneinander = true,
                onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        compose.onNode(androidx.compose.ui.test.hasText("Titanic", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        bereitstellen("merkliste-detail (offen)", { true }, { vm.merklisteState.value })
        compose.waitForIdle()
        anhalten()
        foto("merkliste-detail", geraet = "tablet")
    }

    // ── Unterseiten und Erfassen, die sonst kein Foto hatten (I2) ──

    private fun einstellungen() = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel(welt.t.dienste,
        ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.VerwaltungRepository(welt.t.api, welt.t.cache),
        SetsRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.TeileRepository(welt.t.api, welt.t.cache),
        object : ch.brickinventoryapp.ui.viewmodel.DateiLeser {
            override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null
        }))

    @Test
    fun lagerorte() {
        welt.pfade.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"},{"id":5,"name":"Regal Wohnzimmer"}]}"""
        // Vor dem Zeigen laden: zeige() wartet schon vor setContent auf die Daten, und
        // ohne Aufruf hier fragte erst der Bildschirm selbst.
        val vm = einstellungen().also { it.ladeEigeneLagerorte() }
        zeige("lagerorte", bereit = { vm.lagerState.value.eigene.size == 3 }, zustand = { vm.lagerState.value }) {
            ch.brickinventoryapp.ui.screens.LagerorteUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        anhalten()
        foto("lagerorte")
    }

    @Test
    fun csvImport() {
        val vm = einstellungen()
        zeige("csv-import") {
            ch.brickinventoryapp.ui.screens.CsvImportUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        anhalten()
        foto("csv-import")
    }

    @Test
    fun haushalt() {
        welt.pfade.antworten["/api/v1/settings/household"] = """{"success":true,"is_main":true,"currency":"CHF",
            "sub_accounts":[{"id":2,"username":"lena"},{"id":3,"username":"tim"}],"open_invites":1}"""
        val vm = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel(welt.t.dienste,
            ch.brickinventoryapp.data.repository.HaushaltRepository(welt.t.api, welt.t.cache),
            ch.brickinventoryapp.data.repository.KontoRepository(welt.t.api, welt.t.cache))).also { it.loadHouseholdStatus() }
        zeige("haushalt", bereit = { vm.householdState.value.status != null }, zustand = { vm.householdState.value }) {
            ch.brickinventoryapp.ui.screens.HaushaltUnterseite(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        anhalten()
        foto("haushalt")
    }

    @Test
    fun bauliste() {
        zeige("bauliste") {
            ch.brickinventoryapp.ui.screens.PartsListScreen(serverUrl = "", imageLoader = bilder, onScanBarcode = {},
                onResolveSet = { error("im Foto wird nichts aufgelöst") })
        }
        anhalten()
        foto("bauliste")
    }

    /** Erfassen: der Dialog der Galerie mit Nummer, Menge, Preis, Zustand und Lagerort. */
    @Test fun dialogSetErfassen() = dialogSetErfassenFoto("dialog-set-erfassen", 1f)

    /** Bei 200 % stehen Zustand und Lagerort als Chips bzw. volle Zeile da, nichts bricht im Wort. */
    @Test fun dialogSetErfassenSchrift200() = dialogSetErfassenFoto("dialog-set-erfassen-schrift200", 2f)

    private fun dialogSetErfassenFoto(name: String, schrift: Float) {
        // Der Dialog fokussiert sein erstes Feld, der Cursor blinkt ohne Ende. setContent wartet
        // auf Ruhe, darum geht er erst danach auf (wie der Merkposten-Dialog per Klick).
        val offen = androidx.compose.runtime.mutableStateOf(false)
        zeige(name, schrift = schrift, warten = false) {
            if (offen.value) ch.brickinventoryapp.ui.screens.AddSetDialog(onDismiss = {},
                onAdd = { _, _, _, _, _, _ -> }, lagerorte = listOf("Keller", "Estrich"))
        }
        compose.mainClock.autoAdvance = false
        offen.value = true
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        compose.onNode(isDialog()).captureRoboImage(pfad(name, "classic", false, "telefon"))
        if (schrift == 1f) {
            // Ein Muster für alle Erfassungen: Der Lagerort ist so breit wie die Set-Nummer.
            val ctx = androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
            fun breite(label: Int) = compose.onNode(androidx.compose.ui.test.hasSetTextAction() and
                androidx.compose.ui.test.hasText(ctx.getString(label))).fetchSemanticsNode().boundsInRoot.width
            org.junit.Assert.assertEquals("Lagerort so breit wie die Set-Nummer",
                breite(ch.brickinventoryapp.ressourcen.R.string.gallery_set_number),
                breite(ch.brickinventoryapp.ressourcen.R.string.detail_storage), 1f)
        }
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
        anhalten()
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
