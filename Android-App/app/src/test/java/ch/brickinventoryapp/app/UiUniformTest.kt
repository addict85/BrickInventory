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
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.KatalogAktionen
import ch.brickinventoryapp.account.ui.screens.LocationsRoute
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.model.domain.Katalogsortierung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.screens.AcquisitionManagementRoute
import ch.brickinventoryapp.collection.ui.screens.GalleryRoute
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.model.domain.Figurenordnung
import ch.brickinventoryapp.parts.ui.PartsListAndDetailRoute
import ch.brickinventoryapp.parts.ui.screens.ManualItemDetailRoute
import ch.brickinventoryapp.parts.ui.screens.MinifigsRoute
import ch.brickinventoryapp.parts.ui.screens.PartsRoute
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.screens.CacheEvents
import ch.brickinventoryapp.management.ui.screens.MonitoringScreen
import ch.brickinventoryapp.management.ui.screens.MonitoringState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
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
 * One language of the UI, executed instead of searched in the source: filters as chips,
 * sorting of the minifigures, „hinzufügen“ everywhere, primary blue only for actions, one header
 * for part details and one word for „kein Preis“, reading width on the tablet, „Rückgängig“
 * after deleting, list rows from large font on and a year bar for all.
 *
 * Counter-checks (patches under gegenproben/, measured only in CI — Robolectric):
 *   kaufpreise-volle-breite       purchase prices without centeredUntil → red “purchase prices stand in form width on the tablet …”
 *   hintergrund-volle-breite      background work without centeredUntil → red “background work stands …”
 *   galerie-kachel-bei-130        list row again only via largeFont() → red “gallery shows list rows at 130 …”
 *   jahresleiste-28dp             track again 28 dp → red “year bar is 48 dp wide …”
 *   jahresleiste-ohne-sprung      TalkBack tap opens no menu → red “year bar jumps …”
 *   thema-wieder-blau             theme of the tile again in primary → red “theme and numbers …”
 *   teil-erfassen-titel           parts_add_title again „Teil erfassen“ → red “texts say add …”
 *   galerie-ohne-filterchips      gallery passes no active filters → red “active filter stands as a chip …”
 *   figuren-nummer-unsortiert     NUMMER does not sort → red “minifigures can be sorted“
 *   teil-loescht-sofort           marking deletes right away → red “deleting a part offers undo …”
 *   lagerort-gleich-geloescht     marking deletes right away → red “deleting a storage location offers undo …”
 *   kauf-loescht-sofort           marking deletes right away → red “deleting a purchase offers undo …”
 *   teil-ohne-preis-strich        market value without price again „—“ → red “part without market price …”
 *   setitem-eigener-kopf          part from sets again with 140 dp image → red “part from sets has the same header …”
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

    /** The clock stands; half a moment passes without the snackbar expiring. */
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

    // ── Tablet: reading width like the settings ──

    private fun linksAbFormEdge(text: String, wo: String) {
        val links = node(text).boundsInRoot.left / dichte
        // 1280 dp wide, 560 dp form centered: the content begins at 360 dp at the earliest.
        assertTrue("$wo: „$text“ beginnt bei $links dp, nicht in der mittigen Formularbreite", links >= 360f)
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `purchase prices stand in form width on the tablet`() {
        val vm = kaeufe()
        zeige { AcquisitionManagementRoute(vm, type = Postenart.SET, id = Examples.SET, title = "Millennium Falcon", onBack = {}) }
        drive("Käufe") { compose.onAllNodes(hasText(ctx.getString(R.string.common_quantity))).fetchSemanticsNodes().isNotEmpty() }
        compose.waitForIdle()
        linksAbFormEdge(ctx.getString(R.string.common_quantity), "Kaufpreise")
    }

    @Test
    @Config(qualifiers = "de-rCH-w1280dp-h800dp-land-xhdpi")
    fun `background work stands in form width on the tablet`() {
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

    // ── Large font: list rows instead of one tile across the whole width ──

    @Test
    fun `gallery shows list rows at 130 percent`() {
        val vm = world.galerie().also { it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        zeige(schrift = 1.3f) {
            GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {})
        }
        val links = node("Millennium Falcon").boundsInRoot.left / dichte
        // In the row the image (96 dp) stands left of the name; as a tile it would stand at the edge.
        assertTrue("Galerie bei 130 %: Der Name beginnt bei $links dp, also unter einem Bild über die ganze Breite",
            links >= 100f)
    }

    // ── Year bar: 48 dp and a jump menu for TalkBack and keyboard ──

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
    fun `year bar is 48 dp wide`() {
        showCatalog()
        val track = compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_jahr_springen)).fetchSemanticsNode()
        val breite = track.boundsInRoot.width / dichte
        assertTrue("Jahresleiste ist $breite dp breit, eine Tippfläche braucht 48 dp", breite >= 47.5f)
    }

    @Test
    fun `year bar jumps via a menu of the years`() {
        showCatalog()
        compose.onNodeWithContentDescription(ctx.getString(R.string.catalog_jahr_springen))
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
        compose.onNodeWithText("2023").performClick()
        compose.waitForIdle()
        // 2024 has two sets: the year 2023 begins at position 2.
        assertEquals("Sprungmenü der Jahresleiste", listOf(2), jumpTargets)
    }

    // ── Texts: „hinzufügen“ as on the web, one name for the price comparison ──

    @Test
    fun `texts say add and price comparison`() {
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

    // ── Primary blue only for actions ──

    private fun withoutMainColor(text: String, wo: String) {
        val t = layout(node(text))
        val farben = listOf(t.layoutInput.style.color) +
            t.layoutInput.text.spanStyles.filter { text in t.layoutInput.text.text.substring(it.start, it.end) }.map { it.item.color }
        assertFalse("$wo: „$text“ steht in Primärblau, ist aber nicht antippbar", mainColor in farben)
    }

    @Test
    fun `theme and numbers are not in primary blue`() {
        zeige {
            SetCard(SetAnsicht(setNumber = "75192-1", name = "Millennium Falcon", theme = "Star Wars", pieces = 7541),
                serverUrl = "", imageLoader = bilder, onClick = {})
        }
        assertNotEquals(Color.Unspecified, mainColor)
        withoutMainColor("Star Wars", "Thema der Kachel")
        withoutMainColor("75192-1", "Nummer der Kachel")
    }

    // ── Active filters as chips, sorting of the minifigures ──

    @Test
    fun `active filter stands as a chip below the search and can be removed`() {
        val vm = world.galerie().also { it.setGalleryTheme("Star Wars"); it.loadSets(); it.loadStats() }
        drive("Galerie") { vm.galleryState.value.sets.isNotEmpty() }
        zeige { GalleryRoute(vm = vm, erfassung = erfassung(), imageLoader = bilder, onScanBarcode = {}, onSetClick = {}) }
        compose.onNodeWithContentDescription(ctx.getString(R.string.filter_entfernen, "Star Wars")).performClick()
        compose.waitForIdle()
        assertEquals("Der Chip nimmt den Themenfilter weg", "", vm.galleryState.value.galleryTheme)
    }

    @Test
    fun `minifigures can be sorted`() {
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

    // ── Undo after deleting ──

    @Test
    fun `deleting a part offers undo and deletes only afterwards`() {
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
    fun `deleting a storage location offers undo and deletes only afterwards`() {
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
    fun `deleting a purchase offers undo and deletes only afterwards`() {
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

    // ── One header for part details, one word for „kein Preis“ ──

    /** The image area for tapping (merged with the image), not the indented image inside it. */
    private fun imageHeight(name: String): Float = compose.onAllNodes(hasContentDescription(name))
        .fetchSemanticsNodes().maxOf { it.boundsInRoot.height } / dichte

    @Test
    fun `part without market price says no price yet`() {
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
    fun `part from sets has the same header as a self-added one`() {
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
        // The chip shows the color in the app's language (de-CH), as for the self-added part.
        assertTrue("Kennzahlen als Chips wie beim selbst erfassten Teil",
            compose.onAllNodes(hasText(ctx.getString(R.string.setitem_color) + " Rot", substring = true), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty())
    }
}
