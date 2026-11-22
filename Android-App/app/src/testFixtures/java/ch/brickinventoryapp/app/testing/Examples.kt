package ch.brickinventoryapp.app.testing

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.EntryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.WantedListViewModel
import ch.brickinventoryapp.data.SetCreateStep
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testAccountRepository
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testManagementRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.data.testing.testVouchersRepository
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.finances.ui.viewmodel.VoucherViewModel
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.viewmodel.MinifigsViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.state.testing.NumbersTexts
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf

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
        // Like the server (`finances/rechnung/bewertung.ts`): wert_gesamt, purchase price, P&L and
        // one row per acquisition with condition. Without wert_gesamt every row shows „noch kein Preis“ below a filled header tile.
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

    /** No file to read: the destinations under test pick none. */
    val noFiles = object : FileReader { override suspend fun read(file: FileRef): Pair<String?, ByteArray>? = null }

    /** One server per test; [close] tears it down again. */
    class World(val texts: Texts = NumbersTexts) : AutoCloseable {
        val paths = PathServer(*RESPONSES)
        val t = TestServices(paths.onTick(), texts, io = Dispatchers.Main).also { d -> d.session.currencyAdopted(CurrencyCode.CHF) }

        fun gallery(handle: SavedStateHandle = SavedStateHandle()) = t.track(GalleryViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testSetsRepository(t.api),
            t.accountView, testFinancesRepository(t.api), handle))
        fun parts(handle: SavedStateHandle = SavedStateHandle()) = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView, handle))
        fun figures(handle: SavedStateHandle = SavedStateHandle()) = t.track(MinifigsViewModel(t.session, t.filter(), t.hints, t.changes, testMinifigsRepository(t.api), t.accountView, handle))
        fun finances(handle: SavedStateHandle = SavedStateHandle()) = t.track(FinanceViewModel(t.session, t.filter(), t.hints, t.changes, testFinancesRepository(t.api), handle))
        fun wantedList(handle: SavedStateHandle = SavedStateHandle()) = t.track(WantedListViewModel(t.session, t.filter(), t.hints, t.wantedList(), t.alerts(), t.accountView,
            testCatalogRepository(t.api), testFinancesRepository(t.api), handle))
        fun setDetail(handle: SavedStateHandle = SavedStateHandle(mapOf("setNumber" to SET))) = t.track(SetDetailViewModel(t.session, t.filter(), t.hints, t.sets(), t.setCatalog(), t.alerts(), t.setFiles(),
            testFinancesRepository(t.api), testHouseholdRepository(t.api),
            noFiles, handle))

        /** The build list without network: [resolve] delivers name and parts per set number. */
        fun buildList(handle: SavedStateHandle = SavedStateHandle(), resolve: (String) -> Pair<String, List<PlPart>> = { error("nothing to resolve") }) =
            t.track(PartListViewModel(t.session, t.hints, object : PartListsSource {
                override suspend fun resolveSetOn(setNumber: String, serverUrl: String) = Outcome.Success(resolve(setNumber))
                override suspend fun withInventory(parts: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean) = parts
                override fun sorted(parts: Collection<PlPart>) = parts.toList()
            }, object : PartListsExport {
                override val progress = flowOf<PdfProgress?>(null)
                override suspend fun generate(job: PartListJob): ExportResult =
                    ExportResult.Failure(PdfFailure.Fetch(Outcome.Failure.Network()))
            }, handle))

        fun entry() = t.track(EntryViewModel(t.session, t.filter(), t.hints, testSetsRepository(t.api), t.setCatalog(), t.wantedList(),
            testCatalogRepository(t.api), object : SetCreator {
                override fun create(setNumber: String, quantity: Int, purchasePrice: Money?, condition: Condition?,
                                    ownerUserId: Int?, storage: String?): Flow<SetCreateStep> = emptyFlow()
            }))
        fun settings() = t.track(SettingsViewModel(t.session, t.filter(), t.hints, t.sync, testAccountRepository(t.api, t.io),
            testManagementRepository(t.api), t.alerts(), testPartsRepository(t.api), noFiles))
        fun purchases() = t.track(PurchasesViewModel(t.session, t.filter(), t.hints, t.changes, testHouseholdRepository(t.api), t.sets(),
            testFinancesRepository(t.api), testPartsRepository(t.api), testMinifigsRepository(t.api)))
        fun vouchers() = t.track(VoucherViewModel(testVouchersRepository(t.api), texts, noFiles, t.messages))

        override fun close() {
            t.cleanUp()
            paths.server.shutdown()
        }
    }
}
