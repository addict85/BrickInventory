package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Anmeldung, Einstellungen, Betrieb und Katalog.
 *
 * Teil der Aufteilung von BrickRepository (Nachtrag 155) — die Begruendung
 * steht in RepoBasis.kt. Die Ruempfe sind WORTGLEICH uebernommen; veraendert
 * wurde nichts ausser der Klassenzugehoerigkeit.
 *
 * Erreichbar ueber `repo.admin.…` — BrickRepository haelt die fuenf Teile.
 */
@Singleton
class AdminRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    // Kein expliziter Authorization-Header mehr nötig: Der OkHttp-Interceptor in
    // AppModule setzt "Bearer <token>" automatisch für alle Requests an unseren
    // Server (aus dem In-Memory-Cache des PreferencesManagers — kein DataStore-
    // Read pro Call mehr). Einzige Ausnahme: getCsvImportStatusDirect, wo der
    // Foreground-Service den Token explizit mitgibt.

    suspend fun login(serverUrl: String, username: String, password: String): Result<LoginResponse> =
        safeCall { api.login(LoginRequest(username, password)) }

    suspend fun qrLogin(token: String): Result<LoginResponse> =
        safeCall { api.qrLogin(ch.brickinventoryapp.data.model.QrLoginRequest(token)) }

    suspend fun getMe(): Result<MeResponse> = safeCall { api.getMe() }

    suspend fun getTokens(): Result<TokensResponse> = safeCall { api.getTokens() }

    suspend fun revokeToken(tokenId: String): Result<GenericResponse> =
        safeCall { api.revokeToken(tokenId) }

    suspend fun getSettings(): Result<SettingsResponse> =
        safeCall { api.getSettings() }

    suspend fun updateSettings(currency: String, condition: String): Result<GenericResponse> =
        safeCall { api.updateSettings(mapOf("currency" to currency, "price_condition" to condition)) }

    suspend fun getJobs(): Result<JobsResponse> = safeCall { api.getJobs() }

    suspend fun getCacheStats(): Result<CacheStatsResponse> = safeCall { api.getCacheStats() }

    suspend fun getCacheTtl(): Result<CacheTtlResponse> = safeCall { api.getCacheTtl() }

    suspend fun setCacheTtl(hours: Int): Result<GenericAdminResponse> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }

    suspend fun getApiLimits(): Result<ApiLimitsResponse> = safeCall { api.getApiLimits() }

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Result<GenericAdminResponse> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }

    suspend fun getBricksetQueue(): Result<BricksetQueueResponse> = safeCall { api.getBricksetQueue() }

    suspend fun retryBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.retryBricksetEntry(setNumber) }

    suspend fun deleteBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.deleteBricksetEntry(setNumber) }

    suspend fun redownloadMissingImages(): Result<GenericAdminResponse> = safeCall { api.redownloadMissingImages() }

    // ── Katalog ──────────────────────────────────────────────────────────────
    suspend fun getCatalogMeta(): Result<CatalogMetaResponse> =
        cached("catalog-meta", CatalogMetaResponse.serializer()) { safeCall { api.getCatalogMeta() } }

    suspend fun getCatalogSets(
        q: String? = null, themeId: Int? = null, yearFrom: Int? = null, yearTo: Int? = null,
        sort: String = "year_desc", page: Int = 1, limit: Int = 60
    ): Result<CatalogSetsResponse> = safeCall { api.getCatalogSets(q, themeId, yearFrom, yearTo, sort, page, limit) }

    suspend fun getCatalogSetDetail(setNumber: String): Result<CatalogSetDetailResponse> =
        safeCall { api.getCatalogSetDetail(setNumber) }

    /**
     * Jahresverteilung zu den aktuellen Filtern — die Zahlen, aus denen die
     * Leiste ihr Etikett rechnet. Einmal je Listenaufbau, nicht beim Rollen.
     */
    suspend fun getCatalogYearVerteilung(
        q: String? = null, themeId: Int? = null, sort: String = "year_desc"
    ): Result<ch.brickinventoryapp.data.model.CatalogYearVerteilungResponse> =
        safeCall { api.getCatalogYearVerteilung(q, themeId, sort) }

}
