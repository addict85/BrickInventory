package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.model.*

/**
 * Die Verwaltung des Servers (nur Verwalter).
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (VerwaltungRepositoryImpl).
 */
interface VerwaltungRepository {
    suspend fun importiereCsv(
        art: CsvArt, dateiname: String, inhalt: ByteArray,
    ): Result<CsvImportErgebnis>

    suspend fun getProtokoll(minuten: Int): Result<ProtokollResponse>

    suspend fun setJobSchedule(name: String, zeit: String? = null, minuten: Int? = null): Result<GenericAdminResponse>

    suspend fun queueCatalogImages(): Result<GenericAdminResponse>

    suspend fun setAppTheme(theme: String): Result<GenericAdminResponse>

    suspend fun getStartupStatus(): Result<StartupStatus>

    suspend fun getJobs(): Result<JobsResponse>

    suspend fun getCacheStats(): Result<CacheStatsResponse>

    suspend fun getCacheTtl(): Result<CacheTtlResponse>

    suspend fun setCacheTtl(hours: Int): Result<GenericAdminResponse>

    suspend fun clearCache(alles: Boolean = false): Result<GenericAdminResponse>

    suspend fun getApiLimits(): Result<ApiLimitsResponse>

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Result<GenericAdminResponse>

    suspend fun getBricksetQueue(): Result<BricksetQueueResponse>

    suspend fun retryBricksetEntry(setNumber: String): Result<GenericAdminResponse>

    suspend fun deleteBricksetEntry(setNumber: String): Result<GenericAdminResponse>

    suspend fun redownloadMissingImages(): Result<GenericAdminResponse>

    suspend fun getAuftraege(status: String? = null, art: String? = null): Result<AuftraegeResponse>

    suspend fun brichAuftragAb(id: String): Result<AuftragAenderung>

    suspend fun wiederholeAuftrag(id: String): Result<AuftragAenderung>

    suspend fun starteAuftragsArt(art: String): Result<AuftragsArtStart>

    suspend fun leereAuftragsArt(art: String): Result<AuftragsArtLeerung>

    suspend fun triggerCsvSync(): Result<GenericAdminResponse>

    suspend fun reimportInstructions(): Result<GenericAdminResponse>

    suspend fun triggerPriceJob(): Result<GenericAdminResponse>

    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse>
}
