package ch.brickinventoryapp.app

import ch.brickinventoryapp.vertrag.PdfAuftragAnfrage
import ch.brickinventoryapp.model.fach.Waehrung
import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.repository.KatalogRepository
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.KatalogRepository
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.GalerieViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.teile.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.teile.ui.TeilelistenQuelle
import ch.brickinventoryapp.teile.ui.PlPart
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.ExportErgebnis
import ch.brickinventoryapp.data.service.TeilelistenExport
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.teile.ui.viewmodel.TeilelisteViewModel
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
import ch.brickinventoryapp.finanzen.ui.finanzSummen
import ch.brickinventoryapp.gemeinsam.ui.lokaleAchse
import ch.brickinventoryapp.gemeinsam.ui.lokaleWerte
import ch.brickinventoryapp.finanzen.ui.setZeilen
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import java.math.BigDecimal
import java.util.Locale
import ch.brickinventoryapp.testing.NummernTexte
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.TestDienste

/**
 * Beispieldaten für Bildschirmfotos und Oberflächentests: ein PfadServer im Takt mit
 * echten Antworten und die ViewModels der Hauptbildschirme dagegen. Dieser Test
 * prüft auf der JVM, dass jede Liste wirklich ankommt — ein Bildschirmfoto einer
 * leeren Liste zeigte nichts.
 *
 * Gegenprobe: in [Beispiele.ANTWORTEN] den Pfad
 * "/api/v1/wanted" vertippt → rot „jeder Hauptbildschirm bekommt Inhalt“.
 * Gegenproben: im Detailpreis avg_price 799 statt 812.5 →
 * rot „die Beispiele sind stimmig“; „chart“ aus der Wertentwicklung entfernt →
 * ebenso rot (es blieben die Schweizer Achsentexte des Servers stehen).
 * Gegenproben: bei den Figuren wieder "name" statt
 * "fig_name" → rot „Teile und Figuren tragen echte Namen“; den Pfad
 * /api/v1/minifigs/stats entfernt → ebenso rot (keine Kennzahlen).
 * Gegenproben: beim Falcon jedes "wert_gesamt" entfernt → rot
 * „jede Finanzzeile trägt …“ (wert=null); im FinanzViewModel die Punkte wieder beim
 * Laden mit Locale.getDefault() übersetzt → rot „die Finanzachse wird erst beim
 * Zeichnen formatiert“ ([10/27, , 10/29]) und „die Beispiele sind stimmig“.
 * Gegenprobe: bei den Teilen wieder "quantity" statt
 * "total_quantity" → rot „die Teilekacheln ergeben die Gesamtzahl“ (82 gegen 0).
 * Gegenprobe: beim Teil 3039 "image_local" entfernt → rot
 * „jede Kachel hat ein Beispielbild“ ([(3039, null)]).
 * Gegenprobe: das Baumhaus aus
 * /finance/valuation entfernt → rot „jede Finanzzeile trägt …“ (2 statt 3 Zeilen).
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

    /** Im Takt ist alles schon geladen, wenn der Aufruf zurückkehrt. */
    private fun da(was: String, bedingung: () -> Boolean) = assertTrue(was, bedingung())

    @Test
    fun `jeder Hauptbildschirm bekommt Inhalt`() {
        val galerie = welt.galerie().also { it.loadSets() }
        val teile = welt.teile().also { it.loadParts(); it.loadMinifigs() }
        val finanzen = welt.finanzen().also { it.loadValuation() }
        val merkliste = welt.merkliste().also { it.ladeMerkliste() }
        val detail = welt.setDetail()
        da("Galerie") { galerie.galleryState.value.sets.size == 3 }
        da("Teile") { teile.partsState.value.parts.isNotEmpty() }
        da("Figuren") { teile.partsState.value.minifigs.isNotEmpty() }
        da("Finanzen") { finanzen.financeState.value.valuation != null }
        da("Merkliste") { merkliste.merklisteState.value.merkposten.isNotEmpty() }
        da("Detail") { detail.setDetailState.value.setDetail != null }
        assertEquals("Millennium Falcon", detail.setDetailState.value.setDetail?.name)
        assertTrue(finanzen.financeState.value.valuation!!.sets.isNotEmpty())
    }

    /** Die Fotos von Teilen und Figuren zeigen Namen und Kennzahlen, nicht „Name unbekannt“. */
    @Test
    fun `Teile und Figuren tragen echte Namen`() {
        val teile = welt.teile().also { it.loadParts(); it.loadMinifigs() }
        da("Teile und Figuren") { teile.partsState.value.let {
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
        val detail = welt.setDetail()
        da("Finanzen") { finanzen.financeState.value.let { it.valuation != null && it.historyPoints.isNotEmpty() } }
        da("Detail") { detail.setDetailState.value.let { it.setPrice != null && it.acquisitions.isNotEmpty() } }
        val falcon = finanzen.financeState.value.valuation!!.sets.first { it.setNumber == Beispiele.SET }
        assertEquals(falcon.avgPrice, detail.setDetailState.value.setPrice?.avgPrice)
        assertEquals(listOf(Waehrung.CHF), listOf(welt.t.sitzung.state.value.currency))
        assertTrue("jeder Kauf hat einen Betrag", detail.setDetailState.value.acquisitions.all { it.effectivePrice != null })
        // Die Achse trägt Daten, keine Wochentage — chart.x passt Punkt für Punkt, und
        // übersetzt wird erst in der Sprache der Anzeige.
        val f = finanzen.financeState.value
        val de = lokaleAchse(f.historyPoints, f.historyTage, Locale.forLanguageTag("de-CH"))
        val en = lokaleAchse(f.historyPoints, f.historyTage, Locale.forLanguageTag("en-GB"))
        assertEquals(listOf("27.10.", "29.10."), de.map { it.xLabel }.filter { it.isNotBlank() })
        assertEquals(listOf("27 Oct", "29 Oct"), en.map { it.xLabel }.filter { it.isNotBlank() })
    }

    /**
     * Der Zustand hält die Achse roh; formatiert wird beim Zeichnen. Stünde dort schon
     * Text in der Sprache des Ladens, zeigte ein Sprachwechsel die alte Form weiter.
     */
    @Test
    fun `die Finanzachse wird erst beim Zeichnen formatiert`() {
        val vorher = Locale.getDefault()
        Locale.setDefault(Locale.US)
        try {
            val finanzen = welt.finanzen().also { it.loadValuation(); it.loadPortfolioHistory("week") }
            da("Verlauf") { finanzen.financeState.value.historyPoints.isNotEmpty() }
            val f = finanzen.financeState.value
            assertEquals(listOf("27.10", "", "29.10"), f.historyPoints.map { it.xLabel })
            assertEquals(Waehrung.CHF, f.historyWaehrung)
            val y = lokaleWerte(f.historyYAxis, f.historyWaehrung!!, Locale.forLanguageTag("de-CH"))
            val label = y.last().label.replace(' ', ' ')
            assertTrue(label, label == "CHF 1’720" || label == "CHF 1'720")
        } finally {
            Locale.setDefault(vorher)
        }
    }

    /**
     * Jede Kachel der Fotos zeigt ein Bild: Ihre Adresse nennt ein Beispielbild, das
     * Beispielbilder ohne Netz liefert. Sonst stünde überall der Platzhalter.
     */
    @Test
    fun `jede Kachel hat ein Beispielbild`() {
        val galerie = welt.galerie().also { it.loadSets() }
        val teile = welt.teile().also { it.loadParts(); it.loadMinifigs() }
        val merkliste = welt.merkliste().also { it.ladeMerkliste() }
        val finanzen = welt.finanzen().also { it.loadValuation() }
        da("alles") {
            galerie.galleryState.value.sets.isNotEmpty() && teile.partsState.value.parts.isNotEmpty() &&
                teile.partsState.value.minifigs.isNotEmpty() && merkliste.merklisteState.value.merkposten.isNotEmpty() &&
                finanzen.financeState.value.valuation != null
        }
        val adressen = galerie.galleryState.value.sets.map { it.setNumber to it.imageLocal } +
            teile.partsState.value.parts.map { it.partNumber to it.imageLocal } +
            teile.partsState.value.minifigs.map { it.figNumber to it.imageLocal } +
            merkliste.merklisteState.value.merkposten.map { it.setNumber to it.imageLocal } +
            finanzen.financeState.value.valuation!!.sets.map { it.setNumber to it.imageLocal }
        val ohne = adressen.filter { (_, a) -> a == null || Beispielbilder.ressource(a) == null }
        assertTrue("Ohne Beispielbild: $ohne", adressen.size >= 12 && ohne.isEmpty())
    }

    /**
     * Die Mengen der Teilekacheln ergeben die Kennzahl „Stück gesamt“ — ein Foto mit
     * „82“ oben und „×1“ an jeder Kachel sah aus wie ein Rechenfehler.
     */
    @Test
    fun `die Teilekacheln ergeben die Gesamtzahl`() {
        val teile = welt.teile().also { it.loadParts() }
        da("Teile") { teile.partsState.value.let { it.parts.isNotEmpty() && it.partsStats != null } }
        val z = teile.partsState.value
        assertEquals(z.partsStats!!.teileGesamt, z.parts.sumOf { it.totalQuantity })
    }

    /**
     * Das Finanzfoto zeigt den Normalfall: jede Set-Zeile mit Marktwert, Kaufpreis,
     * Zustand und G&V, und die Zeilen ergeben zusammen die Kopfkachel.
     */
    @Test
    fun `jede Finanzzeile trägt Preis, Kaufpreis, Zustand und G&V`() {
        val finanzen = welt.finanzen().also { it.loadValuation() }
        da("Finanzen") { finanzen.financeState.value.let { it.valuation != null && it.pnl != null } }
        val z = finanzen.financeState.value
        val zeilen = setZeilen(z.valuation!!.sets).map { it.second }
        // Zwei bewertete Zeilen und das Baumhaus ohne Marktpreis — der Fall der Basiszeile.
        assertEquals(3, zeilen.size)
        val bewertet = zeilen.filter { it.wert != null }
        assertEquals(2, bewertet.size)
        assertTrue(bewertet.toString(), bewertet.all { it.kaufpreis != null && it.zustand != null && it.pnlProzent != null })
        assertTrue("ohne Marktpreis, mit Kaufpreis", zeilen.single { it.wert == null }.kaufpreis != null)
        val kopf = finanzSummen(z.valuation!!, z.partsValuation, z.figsValuation, z.pnl).gesamt
        assertEquals(0, kopf.compareTo(bewertet.sumOf { BigDecimal.valueOf(it.wert!!) }))
    }
}

/** Ein Testserver mit Beispielantworten und die ViewModels dagegen. */
object Beispiele {
    const val SET = "75192-1"

    val ANTWORTEN = arrayOf(
        // Eine Währung (CHF) und dieselben Preise überall: Der Falcon kostet in Galerie,
        // Detail und Finanzen 812.50, gekauft für 700.00; die Titanic 449.95 je Stück.
        "/api/v1/sets" to """{"success":true,"total":3,"sets":[
            {"set_number":"75192-1","image_local":"/beispiel/set1.png","name":"Millennium Falcon","year":2017,"theme":"Star Wars","quantity":1,"num_parts":7541},
            {"set_number":"10294-1","image_local":"/beispiel/set2.png","name":"Titanic","year":2021,"theme":"Icons","quantity":2,"num_parts":9090},
            {"set_number":"21318-1","image_local":"/beispiel/set3.png","name":"Baumhaus","year":2019,"theme":"Ideas","quantity":1,"num_parts":3036}]}""",
        "/api/v1/stats" to """{"success":true,"stats":{"total_sets":3,"total_quantity":4,"total_pieces":28757,"total_instructions":2,"total_parts":82,"total_minifigs":3,"set_parts":42,"manual_parts":40}}""",
        // Das Baumhaus hat noch keinen Marktpreis: Die Kopfkarte rechnet über die zwei
        // übrigen Positionen (1500 + 212.40 = 1712.40) und nennt es in der Basiszeile, die
        // Galeriekachel zeigt seinen Kaufpreis als solchen (kachel_quelle "kauf").
        "/api/v1/finance/pnl" to """{"success":true,"currency":"CHF","totals":{"purchase":"1680.00","current":"1712.40","pnl_prozent":14.2,
            "grand_total":"1712.40","sets_purchase":"1680.00","positionen":3,"positionen_bewertet":2,"positionen_ohne_marktpreis":1,
            "positionen_ohne_kaufpreis":0,"basis_einstand":"1500.00","basis_marktwert":"1712.40","basis_guv_betrag":"212.40",
            "ohne_marktpreis_einstand":"180.00","ohne_kaufpreis_marktwert":"0.00"},"sets":[
            {"set_number":"75192-1","quantity":1,"current_price":812.5,"baseline_price":700,"pnl_pct":"16.1","kachel_preis":812.5,"kachel_pnl_pct":16.1,"kachel_quelle":"markt"},
            {"set_number":"10294-1","quantity":2,"current_price":449.95,"baseline_price":400,"pnl_pct":"12.5","kachel_preis":449.95,"kachel_pnl_pct":12.5,"kachel_quelle":"markt"},
            {"set_number":"21318-1","quantity":1,"current_price":null,"baseline_price":180,"kachel_preis":180.0,"kachel_pnl_pct":null,"kachel_quelle":"kauf"}]}""",
        // Wie der Server (finanzen/rechnung/bewertung.ts): wert_gesamt, Kaufpreis, G&V und
        // je Erfassung eine Zeile mit Zustand. Ohne wert_gesamt zeigt jede Zeile „noch
        // kein Preis“ unter einer gefüllten Kopfkachel.
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
        // Drei Fälle der Merkliste: mit Preis und Alarm, ohne Preis („Preis folgt“), schon vorhanden.
        "/api/v1/wanted" to """{"success":true,"merkposten":[
            {"set_number":"10305-1","image_local":"/beispiel/set1.png","name":"Lion Knights' Castle","year":2022,"condition":"N","user_id":1,"created_at":"2026-08-21T09:00:00Z",
             "marktpreis":399.9,"waehrung":"CHF","alarm":{"richtung":"unter","schwelle":349.0,"ausgeloest":false}},
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

    /** Ein eigener Server je Test; [close] räumt ihn wieder ab. */
    class Welt(texte: Texte = NummernTexte) : AutoCloseable {
        val pfade = PfadServer(*ANTWORTEN)
        val t = TestDienste(pfade.imTakt(), texte, io = Dispatchers.Main).also { d -> d.sitzung.waehrungUebernommen(Waehrung.CHF) }

        fun galerie() = t.merke(GalerieViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, SetsRepository(t.api),
            t.kontosicht, FinanzenRepository(t.api), SavedStateHandle()))
        fun teile() = t.merke(TeileViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, t.scrollMemory, TeileRepository(t.api), FigurenRepository(t.api), t.kontosicht, SavedStateHandle()))
        fun finanzen() = t.merke(FinanzViewModel(t.sitzung, t.filter(), t.hinweise, t.aenderungen, FinanzenRepository(t.api), SavedStateHandle()))
        fun merkliste() = t.merke(MerklisteViewModel(t.sitzung, t.filter(), t.hinweise, t.merkliste(), t.alarme(), t.kontosicht,
            KatalogRepository(t.api), FinanzenRepository(t.api), SavedStateHandle()))
        fun setDetail() = t.merke(SetDetailViewModel(t.sitzung, t.filter(), t.hinweise, t.sets(), t.setKatalog(), t.alarme(), t.setDateien(),
            FinanzenRepository(t.api), HaushaltRepository(t.api),
            object : DateiLeser { override suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>? = null },
            SavedStateHandle(mapOf("setNumber" to SET))))

        /** Die Bauliste ohne Netz: [aufloesen] liefert Name und Teile je Setnummer. */
        fun bauliste(aufloesen: (String) -> Pair<String, List<PlPart>> = { error("nichts aufzulösen") }) =
            t.merke(TeilelisteViewModel(t.sitzung, t.hinweise, object : TeilelistenQuelle {
                override suspend fun loeseSetAuf(setNumber: String, serverUrl: String) = aufloesen(setNumber)
                override suspend fun mitBestand(teile: List<PlPart>, nurLose: Boolean, mitUnterkonten: Boolean) = teile
                override fun sortiert(teile: Collection<PlPart>) = teile.toList()
            }, object : TeilelistenExport {
                override val fortschritt = flowOf<PdfFortschritt?>(null)
                override suspend fun erzeuge(auftrag: PdfAuftragAnfrage): ExportErgebnis =
                    ExportErgebnis.Fehler(PdfFehlschlag.Abruf(Ergebnis.Error.Netz()))
            }, SavedStateHandle()))

        override fun close() {
            t.aufraeumen()
            pfade.server.shutdown()
        }
    }
}
