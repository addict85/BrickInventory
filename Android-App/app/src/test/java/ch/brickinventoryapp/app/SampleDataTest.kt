package ch.brickinventoryapp.app

import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import ch.brickinventoryapp.model.domain.Waehrung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.testing.testMinifigsRepository
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.testHouseholdRepository
import ch.brickinventoryapp.testing.testCatalogRepository
import ch.brickinventoryapp.testing.testSetsRepository
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import ch.brickinventoryapp.finances.ui.finanzSummen
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import java.util.Locale
import ch.brickinventoryapp.testing.NumbersTexts
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Sample data for screenshots and UI tests: a PfadServer in ticks with
 * real responses and the ViewModels of the main screens against it. This test
 * checks on the JVM that every list really arrives — a screenshot of an
 * empty list showed nothing.
 *
 * Counter-check: in [Examples.RESPONSES] the path
 * "/api/v1/wanted" mistyped → red “every main screen gets content“.
 * Counter-checks: in the detail price avg_price 799 instead of 812.5 →
 * red “the samples are consistent“; „chart“ removed from the value development →
 * red as well (the server's Swiss axis texts stayed).
 * Counter-checks: for the figures again "name" instead of
 * "fig_name" → red “parts and figures carry real names“; the path
 * /api/v1/minifigs/stats removed → red as well (no key figures).
 * Counter-checks: for the Falcon every "wert_gesamt" removed → red
 * “every finance row carries …” (wert=null); in the FinanceViewModel the points again
 * translated with Locale.getDefault() when loading → red “the finance axis is formatted
 * only when drawing” ([10/27, , 10/29]) and “the samples are consistent“.
 * Counter-check: for the parts again "quantity" instead of
 * "total_quantity" → red “the parts tiles add up to the total“ (82 against 0).
 * Counter-check: for part 3039 "image_local" removed → red
 * “every tile has a sample image“ ([(3039, null)]).
 * Counter-check: the tree house removed from
 * /finance/valuation → red “every finance row carries …” (2 instead of 3 rows).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SampleDataTest {

    private lateinit var world: Examples.Welt

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        world = Examples.Welt()
    }

    @After
    fun zu() {
        world.close()
        Dispatchers.resetMain()
    }

    /** In ticks everything is already loaded when the call returns. */
    private fun da(was: String, bedingung: () -> Boolean) = assertTrue(was, bedingung())

    @Test
    fun `every main screen gets content`() {
        val galerie = world.galerie().also { it.loadSets() }
        val teile = world.teile().also { it.loadParts() }
        val figuren = world.figuren().also { it.loadMinifigs() }
        val finanzen = world.finanzen().also { it.loadValuation() }
        val merkliste = world.merkliste().also { it.loadWanted() }
        val detail = world.setDetail()
        da("Galerie") { galerie.galleryState.value.sets.size == 3 }
        da("Teile") { teile.teileState.value.parts.isNotEmpty() }
        da("Figuren") { figuren.minifigsState.value.minifigs.isNotEmpty() }
        da("Finanzen") { finanzen.financeState.value.valuation != null }
        da("Merkliste") { merkliste.wantedState.value.merkposten.isNotEmpty() }
        da("Detail") { detail.setDetailState.value.setDetail != null }
        assertEquals("Millennium Falcon", detail.setDetailState.value.setDetail?.name)
        assertTrue(finanzen.financeState.value.valuation!!.sets.isNotEmpty())
    }

    /** The photos of parts and figures show names and key figures, not „Name unbekannt“. */
    @Test
    fun `parts and figures carry real names`() {
        val teile = world.teile().also { it.loadParts() }
        val figuren = world.figuren().also { it.loadMinifigs() }
        da("Teile und Figuren") { teile.teileState.value.parts.isNotEmpty() && figuren.minifigsState.value.let {
            it.minifigs.isNotEmpty() && it.minifigStats.types > 0 } }
        val z = teile.teileState.value
        val f = figuren.minifigsState.value
        assertTrue(z.parts.toString(), z.parts.all { !it.partName.isNullOrBlank() })
        assertTrue(f.minifigs.toString(), f.minifigs.all { !it.figName.isNullOrBlank() })
        assertTrue("Ein Name ist lang genug zum Kürzen", f.minifigs.any { (it.figName?.length ?: 0) > 30 })
    }

    /**
     * The same numbers on every screen: a photo on which the Falcon costs differently
     * in the gallery than in the detail would look like an error of the app.
     */
    @Test
    fun `the samples are consistent`() {
        val finanzen = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        val detail = world.setDetail()
        da("Finanzen") { finanzen.financeState.value.let { it.valuation != null && it.historyPoints.isNotEmpty() } }
        da("Detail") { detail.setDetailState.value.let { it.setPrice != null && it.acquisitions.isNotEmpty() } }
        val falcon = finanzen.financeState.value.valuation!!.sets.first { it.setNumber == Examples.SET }
        assertEquals(falcon.avgPrice, detail.setDetailState.value.setPrice?.avgPrice)
        assertEquals(listOf(Waehrung.CHF), listOf(world.t.sitzung.state.value.currency))
        assertTrue("jeder Kauf hat einen Betrag", detail.setDetailState.value.acquisitions.all { it.effectivePrice != null })
        // The axis carries dates, not weekdays — chart.x matches point by point, and
        // translating happens only in the display language.
        val f = finanzen.financeState.value
        val de = localAxis(f.historyPoints, f.historyDays, Locale.forLanguageTag("de-CH"))
        val en = localAxis(f.historyPoints, f.historyDays, Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("27.10.", "29.10."), de.map { it.xLabel }.filter { it.isNotBlank() })
        assertEquals(listOf("27 Oct", "29 Oct"), en.map { it.xLabel }.filter { it.isNotBlank() })
    }

    /**
     * The state holds the axis raw; formatting happens when drawing. If text in the
     * language of loading already stood there, a language switch would keep showing the old form.
     */
    @Test
    fun `the finance axis is formatted only when drawing`() {
        val vorher = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            val finanzen = world.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            da("Verlauf") { finanzen.financeState.value.historyPoints.isNotEmpty() }
            val f = finanzen.financeState.value
            assertEquals(listOf("27.10", "", "29.10"), f.historyPoints.map { it.xLabel })
            assertEquals(Waehrung.CHF, f.historyCurrency)
            val y = localValues(f.historyYAxis, f.historyCurrency!!, Locale.forLanguageTag("de-CH"))
            val label = y.last().label.replace(' ', ' ')
            assertTrue(label, label == "CHF 1’720" || label == "CHF 1'720")
        } finally {
            Locale.setDefault(vorher)
        }
    }

    /**
     * Every tile of the photos shows an image: its address names a sample image that
     * SampleImages delivers without network. Otherwise the placeholder would stand everywhere.
     */
    @Test
    fun `every tile has a sample image`() {
        val galerie = world.galerie().also { it.loadSets() }
        val teile = world.teile().also { it.loadParts() }
        val figuren = world.figuren().also { it.loadMinifigs() }
        val merkliste = world.merkliste().also { it.loadWanted() }
        val finanzen = world.finanzen().also { it.loadValuation() }
        da("alles") {
            galerie.galleryState.value.sets.isNotEmpty() && teile.teileState.value.parts.isNotEmpty() &&
                figuren.minifigsState.value.minifigs.isNotEmpty() && merkliste.wantedState.value.merkposten.isNotEmpty() &&
                finanzen.financeState.value.valuation != null
        }
        val adressen = galerie.galleryState.value.sets.map { it.setNumber to it.imageLocal } +
            teile.teileState.value.parts.map { it.partNumber to it.imageLocal } +
            figuren.minifigsState.value.minifigs.map { it.figNumber to it.imageLocal } +
            merkliste.wantedState.value.merkposten.map { it.setNumber to it.imageLocal } +
            finanzen.financeState.value.valuation!!.sets.map { it.setNumber to it.imageLocal }
        val ohne = adressen.filter { (_, a) -> a == null || SampleImages.resource(a) == null }
        assertTrue("Ohne Beispielbild: $ohne", adressen.size >= 12 && ohne.isEmpty())
    }

    /**
     * The quantities of the parts tiles add up to the key figure „Stück gesamt“ — a photo with
     * „82“ at the top and „×1“ on every tile looked like a calculation error.
     */
    @Test
    fun `the parts tiles add up to the total`() {
        val teile = world.teile().also { it.loadParts() }
        da("Teile") { teile.teileState.value.let { it.parts.isNotEmpty() && it.partsStats != null } }
        val z = teile.teileState.value
        assertEquals(z.partsStats!!.teileGesamt, z.parts.sumOf { it.totalQuantity })
    }

    /**
     * The finance photo shows the normal case: every set row with market value, purchase price,
     * condition and P&L, and the rows together add up to the header tile.
     */
    @Test
    fun `every finance row carries price, purchase price, condition and P&L`() {
        val finanzen = world.finanzen().also { it.loadValuation() }
        da("Finanzen") { finanzen.financeState.value.let { it.valuation != null && it.pnl != null } }
        val z = finanzen.financeState.value
        val zeilen = setRows(z.valuation!!.sets).map { it.second }
        // Two valued rows and the tree house without market price — the case of the basis row.
        assertEquals(3, zeilen.size)
        val valued = zeilen.filter { it.wert != null }
        assertEquals(2, valued.size)
        assertTrue(valued.toString(), valued.all { it.kaufpreis != null && it.zustand != null && it.pnlProzent != null })
        assertTrue("ohne Marktpreis, mit Kaufpreis", zeilen.single { it.wert == null }.kaufpreis != null)
        val kopf = finanzSummen(z.valuation!!, z.partsValuation, z.figsValuation, z.pnl).gesamt
        assertEquals(0, kopf.compareTo(valued.sumOf { it.wert!!.asBigDecimal() }))
    }
}

