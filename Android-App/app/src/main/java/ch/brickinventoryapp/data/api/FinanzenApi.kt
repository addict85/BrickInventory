package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Preise, Bewertungen, Gewinn und Verlust, Verlauf, Kennzahlen (FinanzenRepository).
 */
interface FinanzenApi {

    // Kein currency-Parameter: Die Währung bestimmt der Server aus der
    // Nutzereinstellung. Ein eigener Startwert traf den Cache der eingestellten
    // Währung nicht, und die Detailansicht zeigte keinen Marktpreis, wo Finanzen und
    // Kachel einen hatten.
    @GET("api/v1/sets/{setNumber}/price")
    suspend fun getSetPrice(
        @Path("setNumber") setNumber: String
    ): Response<SetPriceResponse>

    // Auch hier ohne currency: Diese Route hat den Parameter serverseitig
    // nie ausgewertet — der Vorgabewert "CHF" hier (gegen "EUR" beim Preis!)
    // war totes Gewicht und hat die Verwirrung nur vergrössert.
    @GET("api/v1/sets/{setNumber}/price-history")
    suspend fun getSetPriceHistory(
        @Path("setNumber") setNumber: String
    ): Response<PriceHistoryResponse>

    /**
     * Preisverlauf eines manuell erfassten Teils, je Zustand. Dieselbe Antwortform wie
     * beim Set, deshalb dasselbe Modell; die Set-Felder bleiben auf ihren Vorgaben.
     */
    @GET("api/v1/parts/{partNumber}/{colorId}/price-history")
    suspend fun getPartPriceHistory(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int
    ): Response<PriceHistoryResponse>

    @GET("api/v1/minifigs/{figNumber}/price-history")
    suspend fun getFigPriceHistory(
        @Path("figNumber") figNumber: String
    ): Response<PriceHistoryResponse>

    @GET("api/v1/finance/parts-valuation")
    suspend fun getPartsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<PartsValuationResponse>

    @GET("api/v1/finance/minifigs-valuation")
    suspend fun getMinifigsValuation(
        @Query("accounts") accounts: String? = null
    ): Response<FigsValuationResponse>

    @GET("api/v1/finance/pnl")
    suspend fun getPnl(
        @Query("accounts") accounts: String? = null
    ): Response<PnlResponse>

    @GET("api/v1/finance/valuation")
    suspend fun getValuation(
        @Query("accounts") accounts: String? = null
    ): Response<ValuationResponse>

    @GET("api/v1/finance/portfolio-history")
    suspend fun getPortfolioHistory(
        @Query("period") period: String = "week",
        @Query("accounts") accounts: String? = null
    ): Response<PortfolioHistoryResponse>

    @GET("api/v1/stats")
    suspend fun getStats(
        @Query("accounts") accounts: String? = null
    ): Response<StatsResponse>
}
