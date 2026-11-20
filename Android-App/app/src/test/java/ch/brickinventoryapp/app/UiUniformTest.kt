package ch.brickinventoryapp.app

import android.content.Context
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.katalog.ui.CatalogUiState
import ch.brickinventoryapp.katalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.katalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.konto.ui.screens.LocationsRoute
import ch.brickinventoryapp.konto.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.model.datei.FileReader
import ch.brickinventoryapp.model.datei.FileRef
import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.fach.KatalogSetAnsicht
import ch.brickinventoryapp.model.fach.Katalogsortierung
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.SetAnsicht
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.sammlung.ui.screens.GalleryRoute
import ch.brickinventoryapp.sammlung.ui.screens.SetCard
import ch.brickinventoryapp.sammlung.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.model.fach.Figurenordnung
import ch.brickinventoryapp.teile.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.teile.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.teile.ui.screens.MinifigsRoute
import ch.brickinventoryapp.teile.ui.screens.PartsRoute
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.verwaltung.ui.ManagementUiState
import ch.brickinventoryapp.verwaltung.ui.screens.CacheEvents
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringScreen
import ch.brickinventoryapp.verwaltung.ui.screens.MonitoringState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.KaeufeViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.Locale
import android.os.Looper
import org.robolectric.Shadows.shadowOf