/** A test server with sample responses and the ViewModels against it. */
object Examples {
    const val SET = "75192-1"

    val RESPONSES = arrayOf(
        // One currency (CHF) and the same prices everywhere: the Falcon costs 812.50 in gallery,
        // detail and finances, bought for 700.00; the Titanic 449.95 per piece.
        "/api/v1/sets" to """{"success":true,"total":3,"sets":[
            {"set_number":"75192-1","image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,"num_parts":7541},
            {"set_number":"10294-1","image_local":"/beispiel/set2.png","name":"Titanic","year":2021,"theme":"Icons","quantity":2,"num_parts":9090},
            {"set_number":"21318-1","image_local":"/beispiel/set3.png","name":"Baumhaus","year":2019,"theme":"Ideas","quantity":1,"num_parts":3036}]}""",
        "/api/v1/stats" to """{"success":true,"stats":{"total_sets":3,"total_quantity":4,"total_pieces":28757,"total_instructions":2,"total_parts":82,"total_minifigs":3,"set_parts":42,"manual_parts":40}}""",
        // The tree house has no market price yet: the header card computes over the two
        // other positions (1500 + 212.40 = 1712.40) and names it in the basis row, the
        // gallery tile shows its purchase price as such (kachel_quelle "kauf").
        "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"1680.00","current":"1712.40","pnl_prozent":14.2,
            "grand_total":"1712.40","sets_purchase":"1680.00","positionen":3,"positionen_bewertet":2,"positionen_ohne_marktpreis":1,
            "positionen_ohne_kaufpreis":0,"basis_einstand":"1500.00","basis_marktwert":"1712.40","basis_guv_betrag":"212.40",
            "ohne_marktpreis_einstand":"180.00","ohne_kaufpreis_marktwert":"0.00"},"sets":[
            {"set_number":"75192-1","quantity":1,"current_price":812.5,"baseline_price":700,"pnl_pct":"16.1","kachel_preis":812.5,"kachel_pnl_pct":16.1,"kachel_quelle":"markt"},
            {"set_number":"10294-1","quantity":2,"current_price":449.95,"baseline_price":400,"pnl_pct":"12.5","kachel_preis":449.95,"kachel_pnl_pct":12.5,"kachel_quelle":"markt"},
            {"set_number":"21318-1","quantity":1,"current_price":null,"baseline_price":180,"kachel_preis":180.0,"kachel_pnl_pct":null,"kachel_quelle":"kauf"}]}""",
        // Like the server (finances/rechnung/bewertung.ts): wert_gesamt, purchase price, P&L and
        // one row per acquisition with condition. Without wert_gesamt every row shows „noch
        // kein Preis“ below a filled header tile.
        "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
            {"set_number":"75192-1","image_local":"/beispiel/set1.png","name":"Millennium Falcon","quantity":1,"avg_price":812.5,"qty_avg_price":812.5,
             "min_price":760.0,"max_price":880.0,"total_avg":"812.50","wert_gesamt":812.5,"purchase_price":700.0,"pnl_prozent":16.1,
             "acquisitions":[{"id":1,"condition":"N","quantity":1,"purchase_price":700.0,"avg_price":812.5,
                              "total_avg":"812.50","wert_gesamt":812.5,"pnl_prozent":16.1}]},
            {"set_number":"10294-1","image_local":"/beispiel/set2.png","name":"Titanic","quantity":2,"avg_price":449.95,"qty_avg_price":449.95,
             "min_price":420.0,"max_price":480.0,"total_avg":"899.90","wert_gesamt":899.9,"purchase_price":400.0,"pnl_prozent":12.5,
             "acquisitions":[{"id":2,"condition":"N","quantity":2,"purchase_price":400.0,"avg_price":449.95,
                              "total_avg":"899.90","wert_gesamt":899.9,"pnl_prozent":12.5}]},
            {"set_number":"21318-1","image_local":"/beispiel/set3.png","name":"Baumhaus","quantity":1,"purchase_price":180.0,"no_price":true,
             "acquisitions":[{"id":3,"condition":"N","quantity":1,"purchase_price":180.0}]}],
            "totals":{"min":"1600.00","avg":"1712.40","max":"1840.00","qty_avg":"1712.40"}}""",
        // Like the server: x_label in Swiss form, chart.x with the ISO days of the same points.
        "/api/v1/finance/portfolio-history" to """{"success":true,"currency":"CHF","period":"week","points":[
            {"x_label":"27.10","value":1690.0,"y_frac":0.2},{"x_label":"","value":1701.0,"y_frac":0.5},{"x_label":"29.10","value":1712.4,"y_frac":0.9}],
            "y_axis":[{"label":"CHF 1'680","value":1680.0,"frac":0.0},{"label":"CHF 1'700","value":1700.0,"frac":0.5},{"label":"CHF 1'720","value":1720.0,"frac":1.0}],
            "period_change_pct":1.33,
            "chart":{"values":[{"name":"total","values":[{"x":"2026-10-27","y":1690.0},{"x":"2026-10-28","y":1701.0},{"x":"2026-10-29","y":1712.4}],"firstRealIndex":0}],
                     "x":["2026-10-27","2026-10-28","2026-10-29"]}}""",
        "/api/v1/finance/parts-valuation" to """{"success":true,"currency":"CHF","parts":[],"total_value":"0.00"}""",
        "/api/v1/finance/minifigs-valuation" to """{"success":true,"currency":"CHF","figs":[],"total_value":"0.00"}""",
        // Real, long names as in the catalog: a photo full of „Name unbekannt“ showed
        // neither wrapping nor truncation.
        "/api/v1/parts" to """{"success":true,"total":3,"parts":[
            {"part_number":"3001","image_local":"/beispiel/teil1.png","color_id":5,"part_name":"Brick 2 x 4","color_name":"Red","total_quantity":12},
            {"part_number":"3039","image_local":"/beispiel/teil2.png","color_id":1,"part_name":"Slope 45 2 x 2 with Bottom Pin","color_name":"Blue","total_quantity":30},
            {"part_number":"4073","image_local":"/beispiel/teil3.png","color_id":4,"part_name":"Plate Round 1 x 1 with Solid Stud","color_name":"Trans-Clear","total_quantity":40}]}""",
        "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
        "/api/v1/parts/stats" to """{"success":true,"stats":{"unique_parts":3,"unique_colors":3,"total_parts":82,"manual_parts":0}}""",
        "/api/v1/minifigs" to """{"success":true,"figs":[
            {"fig_number":"sw0001","image_local":"/beispiel/figur1.png","fig_name":"Luke Skywalker (Pilot Suit, White Helmet)","quantity":2},
            {"fig_number":"sw0002","image_local":"/beispiel/figur2.png","fig_name":"Han Solo (Brown Legs with Holster Pattern)","quantity":1}]}""",
        "/api/v1/minifigs/manual" to """{"success":true,"figs":[]}""",
        "/api/v1/minifigs/stats" to """{"success":true,"stats":{"types":2,"total_quantity":3,"manual":0}}""",
        // Three wishlist cases: with price and alert, without price („Preis folgt“), already present.
        "/api/v1/wanted" to """{"success":true,"merkposten":[
            {"set_number":"10305-1","image_local":"/beispiel/set1.png","name":"Lion Knights' Castle","year":2022,"condition":"N","user_id":1,"created_at":"2026-08-21T09:00:00Z",
             "marktpreis":399.9,"waehrung":"CHF","alarm":{"direction":"unter","threshold":349.0,"triggered":false}},
            {"set_number":"42115-1","image_local":"/beispiel/set3.png","name":"Lamborghini Sián FKP 37","year":2020,"condition":"U","user_id":1,"created_at":"2026-09-05T18:30:00Z","waehrung":"CHF"},
            {"set_number":"10294-1","image_local":"/beispiel/set2.png","name":"Titanic","year":2021,"condition":"N","user_id":1,"created_at":"2026-10-12T07:15:00Z","marktpreis":449.95,"waehrung":"CHF","owned":true}]}""",
        "/api/v1/sets/75192-1" to """{"success":true,"quantity":1,"set":{"set_number":"75192-1","image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,
            "theme":"Star Wars","quantity":1,"num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":700.0}}""",
        "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":812.5,"min_price":760.0,"max_price":880.0,"qty_avg_price":812.5}""",
        "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":812.5,"purchase_price":700.0,"pnl_pct":"16.1","pnl_prozent":16.1}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":790.0},{"x":"2026-09-01","y":801.0},{"x":"2026-10-01","y":812.5}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]},
            "pnl_prozent":16.1,"purchase_price":700.0}""",
        "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":700.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}""",
        "/api/v1/sets/75192-1/alert" to """{"success":true,"alerts":[]}""",
    )

    /** One server per test; [close] tears it down again. */
    class Welt(texts: Texte = NumbersTexts) : AutoCloseable {
        val paths = PfadServer(*RESPONSES)
        val t = TestDienste(paths.imTakt(), texts, io = Dispatchers.Main).also { d -> d.sitzung.waehrungUebernommen(Waehrung.CHF) }

        fun galerie() = t.merke(GalleryViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testSetsRepository(t.api),
            t.kontosicht, testFinancesRepository(t.api), SavedStateHandle()))
        fun teile() = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht, SavedStateHandle()))
        fun figuren() = t.merke(MinifigsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, testMinifigsRepository(t.api), t.kontosicht, SavedStateHandle()))
        fun finanzen() = t.merke(FinanceViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, testFinancesRepository(t.api), SavedStateHandle()))
        fun merkliste() = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alerts(), t.kontosicht,
            testCatalogRepository(t.api), testFinancesRepository(t.api), SavedStateHandle()))
        fun setDetail() = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
            testFinancesRepository(t.api), testHouseholdRepository(t.api),
            object : FileReader { override suspend fun lies(datei: FileRef): Pair<String?, ByteArray>? = null },
            SavedStateHandle(mapOf("setNumber" to SET))))

        /** The build list without network: [resolve] delivers name and parts per set number. */
        fun bauliste(resolve: (String) -> Pair<String, List<PlPart>> = { error("nichts aufzulösen") }) =
            t.merke(PartListViewModel(t.sitzung, t.hinweise, object : PartListsSource {
                override suspend fun resolveSetOn(setNumber: String, serverUrl: String) = resolve(setNumber)
                override suspend fun withInventory(teile: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean) = teile
                override fun sortiert(teile: Collection<PlPart>) = teile.toList()
            }, object : PartListsExport {
                override val fortschritt = flowOf<PdfProgress?>(null)
                override suspend fun erzeuge(job: Teilelistenauftrag): ExportResult =
                    ExportResult.Fehler(PdfFailure.Abruf(Ergebnis.Fehler.Netz()))
            }, SavedStateHandle()))

        override fun close() {
            t.aufraeumen()
            paths.server.shutdown()
        }
    }
}
