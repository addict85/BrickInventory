package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PortfolioHistoryResponse
import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.SetPriceResponse
import ch.brickinventoryapp.contract.StatsResponse
import ch.brickinventoryapp.contract.ValuationResponse
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Prices, valuations, profit and loss, history, key figures (FinancesRepository).
 */
interface FinancesApi {

    // No currency parameter: the server determines the currency from the
    // user setting. An own default did not hit the cache of the set
    // currency, and the detail view showed no market price where finances and
    // tile had one.
    @GET("api/v2/sets/{setNumber}/price")
    suspend fun getSetPrice(
        @Path("setNumber") setNumber: String
    ): Response<SetPriceResponse>

    // Without currency here too: this route never evaluated the parameter
    // server-side — the default "CHF" here (against "EUR" for the price!)
    // was dead weight and only increased the confusion.
    @GET("api/v2/sets/{setNumber}/price-history")
    suspend fun getSetPriceHistory(
        @Path("setNumber") setNumber: String
    ): Response<PriceHistoryResponse>

    /**
     * Price history of a manually added part, per condition. The same response form as
     * for the set, hence the same model; the set fields stay at their defaults.
     */
    @GET("api/v2/parts/{partNumber}/{colorId}/price-history")
    suspend fun getPartPriceHistory(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int
    ): Response<PriceHistoryResponse>

    @GET("api/v2/minifigs/{figNumber}/price-history")
    suspend fun getFigPriceHistory(
        @Path("figNumber") figNumber: String
    ): Response<PriceHistoryResponse>

    @GET("api/v2/finance/parts-valuation")
    suspend fun getPartsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<PartsValuationResponse>

    @GET("api/v2/finance/minifigs-valuation")
    suspend fun getMinifigsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<FigsValuationResponse>

    @GET("api/v2/finance/pnl")
    suspend fun getPnl(
        @Query("accounts") accounts: String? = null
    ): Response<PnlResponse>

    @GET("api/v2/finance/valuation")
    suspend fun getValuation(
        @Query("accounts") accounts: String? = null
    ): Response<ValuationResponse>

    @GET("api/v2/finance/portfolio-history")
    suspend fun getPortfolioHistory(
        @Query("period") period: String = "week",
        @Query("accounts") accounts: String? = null
    ): Response<PortfolioHistoryResponse>

    @GET("api/v2/stats")
    suspend fun getStats(
        @Query("accounts") accounts: String? = null
    ): Response<StatsResponse>
}
