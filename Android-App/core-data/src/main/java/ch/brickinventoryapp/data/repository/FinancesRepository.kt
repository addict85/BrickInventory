package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.ValuationView
import ch.brickinventoryapp.model.domain.FiguresValuationView
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.PartsValuationView
import ch.brickinventoryapp.model.domain.ValueHistoryView

import ch.brickinventoryapp.model.domain.AccountSelection
/**
 * Prices, valuation, history and profit/loss.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (FinancesRepositoryImpl).
 */
interface FinancesRepository {
    suspend fun getSetPrice(setNumber: String): Outcome<SetPriceView>

    suspend fun getSetPriceHistory(setNumber: String): Outcome<PriceHistoryView>

    suspend fun getPartPriceHistory(partNumber: String, colorId: Int): Outcome<PriceHistoryView>

    suspend fun getFigPriceHistory(figNumber: String): Outcome<PriceHistoryView>

    suspend fun getPartsValuation(accounts: AccountSelection? = null): Outcome<PartsValuationView>

    suspend fun getMinifigsValuation(accounts: AccountSelection? = null): Outcome<FiguresValuationView>

    suspend fun getValuation(accounts: AccountSelection? = null): Outcome<ValuationView>

    suspend fun getPnl(accounts: AccountSelection? = null): Outcome<ProfitView>

    suspend fun getPortfolioHistory(period: String = "week", accounts: AccountSelection? = null): Outcome<ValueHistoryView>

    suspend fun getStats(accounts: AccountSelection? = null): Outcome<MetricsView?>
}
