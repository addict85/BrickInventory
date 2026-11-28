package ch.brickinventoryapp.data.account

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.JobsView
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.outcome.Outcome

/**
 * The management of the server (admins only), in views: the wire format stays
 * behind the implementation (ManagementRepositoryImpl). Actions without a usable response
 * deliver Unit; a `success: false` of the server comes as [Outcome.Failure.Refusal].
 */
interface ManagementRepository {
    suspend fun importCsv(kind: CsvImportKind, fileName: String, content: ByteArray): Outcome<CsvResultView>

    suspend fun getLog(minutes: Int): Outcome<List<LogRowView>>

    suspend fun setJobSchedule(name: String, time: String? = null, minutes: Int? = null): Outcome<Unit>

    suspend fun queueCatalogImages(): Outcome<Unit>

    suspend fun setAppTheme(theme: Design): Outcome<Unit>

    suspend fun getStartupStatus(): Outcome<StartStateView>

    suspend fun getJobs(): Outcome<JobsView>

    suspend fun getCacheStats(): Outcome<CacheMetricsView>

    /** The cache duration in hours, as the server writes it. */
    suspend fun getCacheTtl(): Outcome<String>

    suspend fun setCacheTtl(hours: Int): Outcome<Unit>

    suspend fun clearCache(everything: Boolean = false): Outcome<Unit>

    suspend fun getApiLimits(): Outcome<ApiLimitsView>

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Outcome<Unit>

    suspend fun getBricksetQueue(): Outcome<List<BricksetEntryView>>

    suspend fun retryBricksetEntry(setNumber: String): Outcome<Unit>

    suspend fun deleteBricksetEntry(setNumber: String): Outcome<Unit>

    suspend fun redownloadMissingImages(): Outcome<Unit>

    suspend fun getBackgroundJobs(status: String? = null, kind: String? = null): Outcome<BackgroundView>

    suspend fun requestJobCancel(id: String): Outcome<Unit>

    suspend fun repeatJob(id: String): Outcome<Unit>

    /** true if a job was really created; false if one was already running. */
    suspend fun startJobKind(kind: String): Outcome<Boolean>

    /** How many waiting jobs were removed. */
    suspend fun emptyJobKind(kind: String): Outcome<Int>

    suspend fun triggerCsvSync(): Outcome<Unit>

    /** How many sets were queued for re-reading. */
    suspend fun reimportInstructions(): Outcome<Int>

    suspend fun triggerPriceJob(): Outcome<Unit>

    suspend fun setDefaultCondition(condition: Condition): Outcome<Unit>
}
