package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
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
}

/** Ein Testserver mit Beispielantworten und die ViewModels dagegen. */
object Beispiele {
    const val SET = "75192-1"

    val ANTWORTEN = arrayOf(
        "/api/v1/sets" to """{"success":true,"total":3,"sets":[
            {"set_number":"75192-1","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,"num_parts":7541},
            {"set_number":"10294-1","name":"Titanic","year":2021,"theme":"Icons","quantity":2,"num_parts":9090},
            {"set_number":"21318-1","name":"Baumhaus","year":2019,"theme":"Ideas","quantity":1,"num_parts":3036}]}""",
        "/api/v1/stats" to """{"success":true,"stats":{"total_sets":3,"total_quantity":4,"total_pieces":28757}}""",
        "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"1450.00","current":"1712.40","pnl_prozent":18.1},"sets":[
            {"set_number":"75192-1","quantity":1,"current_price":812.5,"baseline_price":700,"pnl_pct":"16.1","kachel_preis":812.5,"kachel_pnl_pct":16.1}]}""",
        "/api/v1/finance/valuation" to """{"success":true,"currency":"CHF","sets":[
            {"set_number":"75192-1","name":"Millennium Falcon","quantity":1,"avg_price":812.5,"qty_avg_price":812.5},
            {"set_number":"10294-1","name":"Titanic","quantity":2,"avg_price":449.95,"qty_avg_price":899.9}],
            "totals":{"min":"1500.00","avg":"1712.40","max":"1900.00","qty_avg":"1712.40"}}""",
        "/api/v1/finance/portfolio-history" to """{"success":true,"currency":"CHF","period":"week","points":[
            {"x_label":"Mo","value":1690.0,"y_frac":0.2},{"x_label":"Di","value":1701.0,"y_frac":0.5},{"x_label":"Mi","value":1712.4,"y_frac":0.9}]}""",
        "/api/v1/finance/parts-valuation" to """{"success":true,"parts":[]}""",
        "/api/v1/finance/minifigs-valuation" to """{"success":true,"figs":[]}""",
        "/api/v1/parts" to """{"success":true,"total":2,"parts":[
            {"part_number":"3001","color_id":5,"name":"Brick 2 x 4","color_name":"Red","quantity":12},
            {"part_number":"3003","color_id":1,"name":"Brick 2 x 2","color_name":"Blue","quantity":30}]}""",
        "/api/v1/parts/manual" to """{"success":true,"parts":[]}""",
        "/api/v1/parts/stats" to """{"success":true}""",
        "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001","name":"Luke Skywalker","quantity":1}]}""",
        "/api/v1/wanted" to """{"success":true,"merkposten":[
            {"set_number":"10294-1","name":"Titanic","condition":"N","user_id":1},
            {"set_number":"21318-1","name":"Baumhaus","condition":"U","user_id":1}]}""",
        "/api/v1/sets/75192-1" to """{"success":true,"quantity":2,"set":{"set_number":"75192-1","name":"Millennium Falcon","year":2017,"quantity":2,"num_parts":7541}}""",
        "/api/v1/sets/75192-1/price" to """{"success":true,"set_number":"75192-1"}""",
        "/api/v1/sets/75192-1/price-history" to """{"success":true,"set_number":"75192-1"}""",
        "/api/v1/sets/75192-1/acquisitions" to """{"success":true,"acquisitions":[{"id":1,"quantity":2}]}""",
        "/api/v1/sets/75192-1/alert" to """{"success":true,"alerts":[]}""",
    )

    /** Ein eigener Server je Test; [close] räumt ihn wieder ab. */
    class Welt : AutoCloseable {
        val pfade = PfadServer(*ANTWORTEN)
        val t = TestDienste(pfade.server)

        fun galerie() = t.merke(GalerieViewModel(t.dienste, SetsRepository(t.api, t.cache),
            FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        fun teile() = t.merke(TeileViewModel(t.dienste, TeileRepository(t.api, t.cache), SavedStateHandle()))
        fun finanzen() = t.merke(FinanzViewModel(t.dienste, FinanzenRepository(t.api, t.cache), SavedStateHandle()))
        fun merkliste() = t.merke(MerklisteViewModel(t.dienste, SetsRepository(t.api, t.cache),
            AdminRepository(t.api, t.cache), FinanzenRepository(t.api, t.cache), SavedStateHandle()))
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
