package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.model.*

/**
 * Die Verwaltung des Servers (nur Verwalter).
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (VerwaltungRepositoryImpl).
 */
interface VerwaltungRepository {
    suspend fun importiereCsv(
        art: CsvArt, dateiname: String, inhalt: ByteArray,
    ): Ergebnis<CsvImportErgebnis>

    suspend fun getProtokoll(minuten: Int): Ergebnis<ProtokollResponse>

    suspend fun setJobSchedule(name: String, zeit: String? = null, minuten: Int? = null): Ergebnis<GenericAdminResponse>

    suspend fun queueCatalogImages(): Ergebnis<GenericAdminResponse>

    suspend fun setAppTheme(theme: String): Ergebnis<GenericAdminResponse>

    suspend fun getStartupStatus(): Ergebnis<StartupStatus>

    suspend fun getJobs(): Ergebnis<JobsResponse>

    suspend fun getCacheStats(): Ergebnis<CacheStatsResponse>

    suspend fun getCacheTtl(): Ergebnis<CacheTtlResponse>

    suspend fun setCacheTtl(hours: Int): Ergebnis<GenericAdminResponse>

    suspend fun clearCache(alles: Boolean = false): Ergebnis<GenericAdminResponse>

    suspend fun getApiLimits(): Ergebnis<ApiLimitsResponse>

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<GenericAdminResponse>

    suspend fun getBricksetQueue(): Ergebnis<BricksetQueueResponse>

    suspend fun retryBricksetEntry(setNumber: String): Ergebnis<GenericAdminResponse>

    suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<GenericAdminResponse>

    suspend fun redownloadMissingImages(): Ergebnis<GenericAdminResponse>

    suspend fun getAuftraege(status: String? = null, art: String? = null): Ergebnis<AuftraegeResponse>

    suspend fun brichAuftragAb(id: String): Ergebnis<AuftragAenderung>

    suspend fun wiederholeAuftrag(id: String): Ergebnis<AuftragAenderung>

    suspend fun starteAuftragsArt(art: String): Ergebnis<AuftragsArtStart>

    suspend fun leereAuftragsArt(art: String): Ergebnis<AuftragsArtLeerung>

    suspend fun triggerCsvSync(): Ergebnis<GenericAdminResponse>

    suspend fun reimportInstructions(): Ergebnis<GenericAdminResponse>

    suspend fun triggerPriceJob(): Ergebnis<GenericAdminResponse>

    suspend fun setDefaultCondition(condition: Zustand): Ergebnis<GenericAdminResponse>
}
