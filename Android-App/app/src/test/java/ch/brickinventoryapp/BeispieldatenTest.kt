package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
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

/**
 * Beispieldaten für Bildschirmfotos und Oberflächentests: ein Testserver mit
 * echten Antworten und die ViewModels der Hauptbildschirme dagegen. Dieser Test
 * prüft auf der JVM, dass jede Liste wirklich ankommt — ein Bildschirmfoto einer
 * leeren Liste zeigte nichts.
 *
 * Gegenprobe (30.10.2026, gemessen): in [Beispiele.ANTWORTEN] den Pfad
 * "/api/v1/wanted" vertippt → rot „jeder Hauptbildschirm bekommt Inhalt“.
 * Gegenproben (01.11.2026, kotlinc): im Detailpreis avg_price 799 statt 812.5 →
 * rot „die Beispiele sind stimmig“; „chart“ aus der Wertentwicklung entfernt →
 * ebenso rot (es blieben die Schweizer Achsentexte des Servers stehen).
 * Gegenproben (02.11.2026, kotlinc): bei den Figuren wieder "name" statt
 * "fig_name" → rot „Teile und Figuren tragen echte Namen“; den Pfad
 * /api/v1/minifigs/stats entfernt → ebenso rot (keine Kennzahlen).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BeispieldatenTest {

    private lateinit var welt: Beispiele.Welt

    @Before
    fun auf() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        welt = Beispiele.Welt()
    }

    @After
    fun zu() {
        welt.close()
        Dispatchers.resetMain()
    }

    @Test
    fun `jeder Hauptbildschirm bekommt Inhalt`() {
        val galerie = welt.galerie().also { it.loadSets() }
        val teile = welt.teile().also { it.loadParts(); it.loadMinifigs() }
        val finanzen = welt.finanzen().also { it.loadValuation() }
        val merkliste = welt.merkliste().also { it.ladeMerkliste() }
        val detail = welt.setDetail().also { it.loadSetDetail(Beispiele.SET) }
        TestApi.warteBis("Galerie") { galerie.galleryState.value.sets.size == 3 }
        TestApi.warteBis("Teile") { teile.partsState.value.parts.isNotEmpty() }
        TestApi.warteBis("Figuren") { teile.partsState.value.minifigs.isNotEmpty() }
        TestApi.warteBis("Finanzen") { finanzen.financeState.value.valuation != null }
        TestApi.warteBis("Merkliste") { merkliste.merklisteState.value.merkposten.isNotEmpty() }
        TestApi.warteBis("Detail") { detail.setDetailState.value.setDetail != null }
        assertEquals("Millennium Falcon", detail.setDetailState.value.setDetail?.name)
        assertTrue(finanzen.financeState.value.valuation!!.sets.isNotEmpty())
    }

    /** Die Fotos von Teilen und Figuren zeigen Namen und Kennzahlen, nicht „Name unbekannt“. */
    @Test
    fun `Teile und Figuren tragen echte Namen`() {
        val teile = welt.teile().also { it.loadParts(); it.loadMinifigs() }
        TestApi.warteBis("Teile und Figuren") { teile.partsState.value.let {
            it.parts.isNotEmpty() && it.minifigs.isNotEmpty() && it.minifigStats.types > 0 } }
        val z = teile.partsState.value
        assertTrue(z.parts.toString(), z.parts.all { !it.partName.isNullOrBlank() })
        assertTrue(z.minifigs.toString(), z.minifigs.all { !it.figName.isNullOrBlank() })
        assertTrue("Ein Name ist lang genug zum Kürzen", z.minifigs.any { (it.figName?.length ?: 0) > 30 })
    }

    /**
     * Dieselben Zahlen auf jedem Bildschirm: ein Foto, auf dem der Falcon in der
     * Galerie anders kostet als im Detail, sähe aus wie ein Fehler der App.
     */
    @Test
    fun `die Beispiele sind stimmig`() {
        val finanzen = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
        val detail = welt.setDetail().also { it.ladeAlles() }
        TestApi.warteBis("Finanzen") { finanzen.financeState.value.let { it.valuation != null && it.historyPoints.isNotEmpty() } }
        TestApi.warteBis("Detail") { detail.setDetailState.value.let { it.setPrice != null && it.acquisitions.isNotEmpty() } }
        val falcon = finanzen.financeState.value.valuation!!.sets.first { it.setNumber == Beispiele.SET }
        assertEquals(falcon.avgPrice, detail.setDetailState.value.setPrice?.avgPrice)
        assertEquals(listOf("CHF"), listOf(welt.t.sitzung.state.value.currency))
        assertTrue("jeder Kauf hat einen Betrag", detail.setDetailState.value.acquisitions.all { it.effectivePrice != null })
        // Die Achse trägt Daten, keine Wochentage — chart.x passt Punkt für Punkt.
        val beschriftet = finanzen.financeState.value.historyPoints.map { it.xLabel }.filter { it.isNotBlank() }
        assertTrue(beschriftet.toString(), beschriftet.size == 2 && beschriftet.none { it in setOf("Mo", "Di", "Mi", "27.10") })
    }
}

