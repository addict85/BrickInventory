package ch.brickinventoryapp.data.finances

import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.reconciledSingle
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.FiguresValuationView
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.PartsValuationView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.ValuationView
import ch.brickinventoryapp.model.domain.ValueHistoryView
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Prices, valuation, history and profit/loss — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
internal class FinancesRepositoryImpl @Inject constructor(
    private val api: FinancesApi,
    private val store: OfflineStore,
) : FinancesRepository {

    override suspend fun getSetPrice(setNumber: String): Outcome<SetPriceView> =
        safeCall { api.getSetPrice(setNumber) }.mapData { it.asView() }

    override suspend fun getSetPriceHistory(setNumber: String): Outcome<PriceHistoryView> =
        safeCall { api.getSetPriceHistory(setNumber) }.history()

    override suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Outcome<PriceHistoryView> =
        safeCall { api.getPartPriceHistory(partNumber, colorId) }.history()

    override suspend fun getFigPriceHistory(figNumber: String): Outcome<PriceHistoryView> =
        safeCall { api.getFigPriceHistory(figNumber) }.history()

    override suspend fun getPartsValuation(accounts: AccountSelection?): Outcome<PartsValuationView> =
        safeCall { api.getPartsValuation(accounts?.request) }.mapData { it.asView() }

    override suspend fun getMinifigsValuation(accounts: AccountSelection?): Outcome<FiguresValuationView> =
        safeCall { api.getMinifigsValuation(accounts?.request) }.mapData { it.asView() }

    override suspend fun getValuation(accounts: AccountSelection?): Outcome<ValuationView> =
        safeCall { api.getValuation(accounts?.request) }.mapData { it.asView() }

    override suspend fun getPnl(accounts: AccountSelection?): Outcome<ProfitView> =
        safeCall { api.getPnl(accounts?.request) }.mapData { it.asView() }

    override suspend fun getPortfolioHistory(period: String, accounts: AccountSelection?): Outcome<ValueHistoryView> =
        safeCall { api.getPortfolioHistory(period, accounts?.request) }.mapData { it.asView() }

    override suspend fun getStats(accounts: AccountSelection?): Outcome<MetricsView?> =
        (if (accounts == null)
            store.reconciledSingle(Slots.METRICS) { safeCall { api.getStats() }.mapData { it.stats?.asView() } }
        else safeCall { api.getStats(accounts.request) }.mapData { it.stats?.asView() })
}

/** A history with success: false has no points that said anything. */
private fun Outcome<PriceHistoryResponse>.history(): Outcome<PriceHistoryView> =
    promised({ it.success }, { null }) { it.asView() }
