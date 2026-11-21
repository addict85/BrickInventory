package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.JobsView
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.ui.theme.Design

/**
 * The management of the server (admins only), in views: the wire format stays
 * behind the implementation (VerwaltungRepositoryImpl). Actions without a usable response
 * deliver Unit; a `success: false` of the server comes as [Ergebnis.Fehler.Absage].
 */
interface ManagementRepository {
    suspend fun importCsv(art: CsvImportKind, fileName: String, inhalt: ByteArray): Ergebnis<CsvResultView>

    suspend fun getLog(minuten: Int): Ergebnis<List<LogRowView>>

    suspend fun setJobSchedule(name: String, zeit: String? = null, minuten: Int? = null): Ergebnis<Unit>

    suspend fun queueCatalogImages(): Ergebnis<Unit>

    suspend fun setAppTheme(theme: Design): Ergebnis<Unit>

    suspend fun getStartupStatus(): Ergebnis<StartStateView>

    suspend fun getJobs(): Ergebnis<JobsView>

    suspend fun getCacheStats(): Ergebnis<CacheMetricsView>

    /** The cache duration in hours, as the server writes it. */
    suspend fun getCacheTtl(): Ergebnis<String>

    suspend fun setCacheTtl(hours: Int): Ergebnis<Unit>

    suspend fun clearCache(alles: Boolean = false): Ergebnis<Unit>

    suspend fun getApiLimits(): Ergebnis<ApiLimitsView>

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<Unit>

    suspend fun getBricksetQueue(): Ergebnis<List<BricksetEntryView>>

    suspend fun retryBricksetEntry(setNumber: String): Ergebnis<Unit>

    suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<Unit>

    suspend fun redownloadMissingImages(): Ergebnis<Unit>

    suspend fun getAuftraege(status: String? = null, art: String? = null): Ergebnis<BackgroundView>

    suspend fun abortJobAb(id: String): Ergebnis<Unit>

    suspend fun repeatJob(id: String): Ergebnis<Unit>

    /** true if a job was really created; false if one was already running. */
    suspend fun starteAuftragsArt(art: String): Ergebnis<Boolean>

    /** How many waiting jobs were removed. */
    suspend fun emptyJobKind(art: String): Ergebnis<Int>

    suspend fun triggerCsvSync(): Ergebnis<Unit>

    /** How many sets were queued for re-reading. */
    suspend fun reimportInstructions(): Ergebnis<Int>

    suspend fun triggerPriceJob(): Ergebnis<Unit>

    suspend fun setDefaultCondition(condition: Zustand): Ergebnis<Unit>
}