/** Ein Testserver mit Beispielantworten und die ViewModels dagegen. */
object Beispiele {
    const val SET = "75192-1"

    val ANTWORTEN = arrayOf(
        // Eine Währung (CHF) und dieselben Preise überall: Der Falcon kostet in Galerie,
        // Detail und Finanzen 812.50, gekauft für 700.00; die Titanic 449.95 je Stück.
        "/api/v1/sets" to """{"success":true,"total":3,"sets":[
            {"set_number":"75192-1","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,"num_parts":7541},
            {"set_number":"10294-1","name":"Titanic","year":2021,"theme":"Icons","quantity":2,"num_parts":9090},
            {"set_number":"21318-1","name":"Baumhaus","year":2019,"theme":"Ideas","quantity":1,"num_parts":3036}]}""",
        "/api/v1/stats" to """{"success":true,"stats":{"total_sets":3,"total_quantity":4,"total_pieces":28757,"total_instructions":2,"total_parts":82,"total_minifigs":2,"set_parts":42,"manual_parts":40}}""",
        "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"1500.00","current":"1712.40","pnl_prozent":14.2},"sets":[
            {"set_number":"75192-1","quantity":1,"current_price":812.5,"baseline_price":700,"pnl_pct":"16.1","kachel_preis":812.5,"kachel_pnl_pct":16.1},
            {"set_number":"10294-1","quantity":2,"current_price":449.95,"baseline_price":400,"pnl_pct":"12.5","kachel_preis":449.95,"kachel_pnl_pct":12.5}]}""",
        "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
            {"set_number":"75192-1","name":"Millennium Falcon","quantity":1,"avg_price":812.5,"qty_avg_price":812.5},
            {"set_number":"10294-1","name":"Titanic","quantity":2,"avg_price":449.95,"qty_avg_price":449.95}],
            "totals":{"min":"1500.00","avg":"1712.40","max":"1900.00","qty_avg":"1712.40"}}""",
        // Wie der Server: x_label in Schweizer Form, chart.x mit den ISO-Tagen derselben Punkte.
        "/api/v1/finance/portfolio-history" to """{"success":true,"currency":"CHF","period":"week","points":[
            {"x_label":"27.10","value":1690.0,"y_frac":0.2},{"x_label":"","value":1701.0,"y_frac":0.5},{"x_label":"29.10","value":1712.4,"y_frac":0.9}],
            "y_axis":[{"label":"CHF 1'680","value":1680.0,"frac":0.0},{"label":"CHF 1'700","value":1700.0,"frac":0.5},{"label":"CHF 1'720","value":1720.0,"frac":1.0}],
            "period_change_pct":1.33,
            "chart":{"values":[{"name":"total","values":[{"x":"2026-10-27","y":1690.0},{"x":"2026-10-28","y":1701.0},{"x":"2026-10-29","y":1712.4}],"firstRealIndex":0}],
                     "x":["2026-10-27","2026-10-28","2026-10-29"]}}""",
        "/api/v1/finance/parts-valuation" to """{"success":true,"currency":"CHF","parts":[],"total_value":"0.00"}""",
        "/api/v1/finance/minifigs-valuation" to """{"success":true,"currency":"CHF","figs":[],"total_value":"0.00"}""",
        // Echte, lange Namen wie im Katalog: Ein Foto voller „Name unbekannt“ zeigte
        // weder Umbruch noch Kürzung.
        "/api/v1/parts" to """{"success":true,"total":3,"parts":[
            {"part_number":"3001","color_id":5,"part_name":"Brick 2 x 4","color_name":"Red","quantity":12},
            {"part_number":"3039","color_id":1,"part_name":"Slope 45 2 x 2 with Bottom Pin","color_name":"Blue","quantity":30},
            {"part_number":"4073","color_id":4,"part_name":"Plate Round 1 x 1 with Solid Stud","color_name":"Trans-Clear","quantity":40}]}""",
        "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
        "/api/v1/parts/stats" to """{"success":true,"stats":{"unique_parts":3,"unique_colors":3,"total_parts":82,"manual_parts":0}}""",
        "/api/v1/minifigs" to """{"success":true,"figs":[
            {"fig_number":"sw0001","fig_name":"Luke Skywalker (Pilot Suit, White Helmet)","quantity":2},
            {"fig_number":"sw0002","fig_name":"Han Solo (Brown Legs with Holster Pattern)","quantity":1}]}""",
        "/api/v1/minifigs/manual" to """{"success":true,"figs":[]}""",
        "/api/v1/minifigs/stats" to """{"success":true,"stats":{"types":2,"total_quantity":3,"manual":0}}""",
        // Drei Fälle der Merkliste: mit Preis und Alarm, ohne Preis („Preis folgt“), schon vorhanden.
        "/api/v1/wanted" to """{"success":true,"merkposten":[
            {"set_number":"10305-1","name":"Lion Knights' Castle","year":2022,"condition":"N","user_id":1,
             "marktpreis":399.9,"waehrung":"CHF","alarm":{"richtung":"unter","schwelle":349.0,"ausgeloest":false}},
            {"set_number":"42115-1","name":"Lamborghini Sián FKP 37","year":2020,"condition":"U","user_id":1,"waehrung":"CHF"},
            {"set_number":"10294-1","name":"Titanic","year":2021,"condition":"N","user_id":1,"marktpreis":449.95,"waehrung":"CHF","owned":true}]}""",
        "/api/v1/sets/75192-1" to """{"success":true,"quantity":1,"set":{"set_number":"75192-1","name":"Millennium Falcon","year":2017,
            "theme":"Star Wars","quantity":1,"num_parts":7541,"minifigs":7,"added_at":"2026-03-14T10:00:00Z","avg_purchase_price":700.0}}""",
        "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1","currency":"CHF","avg_price":812.5,"min_price":760.0,"max_price":880.0,"qty_avg_price":812.5}""",
        "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1","currency":"CHF",
            "by_condition":{"N":{"market_price":812.5,"purchase_price":700.0,"pnl_pct":16.1}},
            "chart":{"values":[{"name":"N","values":[{"x":"2026-08-01","y":790.0},{"x":"2026-09-01","y":801.0},{"x":"2026-10-01","y":812.5}],"firstRealIndex":0}],
                     "x":["2026-08-01","2026-09-01","2026-10-01"]},
            "pnl_prozent":16.1,"purchase_price":700.0}""",
        "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[
            {"id":1,"quantity":1,"purchase_price":700.0,"condition":"N","currency":"CHF","created_at":"2026-03-14T10:00:00Z"}]}""",
        "/api/v1/sets/75192-1/alert" to """{"success":true,"alerts":[]}""",
    )

    /** Ein eigener Server je Test; [close] räumt ihn wieder ab. */
    class Welt(texte: ch.brickinventoryapp.ui.viewmodel.Texte = NummernTexte) : AutoCloseable {
        val pfade = PfadServer(*ANTWORTEN)
        val t = TestDienste(pfade.server, texte).also { d -> d.sitzung.aendere { it.copy(currency = "CHF") } }

        fun galerie() = t.merke(GalerieViewModel(t.dienste, SetsRepository(t.api, t.cache),
            FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        fun teile() = t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), FigurenRepository(t.api, t.cache), SavedStateHandle()))
        fun finanzen() = t.merke(FinanzViewModel(t.dienste, FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        fun merkliste() = t.merke(MerklisteViewModel(t.dienste, SetsRepository(t.api, t.cache),
            KatalogRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        fun setDetail() = t.merke(SetDetailViewModel(t.dienste, SetsRepository(t.api, t.cache),
            FinanzenRepository(t.api, t.cache), HaushaltRepository(t.api, t.cache),
            object : DateiLeser { override suspend fun lies(uri: android.net.Uri): Pair<String?, ByteArray>? = null },
            SavedStateHandle(mapOf("setNumber" to SET))))

        override fun close() {
            t.aufraeumen()
            pfade.server.shutdown()
        }
    }
}