/**
 * Eine Sprache der Oberfläche, ausgeführt statt im Quelltext gesucht: Filter als Chips,
 * Sortierung der Minifiguren, „hinzufügen“ überall, Primärblau nur für Handlungen, ein Kopf
 * für Teiledetails und ein Wort für „kein Preis“, Lesebreite auf dem Tablet, „Rückgängig“
 * nach dem Löschen, Listenzeilen ab grosser Schrift und eine Jahresleiste für alle.
 *
 * Gegenproben (Patches unter gegenproben/, gemessen nur in der CI — Robolectric):
 *   kaufpreise-volle-breite       Kaufpreise ohne centeredUntil → rot „Kaufpreise stehen auf dem Tablet …“
 *   hintergrund-volle-breite      Hintergrundarbeiten ohne centeredUntil → rot „Hintergrundarbeiten stehen …“
 *   galerie-kachel-bei-130        Listenzeile wieder nur über largeFont() → rot „Galerie zeigt bei 130 …“
 *   jahresleiste-28dp             Spur wieder 28 dp → rot „Jahresleiste ist 48 dp breit …“
 *   jahresleiste-ohne-sprung      TalkBack-Tipp öffnet kein Menü → rot „Jahresleiste springt …“
 *   thema-wieder-blau             Thema der Kachel wieder in primary → rot „Thema und Nummern …“
 *   teil-erfassen-titel           parts_add_title wieder „Teil erfassen“ → rot „Texte sagen hinzufuegen …“
 *   galerie-ohne-filterchips      Galerie reicht keine aktiven Filter → rot „aktiver Filter steht als Chip …“
 *   figuren-nummer-unsortiert     NUMMER sortiert nicht → rot „Minifiguren lassen sich sortieren“
 *   teil-loescht-sofort           Vormerken löscht gleich → rot „Teil loeschen bietet Rueckgaengig …“
 *   lagerort-gleich-geloescht     Vormerken löscht gleich → rot „Lagerort loeschen bietet Rueckgaengig …“
 *   kauf-loescht-sofort           Vormerken löscht gleich → rot „Kauf loeschen bietet Rueckgaengig …“
 *   teil-ohne-preis-strich        Marktwert ohne Preis wieder „—“ → rot „Teil ohne Marktpreis …“
 *   setitem-eigener-kopf          Teil aus Sets wieder mit 140-dp-Bild → rot „Teil aus Sets hat denselben Kopf …“
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class UiUniformTest {

    @get:Rule
    val compose = createComposeRule()

    private val vorher = Locale.getDefault()
    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val world = Examples.Welt(ContextTexts())
    private val bilder = SampleImages.loader(ctx)

    init { Locale.setDefault(Locale.forLanguageTag("de-CH")) }

    @After
    fun zu() {
        Locale.setDefault(vorher)
        world.close()
    }

    private var mainColor = Color.Unspecified

    private fun zeige(schrift: Float = 1f, inhalt: @Composable () -> Unit) {
        compose.setContent {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                mainColor = MaterialTheme.colorScheme.primary
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, schrift)) {
                    Surface(color = MaterialTheme.colorScheme.background) { inhalt() }
                }
            }
        }
        compose.waitForIdle()
    }

    private fun drive(name: String, bereit: () -> Boolean) =
        driveUntil(name, requests = { world.paths.requests.size }, bereit = bereit)

    private val dichte get() = compose.density.density

    private fun node(text: String): SemanticsNode =
        compose.onAllNodes(hasText(text, substring = true), useUnmergedTree = true).fetchSemanticsNodes()
            .first { it.config.getOrNull(SemanticsActions.GetTextLayoutResult) != null }

    private fun layout(n: SemanticsNode): TextLayoutResult {
        val ergebnis = mutableListOf<TextLayoutResult>()
        n.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(ergebnis)
        return ergebnis.single()
    }

    private fun requests(praefix: String) = world.paths.requests.filter { it.startsWith(praefix) }

    /** Die Uhr steht; ein halber Moment vergeht, ohne dass die Snackbar abläuft. */
    private fun kurz() {
        compose.mainClock.autoAdvance = false
        repeat(5) {
            compose.mainClock.advanceTimeBy(100)
            shadowOf(Looper.getMainLooper()).idle()
        }
    }

    private fun kaeufe() = world.t.merke(KaeufeViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.changes,
        testHouseholdRepository(world.t.api), world.t.sets(), testFinancesRepository(world.t.api), testPartsRepository(world.t.api),
        testMinifigsRepository(world.t.api)))

    private fun einstellungen() = world.t.merke(SettingsViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise, world.t.sync,
        testAccountRepository(world.t.api, world.t.io), testManagementRepository(world.t.api), world.t.alerts(), testPartsRepository(world.t.api),
        object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null }))

    private fun erfassung() = world.t.merke(EntryViewModel(world.t.sitzung, world.t.filter(), world.t.hinweise,
        testSetsRepository(world.t.api), world.t.setCatalog(), world.t.merkliste(), testCatalogRepository(world.t.api),
        object : SetCreator {
            override fun anlegen(setNumber: String, quantity: Int, purchasePrice: Geld?, condition: Zustand?,
                                 ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
        }))

    // ── Tablet: Lesebreite wie die Einstellungen ──

    private fun linksAbFormEdge(text: String, wo: String) {
        val links = node(text).boundsInRoot.left / dichte
        // 1280 dp breit, 560 dp Formular mittig: Der Inhalt beginnt frühestens bei 360 dp.
        assertTrue("$wo: „$text“ beginnt bei $links dp, nicht in der mittigen Formularbreite", links >= 360f)
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `Kaufpreise stehen auf dem Tablet in Formularbreite`() {
        val vm = kaeufe()
        zeige { AcquisitionManagementRoute(vm, type = Postenart.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {}) }
        drive("Käufe") { compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        linksAbFormEdge(ctx.getString(R.string.common_quantity), "Kaufpreise")
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `Hintergrundarbeiten stehen auf dem Tablet in Formularbreite`() {
        world.paths.antworten["/api/v1/admin/auftraege"] = """{"success":true,"auftraege":[],"zusammenfassung":[],"pausen":[],
            "bildbedarf":0,"job_prozess":{"lebenszeichen":null,"alter_sekunden":null,"laeuft":true}}"""
        val api = world.t.api
        val vm = MonitoringViewModel(testManagementRepository(api), testAccountRepository(api), world.t.meldungen)
        runBlocking { vm.loadBackground() }
        val events = CacheEvents({}, {}, { _, _ -> }, {}, {}, {}, { _, _, _ -> })
        zeige {
            MonitoringScreen(MonitoringState(MonitoringUiState(), vm.hintergrund.value, ManagementUiState(),
                emptyMap(), Design.CLASSIC, 0L), vm, events)
        }
        linksAbFormEdge(ctx.getString(R.string.hintergrund_auftraege), "Hintergrundarbeiten")
    }

    // ── Grosse Schrift: Listenzeilen statt einer Kachel über die ganze Breite ──

    @Test
    fun `Galerie zeigt bei 130 Prozent Listenzeilen`() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        zeige(schrift = 1.3f) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
        val links = node("Millennium Falcon").boundsInRoot.left / dichte
        // In der Zeile steht das Bild (96 dp) links neben dem Namen; als Kachel stünde er am Rand.
        assertTrue("Galerie bei 130 %: Der Name beginnt bei $links dp, also unter einem Bild über die ganze Breite",
            links >= 100f)
    }

    // ── Jahresleiste: 48 dp und ein Sprungmenü für TalkBack und Tastatur ──

    private val jumpTargets = mutableListOf<Int>()

    private val katalog = object : KatalogAktionen {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(nummer: Int) { jumpTargets += nummer }
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: Katalogsortierung) = Unit
    }

    private val catalogSets = (1..6).map { i ->
        KatalogSetAnsicht(setNumber = "1030$i-1", name = "Beispielset $i", year = 2024 - i / 3, numParts = 500 * i)
    }

    private fun showCatalog() = zeige {
        CatalogScreen(CatalogUiState(loadedPages = mapOf(1 to catalogSets), total = 6, sort = Katalogsortierung.JAHR_ABSTEIGEND,
            yearDistribution = listOf(JahrAnzahlAnsicht(2024, 2), JahrAnzahlAnsicht(2023, 3), JahrAnzahlAnsicht(2022, 1))),
            serverUrl = "", katalog = katalog, imageLoader = bilder, onSetClick = {})
    }

    @Test
    fun `Jahresleiste ist 48 dp breit`() {
        showCatalog()
        val track = compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_jahr_springen)).fetchSemanticsNode()
        val breite = track.boundsInRoot.width / dichte
        assertTrue("Jahresleiste ist $breite dp breit, eine Tippfläche braucht 48 dp", breite >= 47.5f)
    }

    @Test
    fun `Jahresleiste springt ueber ein Menue der Jahrgaenge`() {
        showCatalog()
        compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_jahr_springen))
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        compose.onNodeWithText("2023").performClick()
        compose.waitForIdle()
        // 2024 hat zwei Sets: Der Jahrgang 2023 beginnt an der Stelle 2.
        assertEquals("Sprungmenü der Jahresleiste", listOf(2), jumpTargets)
    }

    // ── Texte: „hinzufügen“ wie im Web, ein Name für den Preisvergleich ──

    @Test
    fun `Texte sagen hinzufuegen und Preisvergleich`() {
        for (sprache in listOf("de-rCH", "en-rGB")) {
            RuntimeEnvironment.setQualifiers(sprache)
            val r = ApplicationProvider.getApplicationContext<Context>()
            assertEquals("$sprache: Titel und Knopf beim Teil", r.getString(R.string.parts_add), r.getString(R.string.parts_add_title))
            assertEquals("$sprache: Titel und Knopf bei der Figur", r.getString(R.string.minifigs_add), r.getString(R.string.minifigs_add_title))
            assertEquals("$sprache: Ziel und Seite des Vergleichs", r.getString(R.string.comparison_title), r.getString(R.string.nav_comparison))
        }
        RuntimeEnvironment.setQualifiers("de-rCH")
        val de = ApplicationProvider.getApplicationContext<Context>()
        for (id in listOf(R.string.gallery_add_first, R.string.parts_add_title, R.string.minifigs_add_title)) {
            assertTrue("„${de.getString(id)}“ sagt hinzufügen", de.getString(id).contains("hinzufügen"))
        }
    }

    // ── Primärblau nur für Handlungen ──

    private fun withoutMainColor(text: String, wo: String) {
        val t = layout(node(text))
        val farben = listOf(t.layoutInput.style.color) +
            t.layoutInput.text.spanStyles.filter { text in t.layoutInput.text.text.substring(it.start, it.end) }.map { it.item.color }
        assertFalse("$wo: „$text“ steht in Primärblau, ist aber nicht antippbar", mainColor in farben)
    }

    @Test
    fun `Thema und Nummern stehen nicht in Primaerblau`() {
        zeige {
            SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars", pieces = 7541),
                serverUrl = "", imageLoader = bilder, onClick = {})
        }
        assertNotEquals(Color.Unspecified, mainColor)
        withoutMainColor("Star Wars", "Thema der Kachel")
        withoutMainColor("75192-1", "Nummer der Kachel")
    }

    // ── Aktive Filter als Chips, Sortierung der Minifiguren ──

    @Test
    fun `aktiver Filter steht als Chip unter der Suche und laesst sich entfernen`() {
        val vm = world.galerie().also { it.setGalleryTheme("Star Wars"); it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        zeige { GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {}) }
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_entfernen, "Star Wars")).performClick()
        compose.waitForIdle()
        assertEquals("Der Chip nimmt den Themenfilter weg", "", vm.galleryState.value.galleryTheme)
    }

    @Test
    fun `Minifiguren lassen sich sortieren`() {
        world.paths.antworten["/api/v1/minifigs"] = """{"success":true,"figs":[
            {"fig_number":"sw0003","fig_name":"Anakin","quantity":1},
            {"fig_number":"sw0001","fig_name":"Luke","quantity":1},
            {"fig_number":"sw0002","fig_name":"Han","quantity":5}]}"""
        val vm = world.figuren().also { it.loadMinifigs() }
        drive("Figuren") { vm.minifigsState.value.minifigs.size == 3 }
        zeige { MinifigsRoute(vm = vm, imageLoader = bilder) }
        val name = ctx.getString(R.string.parts_ordnung_name)
        compose.onNode(hasContentDescription(ctx.getString(R.string.sort_menu_cd, name)) and hasClickAction()).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ctx.getString(R.string.minifigs_ordnung_nummer)).performClick()
        compose.waitForIdle()
        assertEquals("Minifiguren nach Nummer", listOf("sw0001", "sw0002", "sw0003"),
            vm.minifigsState.value.minifigs.map { it.figNumber })
        vm.setMinifigsOrder(Figurenordnung.QUANTITY)
        assertEquals("Minifiguren nach Menge", "sw0002", vm.minifigsState.value.minifigs.first().figNumber)
    }

    // ── Rückgängig nach dem Löschen ──

    @Test
    fun `Teil loeschen bietet Rueckgaengig und loescht erst danach`() {
        world.paths.antworten["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12}]}"""
        val vm = world.teile().also { it.loadParts() }
        drive("Teile") { vm.teileState.value.manualParts?.isNotEmpty() == true }
        vm.partDeleteReserve("3001", 5, null, "Brick 2 x 4")
        drive("vorgemerkt") { true }
        assertTrue("vorgemerkt fehlt in der Liste", vm.teileState.value.manualParts.orEmpty().isEmpty())
        assertTrue("vor dem Ende der Snackbar nichts gelöscht", requests("DELETE /api/v1/parts/3001/5").isEmpty())
        vm.loeschen.rueckgaengig()
        assertEquals("Rückgängig holt es zurück", 1, vm.teileState.value.manualParts.orEmpty().size)
        vm.partDeleteReserve("3001", 5, null, "Brick 2 x 4")
        vm.loeschen.ausfuehren()
        drive("gelöscht") { requests("DELETE /api/v1/parts/3001/5").isNotEmpty() }
    }

    @Test
    fun `Lagerort loeschen bietet Rueckgaengig und loescht erst danach`() {
        world.paths.antworten["/api/v1/storage/locations"] = """{"success":true,"orte":[
            {"id":3,"name":"Keller"},{"id":4,"name":"Estrich"}]}"""
        val vm = einstellungen().also { it.loadOwnLocations() }
        zeige { LocationsRoute(vm, remember { SnackbarHostState() }, onZurueck = {}) }
        drive("Lagerorte") { vm.storageState.value.eigene.size == 2 }
        vm.locationDeleteReserve(vm.storageState.value.eigene.first { it.id == 3 })
        kurz()
        assertEquals("vorgemerkt fehlt in der Liste", listOf(4), vm.storageState.value.eigene.map { it.id })
        assertTrue("vor dem Ende der Snackbar nichts gelöscht", requests("DELETE /api/v1/storage/locations/3").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        kurz()
        assertEquals("Rückgängig holt ihn zurück", 2, vm.storageState.value.eigene.size)
        assertTrue("Rückgängig löscht nicht", requests("DELETE /api/v1/storage/locations/3").isEmpty())
        vm.locationDeleteReserve(vm.storageState.value.eigene.first { it.id == 3 })
        vm.locationRoute.ausfuehren()
        drive("gelöscht") { requests("DELETE /api/v1/storage/locations/3").isNotEmpty() }
    }

    @Test
    fun `Kauf loeschen bietet Rueckgaengig und loescht erst danach`() {
        val vm = kaeufe()
        zeige { AcquisitionManagementRoute(vm, type = Postenart.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {}) }
        drive("Käufe") { compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isNotEmpty() }
        vm.purchaseDeleteReserve(Postenart.SET, Examples.SET, 0, 1)
        kurz()
        assertTrue("vorgemerkt fehlt in der Liste",
            compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isEmpty())
        assertTrue("vor dem Ende der Snackbar nichts gelöscht", requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isEmpty())
        compose.onNodeWithText(ctx.getString(R.string.common_undo)).performClick()
        kurz()
        assertTrue("Rückgängig löscht nicht", requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isEmpty())
        vm.purchaseDeleteReserve(Postenart.SET, Examples.SET, 0, 1)
        vm.purchaseRoute.ausfuehren()
        drive("gelöscht") { requests("DELETE /api/v1/sets/75192-1/acquisitions/1").isNotEmpty() }
    }

    // ── Ein Kopf für Teiledetails, ein Wort für „kein Preis“ ──

    /** Die Bildfläche zum Antippen (verschmolzen mit dem Bild), nicht das eingerückte Bild darin. */
    private fun imageHeight(name: String): Float = compose.onAllNodes(hasContentDescription(name))
        .fetchSemanticsNodes().maxOf { it.boundsInRoot.height } / dichte

    @Test
    fun `Teil ohne Marktpreis sagt noch kein Preis`() {
        world.paths.antworten["/api/v1/parts/manual"] = """{"success":true,"parts":[{"id":9,"part_number":"3001",
            "part_name":"Brick 2 x 4","color_id":5,"color_name":"Red","quantity":12,"image_local":"/beispiel/teil1.png"}]}"""
        val teile = world.teile().also { it.loadParts() }
        drive("Teile") { teile.teileState.value.manualParts?.isNotEmpty() == true }
        zeige {
            ManualItemDetailRoute(kaeufe(), teile, world.figuren(), type = Postenart.PART, id = "3001", colorId = 5,
                fallbackTitle = "Brick 2 x 4", imageLoader = bilder, onBack = {}, onNavigateToAcqMgmt = { _, _, _, _ -> })
        }
        assertTrue("Teil ohne Marktpreis: „noch kein Preis“ statt eines Strichs",
            compose.onAllNodes(hasText(ctx.getString(R.string.detail_price_none_yet))).fetchSemanticsNodes().isNotEmpty())
        assertEquals("Kopf des selbst erfassten Teils", 200f, imageHeight("Brick 2 x 4"), 1f)
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `Teil aus Sets hat denselben Kopf wie ein selbst erfasstes`() {
        world.paths.antworten["/api/v1/parts/3001/5/sets"] = """{"success":true,
            "item":{"nummer":"3001","name":"Brick 2 x 4","color_id":5,"color_name":"Red","category_name":"Bricks",
                    "image_local":"/beispiel/teil1.png","total_quantity":12},
            "sets":[{"set_number":"75192-1","set_name":"Millennium Falcon","quantity":8,"owner_user_id":1}]}"""
        val vm = world.teile().also { it.loadParts() }
        drive("Teile") { vm.teileState.value.parts.isNotEmpty() }
        zeige {
            PartsListAndDetailRoute(vm, bilder, "", { _, _, _, _ -> }, {}, { _, _, _, _ -> }) { _ ->
                PartsRoute(vm = vm, imageLoader = bilder)
            }
        }
        compose.onNode(hasText("Brick 2 x 4", substring = true) and hasClickAction()).performClick()
        drive("Teil offen") { vm.setItemState.value.kopf != null }
        compose.waitForIdle()
        assertEquals("Kopf des Teils aus Sets", 200f, imageHeight("Brick 2 x 4"), 1f)
        // Der Chip zeigt die Farbe in der Sprache der App (de-CH), wie beim selbst erfassten Teil.
        assertTrue("Kennzahlen als Chips wie beim selbst erfassten Teil",
            compose.onAllNodes(hasText(ctx.getString(R.string.setitem_color) + " Rot", substring = true), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty())
    }
}
