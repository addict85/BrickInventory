package ch.brickinventoryapp

import androidx.navigation.NavDestination.Companion.hasRoute
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
import androidx.compose.ui.semantics.getOrNull
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.AnmeldeFormular
import ch.brickinventoryapp.ui.CsvImportUiState
import ch.brickinventoryapp.ui.Screen
import ch.brickinventoryapp.ui.screens.FinanceRoute
import ch.brickinventoryapp.ui.screens.GalleryRoute
import ch.brickinventoryapp.ui.screens.LoginScreen
import ch.brickinventoryapp.ui.screens.MerklisteRoute
import ch.brickinventoryapp.ui.screens.MinifigsRoute
import ch.brickinventoryapp.ui.screens.PartsRoute
import ch.brickinventoryapp.ui.screens.SetDetailRoute
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
 * `<bildschirm>[-variante]_<design>_<hell|dunkel>_<gerät>.png`; Gerät `quer` ist das
 * Telefon im Querformat. Dazu der Katalog als Liste, leere und gescheiterte Reiter,
 * Tablet mit 200 % und die Anmeldung quer und bei 200 %.
 *
 * Gegenprobe wie bei BildschirmFotoTest erst mit eingecheckten Referenzen möglich
 * (eine Farbe in Theme.kt ändern → verifyRoborazziDebug rot); ohne Android-SDK
 * hier nicht messbar. Die Dialoge bei 200 % prüfen dazu, dass die Schrift im
 * Dialogfenster ankommt — Gegenprobe dialog-schrift-nur-lokal: ohne
 * setFontScale → rot „dialogSetErfassenSchrift200“ (Schrift erreicht den Dialog nicht).
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

    // Werkbank ist ein dunkles Design ohne helle Fassung; „hell“ im Namen führte in die Irre.
    private fun pfad(name: String, design: String, dunkel: Boolean, geraet: String) =
        "src/test/bildschirmfotos/${name}_${design}_${if (dunkel || design == "werkbank") "dunkel" else "hell"}_$geraet.png"

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
            "quer" -> "w891dp-h411dp-land-xxhdpi"
            else -> "w411dp-h891dp-port-xxhdpi"
        }
        RuntimeEnvironment.setQualifiers(if (sprache != null) "$sprache-$maske" else maske)
        // Die Schrift auch in der Konfiguration: Ein Dialog hat sein eigenes Fenster und
        // nimmt die Dichte von dort, LocalDensity unten reicht nicht hinein (M2).
        if (schrift != 1f) RuntimeEnvironment.setFontScale(schrift)
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
        GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})

    @Composable
    private fun Detail(vm: ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel) =
        SetDetailRoute(setNumber = Beispiele.SET, vm = vm, serverUrl = "", imageLoader = bilder, onBack = {}, onDelete = {})

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

    // Alle Zahlen eines Sets passen zusammen: Marktpreis 1’249.90, Kaufpreis 1’049.00,
    // also +19.2 %. Vorher stand neben dem teuren Marktpreis noch Kaufpreis 700 und +16.1 %.
    private fun detailTeuerFoto(name: String, schrift: Float) {
        welt.pfade.antworten["/api/v1/sets/75192-1/price"] =
            """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":1249.9,"min_price":1180.0,"max_price":1320.0,"qty_avg_price":1249.9}"""
        welt.pfade.antworten["/api/v1/sets/75192-1/acquisitions"] = """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":1049.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}"""
        welt.pfade.antworten["/api/v1/sets/75192-1"] = """{"success":true,"quantity":1,"set":{"set_number":"75192-1",
            "image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,
            "num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":1049.0}}"""
        welt.pfade.antworten["/api/v1/sets/75192-1/price-history"] = """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":1249.9,"purchase_price":1049.0,"pnl_pct":19.2}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":1210.0},{"x":"2026-09-01","y":1231.0},{"x":"2026-10-01","y":1249.9}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]},
            "pnl_prozent":19.2,"purchase_price":1049.0}"""
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
            zustand = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = bilder) }
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
            MerklisteRoute(vm = vm, imageLoader = bilder, onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        foto("merkliste-schrift200")
    }

    @Test
    fun teileSchrift200() {
        val vm = welt.teile().also { it.loadParts() }
        zeige("teile-schrift200", schrift = 2.0f, bereit = { vm.partsState.value.parts.isNotEmpty() },
            zustand = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        foto("teile-schrift200")
    }

    /** Das Figurenraster wächst mit der Schrift (LesbareSpalten): lange Namen ganz lesbar. */
    @Test
    fun figurenSchrift200() {
        val vm = welt.teile().also { it.loadMinifigs() }
        zeige("figuren-schrift200", schrift = 2.0f, bereit = { vm.partsState.value.minifigs.isNotEmpty() },
            zustand = { vm.partsState.value }) { MinifigsRoute(vm = vm, imageLoader = bilder) }
        foto("figuren-schrift200")
    }

    @Test
    fun gutscheineSchrift200() {
        zeige("gutscheine-schrift200", schrift = 2.0f) { Gutscheine() }
        foto("gutscheine-schrift200")
    }

    // ── Gerüst: App-Leiste mit vier Bestandszielen und „Mehr“ ──

    @Composable
    private fun Geruest(
        galerie: ch.brickinventoryapp.ui.viewmodel.GalerieViewModel,
        snackbar: SnackbarHostState = remember { SnackbarHostState() },
        offeneAenderungen: Int = 0,
        offlineStand: Long? = null,
    ) {
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
        val titel = if (ziel?.destination?.hasRoute<Screen.Mehr>() == true) "Mehr" else "Sammlung"
        MainScaffold(
            title = titel, navController = nav, bottomNavItems = reiter,
            snackbarHostState = snackbar,
            csvImportState = remember { MutableStateFlow(CsvImportUiState()) },
            onCsvAbbrechen = {}, serverUrl = "", updateVerfuegbar = true, onTabAngetippt = {},
            offeneAenderungen = offeneAenderungen,
        ) {
            NavHost(nav, startDestination = Screen.Gallery) {
                composable<Screen.Gallery> {
                    androidx.compose.foundation.layout.Column {
                        ch.brickinventoryapp.ui.components.OfflineHinweis(offlineStand)
                        Galerie(galerie)
                    }
                }
                composable<Screen.Mehr> {
                    MehrBildschirm(onZiel = nav::oeffneVonMehr, isAdmin = true, updateVerfuegbar = true, onAbmelden = {})
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

    /**
     * Fotografiert den offenen Dialog. Bei grosser Schrift prüft es vorher, dass sie
     * im Dialogfenster ankommt: Mit LocalDensity allein war das 200-%-Foto
     * byte-gleich mit dem 100-%-Foto und bewies nichts.
     */
    private fun dialogFoto(name: String, design: String, dunkel: Boolean, geraet: String, schrift: Float) {
        if (schrift == 1f) {
            compose.onNode(isDialog()).captureRoboImage(pfad(name, design, dunkel, geraet))
            return
        }
        // Ein Material-Textfeld im Dialogfenster kommt unter Robolectric ab 130 % Schrift
        // nie zur Ruhe (auch mit Android 13; im Hauptfenster schon). Darum hier am Fenster
        // selbst messen und fotografieren statt über die Synchronisierung von Compose.
        val looper = shadowOf(Looper.getMainLooper())
        repeat(10) { compose.mainClock.advanceTimeBy(50); looper.idle() }
        val fenster = org.robolectric.shadows.ShadowDialog.getLatestDialog().window!!.decorView
        val wurzel = composeWurzel(fenster) ?: error("$name: kein Compose im Dialogfenster")
        val skalen = mutableListOf<Float>()
        fun sammle(n: androidx.compose.ui.semantics.SemanticsNode) {
            val ergebnis = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            n.config.getOrNull(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
            ergebnis.firstOrNull()?.layoutInput?.density?.fontScale?.let { skalen += it }
            n.children.forEach { sammle(it) }
        }
        sammle(wurzel.semanticsOwner.unmergedRootSemanticsNode)
        org.junit.Assert.assertTrue("$name: Schrift erreicht den Dialog nicht (Skalen $skalen)",
            skalen.isNotEmpty() && skalen.all { it >= schrift - 0.05f })
        // Selbst gezeichnet: captureRoboImage(View) sucht die Ansicht über Espresso in der
        // Activity und findet das Dialogfenster dort nicht.
        val bild = android.graphics.Bitmap.createBitmap(fenster.width, fenster.height, android.graphics.Bitmap.Config.ARGB_8888)
        fenster.draw(android.graphics.Canvas(bild))
        bild.captureRoboImage(pfad(name, design, dunkel, geraet))
    }

    /** Die Compose-Wurzel in einem Fensterbaum, ohne auf Ruhe zu warten. */
    private fun composeWurzel(v: android.view.View): androidx.compose.ui.platform.ViewRootForTest? = when (v) {
        is androidx.compose.ui.platform.ViewRootForTest -> v
        is android.view.ViewGroup -> (0 until v.childCount).firstNotNullOfOrNull { composeWurzel(v.getChildAt(it)) }
        else -> null
    }

    private fun dialogSetLoeschenFoto(name: String, schrift: Float) {
        val vm = welt.setDetail().also { it.ladeAlles() }
        zeige(name, design = "noppe", schrift = schrift, bereit = detailFertig(vm), zustand = { vm.setDetailState.value }) { Detail(vm) }
        compose.onNodeWithContentDescription("Millennium Falcon löschen").performClick()
        compose.waitForIdle()
        dialogFoto(name, "noppe", false, "telefon", schrift)
    }

    @Test fun dialogSetLoeschen() = dialogSetLoeschenFoto("dialog-set-loeschen", 1f)
    @Test fun dialogSetLoeschenSchrift200() = dialogSetLoeschenFoto("dialog-set-loeschen-schrift200", 2f)

    /** Die Rückfrage vor dem Abmelden — dieselbe Bauform wie beim Löschen eines Sets. */
    private fun dialogAbmeldenFoto(name: String, dunkel: Boolean, geraet: String, schrift: Float) {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            MehrBildschirm({}, isAdmin = false, updateVerfuegbar = true, onAbmelden = {})
        }
        compose.onNodeWithText("Abmelden").performClick()
        compose.waitForIdle()
        dialogFoto(name, "classic", dunkel, geraet, schrift)
    }

    @Test fun dialogAbmelden() = dialogAbmeldenFoto("dialog-abmelden", true, "telefon", 1f)
    @Test fun dialogAbmeldenSchrift200() = dialogAbmeldenFoto("dialog-abmelden-schrift200", false, "telefon", 2f)
    @Test fun dialogAbmeldenTablet() = dialogAbmeldenFoto("dialog-abmelden", false, "tablet", 1f)

    private fun dialogMerkpostenFoto(name: String, dunkel: Boolean, schrift: Float) {
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige(name, dunkel = dunkel, schrift = schrift, bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            MerklisteRoute(vm = vm, imageLoader = bilder, onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        // Der Dialog fokussiert sein erstes Feld; der blinkende Cursor lässt
        // Compose nie ruhig werden. Darum die Uhr anhalten und gezielt vorstellen.
        compose.mainClock.autoAdvance = false
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        compose.onNodeWithContentDescription(ctx.getString(ch.brickinventoryapp.ressourcen.R.string.wanted_add_title)).performClick()
        // Das Dialogfenster entsteht über den Hauptlooper, nicht über die Compose-Uhr.
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        dialogFoto(name, "classic", dunkel, "telefon", schrift)
    }

    @Test fun dialogMerkpostenAnlegen() = dialogMerkpostenFoto("dialog-merkposten", true, 1f)
    @Test fun dialogMerkpostenSchrift200() = dialogMerkpostenFoto("dialog-merkposten-schrift200", false, 2f)

    // ── Liste und Detail nebeneinander (Tablet) ──

    @Test
    fun merklisteMitDetailTablet() {
        // Das Detail zeigt denselben Preis wie die Zeile daneben (449.95), statt „wird geladen“.
        welt.pfade.antworten["/api/v1/wanted/10294-1/preise"] = """{"success":true,"currency":"CHF",
            "current":{"N":{"condition":"N","avg_price":449.95,"min_price":420.0,"max_price":480.0}}}"""
        welt.pfade.antworten["/api/v1/catalog/sets/10294-1"] = """{"success":true,"set":{"set_number":"10294-1",
            "name":"Titanic","year":2021,"theme_name":"Icons","num_parts":9090,"image_local":"/beispiel/set2.png","minifigs":0}}"""
        welt.pfade.antworten["/api/v1/sets/10294-1/price-history"] = """{"success":true,"set_number":"10294-1","currency":"CHF",
            "by_condition":{"N":{"market_price":449.95}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":431.0},{"x":"2026-09-01","y":440.0},{"x":"2026-10-01","y":449.95}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]}}"""
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("merkliste-detail", geraet = "tablet", bereit = { vm.merklisteState.value.merkposten.isNotEmpty() },
            zustand = { vm.merklisteState.value }) {
            ch.brickinventoryapp.ui.screens.MerklisteRoute(vm = vm, imageLoader = bilder, nebeneinander = true,
                onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        compose.onNode(androidx.compose.ui.test.hasText("Titanic", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        // Erst komponieren: Das Detail startet sein Laden selbst (LaunchedEffect).
        compose.waitForIdle()
        // Erst fotografieren, wenn Preis und Verlauf da sind — sonst stand „Preis wird geladen“
        // neben dem Preis in der Liste.
        bereitstellen("merkliste-detail (offen)", { vm.merkpostenDetailState.value.let { !it.laedt && it.preise != null } },
            { vm.merkpostenDetailState.value })
        compose.waitForIdle()
        anhalten()
        foto("merkliste-detail", geraet = "tablet")
    }

    // ── Unterseiten und Erfassen, die sonst kein Foto hatten (I2) ──

    private fun einstellungen() = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel(welt.t.dienste,
        KontoRepository(welt.t.api, welt.t.cache),
        ch.brickinventoryapp.data.repository.VerwaltungRepository(welt.t.api, welt.t.cache),
        SetsRepository(welt.t.api, welt.t.cache),
        TeileRepository(welt.t.api, welt.t.cache),
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
            ch.brickinventoryapp.ui.screens.LagerorteRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        anhalten()
        foto("lagerorte")
    }

    @Test
    fun csvImport() {
        val vm = einstellungen()
        zeige("csv-import") {
            ch.brickinventoryapp.ui.screens.CsvImportRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
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
            KontoRepository(welt.t.api, welt.t.cache))).also { it.loadHouseholdStatus() }
        zeige("haushalt", bereit = { vm.householdState.value.status != null }, zustand = { vm.householdState.value }) {
            ch.brickinventoryapp.ui.screens.HaushaltRoute(vm, remember { SnackbarHostState() }, onZurueck = {})
        }
        anhalten()
        foto("haushalt")
    }

    @Test
    fun bauliste() {
        zeige("bauliste") {
            ch.brickinventoryapp.ui.screens.PartsListScreen(ch.brickinventoryapp.ui.TeilelisteUiState(),
                serverUrl = "", imageLoader = bilder, onScanBarcode = {})
        }
        anhalten()
        foto("bauliste")
    }

    /** Erfassen: der Dialog der Galerie mit Nummer, Menge, Preis, Zustand und Lagerort. */
    @Test fun dialogSetErfassen() = dialogSetErfassenFoto("dialog-set-erfassen", 1f)

    /** Bei 200 % stehen Zustand und Lagerort als Chips bzw. volle Zeile da, nichts bricht im Wort. */
    @Test fun dialogSetErfassenSchrift200() = dialogSetErfassenFoto("dialog-set-erfassen-schrift200", 2f)

    /** Auf dem Tablet steht der Dialog in seiner Material-Breite über der Fläche. */
    @Test fun dialogSetErfassenTablet() = dialogSetErfassenFoto("dialog-set-erfassen", 1f, geraet = "tablet")

    private fun dialogSetErfassenFoto(name: String, schrift: Float, geraet: String = "telefon") {
        // Ohne sofortigen Fokus: Ein blinkender Cursor liesse Compose nie zur Ruhe kommen.
        // setContent wartet auf Ruhe, darum geht der Dialog erst danach auf.
        val offen = androidx.compose.runtime.mutableStateOf(false)
        zeige(name, geraet = geraet, schrift = schrift, warten = false) {
            if (offen.value) ch.brickinventoryapp.ui.screens.AddSetDialog(onDismiss = {},
                onAdd = { _, _, _, _, _, _ -> }, lagerorte = listOf("Keller", "Estrich"), sofortFokus = false)
        }
        compose.mainClock.autoAdvance = false
        offen.value = true
        repeat(3) {
            compose.mainClock.advanceTimeBy(200)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        }
        dialogFoto(name, "classic", false, geraet, schrift)
        if (schrift == 1f && geraet == "telefon") {
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
            MerklisteRoute(vm = vm, imageLoader = bilder, onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        foto("merkliste-leer", dunkel = true)
    }

    // ── Bildschirme, die bisher kein Foto hatten (M6) ──

    private val katalogDetail = ch.brickinventoryapp.ui.model.KatalogDetailAnsicht(
        setNumber = "10305-1", name = "Lion Knights' Castle", year = 2022, themeId = 721, themeName = "Icons",
        numParts = 4514, imageLocal = "/beispiel/set1.png", minifigs = 22,
        bricklink = ch.brickinventoryapp.ui.model.BrickLinkAnsicht(number = "10305-1",
            url = "https://www.bricklink.com/v2/catalog/catalogitem.page?S=10305-1"))

    private fun katalogDetailFoto(dunkel: Boolean, geraet: String, schrift: Float = 1f, name: String = "katalog-detail") {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            ch.brickinventoryapp.ui.screens.CatalogDetailScreen(setNumber = "10305-1", detail = katalogDetail,
                isLoading = false, imageLoader = bilder, serverUrl = "", onLoad = {},
                onAddToGallery = { _, _, _, _, _, _ -> }, onWish = { _, _, _, _, _ -> },
                onOpenInGallery = {}, onBack = {})
        }
        anhalten()
        foto(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun katalogDetailTelefon() = katalogDetailFoto(false, "telefon")
    /** Beide Handlungen untereinander und ganz lesbar, auch bei 200 %. */
    @Test fun katalogDetailSchrift200() = katalogDetailFoto(false, "telefon", 2f, "katalog-detail-schrift200")
    @Test fun katalogDetailTabletDunkel() = katalogDetailFoto(true, "tablet")

    @Test
    fun vergleich() {
        zeige("vergleich") { ch.brickinventoryapp.ui.screens.ComparisonScreen() }
        anhalten()
        foto("vergleich")
    }

    /** Konto: Profil, Design, zweiter Faktor und zwei angemeldete Geräte; auf Wunsch mit beantragter Adresse. */
    private fun kontoFoto(dunkel: Boolean, geraet: String, name: String = "konto", emailNeu: String? = null) {
        val neu = emailNeu?.let { ""","email_neu":"$it"""" } ?: ""
        welt.pfade.antworten["/api/v1/auth/profile"] = """{"success":true,"user":{"id":1,"username":"marco",
            "email":"marco@example.org","first_name":"Marco","last_name":"Muster","email_verified":true$neu}}"""
        welt.pfade.antworten["/api/v1/auth/zweiter-faktor"] = """{"success":true,"aktiv":true,"codes_uebrig":8}"""
        welt.pfade.antworten["/api/v1/settings/theme"] = """{"success":true,"theme":"classic","vorgabe":"classic"}"""
        welt.pfade.antworten["/api/v1/settings/tokens"] = """{"success":true,"tokens":[
            {"token_id":"a1","label":"Pixel 8","created_at":"2026-09-01T10:00:00Z","last_used":"2026-11-02T18:00:00Z","aktuell":true,"scope":"app"},
            {"token_id":"b2","label":"Galaxy Tab","created_at":"2026-06-12T10:00:00Z","last_used":"2026-10-20T08:00:00Z","scope":"app"}]}"""
        val konto = welt.t.merke(ch.brickinventoryapp.ui.viewmodel.KontoViewModel(
            KontoRepository(welt.t.api, welt.t.cache), KontextTexte(),
            welt.t.meldungen, welt.t.sitzung))
        zeige(name, dunkel = dunkel, geraet = geraet) {
            ch.brickinventoryapp.ui.screens.KontoRoute(onAbmelden = {}, snackbarHostState = remember { SnackbarHostState() },
                konto = konto, onZurueck = {})
        }
        anhalten()
        foto(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun kontoTelefon() = kontoFoto(false, "telefon")
    @Test fun kontoTabletDunkel() = kontoFoto(true, "tablet")
    /** Die neue Adresse wartet auf ihren Link: Das Feld zeigt die geltende, darunter die beantragte. */
    @Test fun kontoEmailAusstehend() = kontoFoto(false, "telefon", "konto-email-ausstehend", "marco.neu@example.org")

    /** Preisalarme: einer scharf, einer schon ausgelöst — im Normalfall mit Name und Bild. */
    private fun preisalarmeFoto(dunkel: Boolean, geraet: String, schrift: Float = 1f, name: String = "preisalarme") {
        welt.pfade.antworten["/api/v1/alerts"] = """{"success":true,"alerts":[
            {"set_number":"75192-1","condition":"N","richtung":"unter","schwelle":750.0,"currency_code":"CHF",
             "name":"Millennium Falcon","image_local":"/beispiel/set1.png"},
            {"set_number":"10294-1","condition":"N","richtung":"ueber","schwelle":440.0,"currency_code":"CHF",
             "ausgeloest":true,"zuletzt_am":"2026-10-30T09:00:00Z","zuletzt_preis":449.95,
             "name":"Titanic","image_local":"/beispiel/set2.png","besitzt":false}]}"""
        val vm = einstellungen()
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            ch.brickinventoryapp.ui.screens.PreisalarmeRoute(vm = vm, imageLoader = bilder, serverUrl = "",
                snackbarHostState = remember { SnackbarHostState() }, onSetClick = {}, onZurueck = {}, meldeSchalter = {})
        }
        anhalten()
        foto(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun preisalarmeTelefon() = preisalarmeFoto(false, "telefon")
    /** Der ausgelöste Alarm bei 200 %: Plakette und letzter Preis brechen um, kein Zeichen einzeln. */
    @Test fun preisalarmeSchrift200() = preisalarmeFoto(false, "telefon", 2f, "preisalarme-schrift200")
    @Test fun preisalarmeTabletDunkel() = preisalarmeFoto(true, "tablet")

    /** Teil aus Sets: auf dem Tablet rechts neben der Liste, auf dem Telefon als Dialog. */
    private fun teilDetailFoto(geraet: String, dunkel: Boolean) {
        welt.pfade.antworten["/api/v1/parts/3001/5/sets"] = """{"success":true,
            "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","category_name":"Bricks",
                    "image_local":"/beispiel/teil1.png","total_quantity":12},
            "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"image_local":"/beispiel/set1.png","owner_user_id":1},
                    {"set_number":"21318-1","set_name":"Baumhaus","quantity":4,"image_local":"/beispiel/set3.png","owner_user_id":1}]}"""
        val vm = welt.teile().also { it.loadParts() }
        zeige("teil-detail", dunkel = dunkel, geraet = geraet, bereit = { vm.partsState.value.parts.isNotEmpty() },
            zustand = { vm.partsState.value }) {
            ch.brickinventoryapp.nav.TeileListeUndDetailRoute(vm, bilder, "", rememberNavController()) { _ ->
                PartsRoute(vm = vm, imageLoader = bilder)
            }
        }
        compose.onNode(androidx.compose.ui.test.hasText("Brick 2 x 4", substring = true) and
            androidx.compose.ui.test.hasClickAction()).performClick()
        bereitstellen("teil-detail (offen)", { !vm.setItemState.value.laedt }, { vm.setItemState.value })
        anhalten()
        if (geraet == "telefon") blattFoto(R.string.setitem_used_in, "teil-detail", "classic", dunkel, geraet)
        else foto("teil-detail", dunkel = dunkel, geraet = geraet)
    }

    /**
     * Ein Blatt von unten (ModalBottomSheet) hat ein eigenes Fenster ohne Dialog-Semantik:
     * fotografiert wird die Wurzel, die [kennung] trägt.
     */
    private fun blattFoto(kennung: Int, name: String, design: String, dunkel: Boolean, geraet: String) {
        val text = ApplicationProvider.getApplicationContext<android.content.Context>().getString(kennung)
        compose.onNode(androidx.compose.ui.test.isRoot() and
            androidx.compose.ui.test.hasAnyDescendant(androidx.compose.ui.test.hasText(text)))
            .captureRoboImage(pfad(name, design, dunkel, geraet))
    }

    /**
     * Das Filterblatt der Sammlung mit Lagerort und Thema. Die Beispieldaten hatten
     * weder Themenliste noch Lagerorte, das Blatt zeigte nur Griff und Titel.
     */
    @Test
    fun filterblattGalerie() {
        welt.pfade.antworten["/api/v1/sets"] = Beispiele.ANTWORTEN.first { it.first == "/api/v1/sets" }.second
            .replaceFirst("\"total\":3,", "\"total\":3,\"themes\":[\"Icons\",\"Ideas\",\"Star Wars\"],")
        welt.pfade.antworten["/api/v1/storage"] = """{"success":true,"orte":[
            {"ort":"Keller","sets":2,"teile":40},{"ort":"Regal Wohnzimmer","sets":1,"teile":0}]}"""
        val vm = welt.galerie().also { it.aktualisieren() }
        zeige("filter-galerie", bereit = { galerieFertig(vm)() && vm.lagerState.value.orte.isNotEmpty() &&
            vm.galleryState.value.galleryThemes.isNotEmpty() }, zustand = { vm.galleryState.value }) { Galerie(vm) }
        compose.onNodeWithContentDescription(ApplicationProvider.getApplicationContext<android.content.Context>()
            .getString(R.string.filter_button)).performClick()
        compose.waitForIdle()
        blattAufziehen()
        blattFoto(R.string.filter_title, "filter-galerie", "classic", false, "telefon")
    }

    /**
     * Das Blatt fährt in seinem eigenen Fenster hoch, und dessen Bildaufbau hängt an der
     * Systemuhr des Loopers: Die Compose-Uhr allein liess es auf halbem Weg stehen.
     */
    private fun blattAufziehen() {
        compose.mainClock.autoAdvance = false
        repeat(30) {
            compose.mainClock.advanceTimeBy(50)
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50))
        }
    }

    // ── Pflichtmasken bei 200 % und der letzte Schritt des zweiten Faktors ──

    @Test
    fun startpasswortSchrift200() {
        zeige("startpasswort-schrift200", schrift = 2.0f) {
            ch.brickinventoryapp.ui.screens.StartpasswortMaske(ch.brickinventoryapp.ui.KontoUiState(), { _, _, _ -> }, {})
        }
        foto("startpasswort-schrift200")
    }

    @Test
    fun zweiterFaktorSchrift200() {
        zeige("zweiter-faktor-schrift200", schrift = 2.0f) {
            ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske(
                ch.brickinventoryapp.ui.ZweiterFaktorUiState(aktiv = false), {}, {}, {}, {})
        }
        foto("zweiter-faktor-schrift200")
    }

    /** Schritt 3: die Notfallcodes, „Weiter“ erst nach dem Haken. */
    @Test
    fun zweiterFaktorCodes() {
        zeige("zweiter-faktor-codes", dunkel = true) {
            ch.brickinventoryapp.ui.screens.ZweiterFaktorPflichtMaske(
                ch.brickinventoryapp.ui.ZweiterFaktorUiState(aktiv = true,
                    codes = listOf("a1b2-c3d4", "e5f6-g7h8", "i9j0-k1l2", "m3n4-o5p6")), {}, {}, {}, {})
        }
        foto("zweiter-faktor-codes", dunkel = true)
    }

    @Test fun teilDetailTelefon() = teilDetailFoto("telefon", false)
    @Test fun teilDetailTablet() = teilDetailFoto("tablet", false)

    /**
     * Die Meldung nach dem Löschen mit „Rückgängig“ — über der unteren Leiste. Das Set ist
     * vorgemerkt und damit schon aus dem Raster, wie in der App.
     */
    private fun snackbarFoto(geraet: String, dunkel: Boolean) {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        bereitstellen("snackbar (geladen)", galerieFertig(galerie)) { galerie.galleryState.value }
        galerie.loeschenVormerken(Beispiele.SET, "Millennium Falcon")
        val meldung = SnackbarHostState()
        zeige("snackbar", dunkel = dunkel, geraet = geraet, bereit = galerieFertig(galerie),
            zustand = { galerie.galleryState.value }) {
            Geruest(galerie, snackbar = meldung)
            androidx.compose.runtime.LaunchedEffect(Unit) {
                meldung.showSnackbar("„Millennium Falcon“ gelöscht", actionLabel = "Rückgängig",
                    duration = androidx.compose.material3.SnackbarDuration.Indefinite)
            }
        }
        anhalten()
        foto("snackbar", dunkel = dunkel, geraet = geraet)
    }

    @Test fun snackbarTelefon() = snackbarFoto("telefon", false)
    @Test fun snackbarTabletDunkel() = snackbarFoto("tablet", true)

    // ── Lücken der Prüfung (N17): Katalog, leer und Fehler je Reiter, Tablet 200 %, quer ──

    private val katalogSets = (1..6).map { i ->
        ch.brickinventoryapp.ui.model.KatalogSetAnsicht(setNumber = "1030$i-1", name = "Beispielset $i",
            year = 2020 + i, numParts = 500 * i, imageLocal = "/beispiel/set${(i - 1) % 3 + 1}.png",
            owned = i == 2, ownedQuantity = if (i == 2) 2 else 0)
    }

    private object KeineKatalogAktionen : ch.brickinventoryapp.ui.viewmodel.KatalogAktionen {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogSichtbar(ersteSeite: Int, letzteSeite: Int) = Unit
        override fun scrollCatalogTo(nummer: Int) = Unit
        override fun setCatalogScrollPos(index: Int, offset: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: String) = Unit
    }

    private fun katalogFoto(
        dunkel: Boolean, geraet: String, name: String = "katalog", schrift: Float = 1f,
        zustand: ch.brickinventoryapp.ui.CatalogUiState =
            ch.brickinventoryapp.ui.CatalogUiState(loadedPages = mapOf(1 to katalogSets), total = katalogSets.size),
    ) {
        zeige(name, dunkel = dunkel, geraet = geraet, schrift = schrift) {
            ch.brickinventoryapp.ui.screens.CatalogScreen(zustand, serverUrl = "", katalog = KeineKatalogAktionen,
                imageLoader = bilder, onSetClick = {})
        }
        anhalten()
        foto(name, dunkel = dunkel, geraet = geraet)
    }

    @Test fun katalogTelefon() = katalogFoto(false, "telefon")
    @Test fun katalogTabletDunkel() = katalogFoto(true, "tablet")
    @Test fun katalogSchrift200() = katalogFoto(false, "telefon", "katalog-schrift200", 2f)
    @Test fun katalogLeer() = katalogFoto(false, "telefon", "katalog-leer", zustand = ch.brickinventoryapp.ui.CatalogUiState())
    @Test fun katalogFehler() = katalogFoto(true, "telefon", "katalog-fehler",
        zustand = ch.brickinventoryapp.ui.CatalogUiState(error = "Serverfehler (500)"))

    @Test
    fun merklisteFehler() {
        welt.pfade.codes["/api/v1/wanted"] = 500
        val vm = welt.merkliste().also { it.ladeMerkliste() }
        zeige("merkliste-fehler", bereit = { vm.merklisteState.value.let { !it.laedt && it.fehler != null } },
            zustand = { vm.merklisteState.value }) {
            MerklisteRoute(vm = vm, imageLoader = bilder, onScan = {}, onOeffnenEinzeln = { _, _ -> })
        }
        anhalten()
        foto("merkliste-fehler")
    }

    @Test
    fun teileLeer() {
        welt.pfade.antworten["/api/v1/parts"] = """{"success":true,"total":0,"parts":[]}"""
        val vm = welt.teile().also { it.loadParts() }
        zeige("teile-leer", bereit = { vm.partsState.value.let { !it.partsLoading && it.partsFehler == null } },
            zustand = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        anhalten()
        foto("teile-leer")
    }

    @Test
    fun teileFehler() {
        welt.pfade.codes["/api/v1/parts"] = 500
        val vm = welt.teile().also { it.loadParts() }
        zeige("teile-fehler", dunkel = true, bereit = { vm.partsState.value.let { !it.partsLoading && it.partsFehler != null } },
            zustand = { vm.partsState.value }) { PartsRoute(vm = vm, imageLoader = bilder) }
        anhalten()
        foto("teile-fehler", dunkel = true)
    }

    @Test
    fun finanzenFehler() {
        welt.pfade.codes["/api/v1/finance/valuation"] = 500
        val vm = welt.finanzen().also { it.loadValuation() }
        zeige("finanzen-fehler", bereit = { vm.financeState.value.let { !it.valuationLoading && it.valuationFehler != null } },
            zustand = { vm.financeState.value }) { FinanceRoute(vm = vm, imageLoader = bilder) }
        anhalten()
        foto("finanzen-fehler")
    }

    @Test
    fun galerieTabletSchrift200() {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("galerie-schrift200", geraet = "tablet", schrift = 2f, bereit = galerieFertig(vm),
            zustand = { vm.galleryState.value }) { Galerie(vm) }
        foto("galerie-schrift200", geraet = "tablet")
    }

    @Test
    fun galerieQuer() {
        val vm = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("galerie", geraet = "quer", bereit = galerieFertig(vm), zustand = { vm.galleryState.value }) { Galerie(vm) }
        foto("galerie", geraet = "quer")
    }

    private fun anmeldungFoto(name: String, formular: AnmeldeFormular, geraet: String, schrift: Float) {
        zeige(name, geraet = geraet, schrift = schrift) {
            LoginScreen(
                serverUrl = "https://brick.example.org", isLoading = false, error = null, codeNoetig = false,
                formular = formular, registrierungOffen = true, kontoLaeuft = false,
                kontoMeldung = null, kontoFehler = null, onLogin = { _, _, _ -> }, onFormular = {},
                onRegistrieren = { _, _, _, _, _ -> }, onPasswortVergessen = {}, onChangeServer = {},
            )
        }
        foto(name, geraet = geraet)
    }

    @Test fun anmeldenQuer() = anmeldungFoto("anmelden", AnmeldeFormular.ANMELDEN, "quer", 1f)
    @Test fun registrierenSchrift200() = anmeldungFoto("registrieren-schrift200", AnmeldeFormular.REGISTRIEREN, "telefon", 2f)

    @Test
    fun einrichtenQuer() {
        zeige("einrichten", geraet = "quer") {
            ch.brickinventoryapp.ui.screens.SetupScreen(currentUrl = "https://brick.fritz.box", onSave = {}, entwicklung = false)
        }
        foto("einrichten", geraet = "quer")
    }

    /** Ohne Netz: Hinweis mit Stand über der Liste, drei Änderungen warten im Ausgang. */
    @Test
    fun offline() {
        val galerie = welt.galerie().also { it.loadSets(); it.loadStats() }
        zeige("offline", bereit = galerieFertig(galerie), zustand = { galerie.galleryState.value }) {
            Geruest(galerie, offeneAenderungen = 3, offlineStand = 1_793_000_000_000L)
        }
        anhalten()
        foto("offline")
    }
}
