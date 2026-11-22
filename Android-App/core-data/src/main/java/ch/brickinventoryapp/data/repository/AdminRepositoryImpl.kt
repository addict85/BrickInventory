package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.CsvKind
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.mapping.asData
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.ManagementApi
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
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Operation and data maintenance: CSV import, log, background work, caches, quotas, global defaults — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
class AdminRepositoryImpl @Inject constructor(
    private val api: ManagementApi,
) : ManagementRepository {

    /**
     * Import a CSV file. The bytes come in already read, because a
     * content:// reference needs the ContentResolver and the repository knows no
     * Android types; the file name goes along for the server log.
     */
    override suspend fun importCsv(
        kind: CsvImportKind, fileName: String, content: ByteArray,
    ): Outcome<CsvResultView> {
        val bodyBytes = content.toRequestBody("text/csv".toMediaType())
        val part = MultipartBody.Part.createFormData("file", fileName, bodyBytes)
        return safeCall {
            when (kind.asData()) {
                CsvKind.SETS      -> api.importSetsCsv(part)
                CsvKind.PARTS     -> api.importPartsCsv(part)
                CsvKind.MINIFIGS -> api.importMinifigsCsv(part)
                CsvKind.WANTED_LIST -> api.importWantedCsv(part)
                CsvKind.PRICE_ALARMS -> api.importAlertsCsv(part)
            }
        }.promised({ it.success }) { it.asView() }
    }

    // Server log. The server's user management stays reserved for the web app
    // — see ManagementApi.
    override suspend fun getLog(minutes: Int): Outcome<List<LogRowView>> =
        safeCall { api.getLog(minutes) }.promised({ it.success }) { r -> r.logs.map { it.asView() } }

    /**
     * Set the schedule of a job — daily (HH:MM) or as an interval (minutes).
     *
     * Exactly ONE of the two: the server reads `time` for daily jobs and
     * `minutes` for the price job and rejects everything else. Hence two
     * named parameters here instead of a free body — which one applies is decided
     * visibly by the caller.
     */
    override suspend fun setJobSchedule(name: String, time: String?, minutes: Int?): Outcome<Unit> =
        safeCall {
            api.setJobSchedule(buildJsonObject {
                put("name", JsonPrimitive(name))
                time?.let { put("time", JsonPrimitive(it)) }
                minutes?.let { put("minutes", JsonPrimitive(it)) }
            })
        }.managed { }

    /** Fehlende Katalogbilder einreihen — siehe ManagementApi.queueCatalogImages. */
    override suspend fun queueCatalogImages(): Outcome<Unit> = safeCall { api.queueCatalogImages() }.managed { }

    /** Switch the global design (admins only). */
    override suspend fun setAppTheme(theme: Design): Outcome<Unit> =
        safeCall { api.setAppTheme(mapOf("theme" to theme.identifier)) }.managed { }

    /** Startup state of the server — without sign-in. */
    override suspend fun getStartupStatus(): Outcome<StartStateView> = safeCall { api.getStartupStatus() }.mapData { it.asView() }

    override suspend fun getJobs(): Outcome<JobsView> = safeCall { api.getJobs() }.mapData { r ->
        JobsView(r.jobs.mapValues { it.value.asView() }, r.schedules.mapValues { it.value.asView() })
    }

    override suspend fun getCacheStats(): Outcome<CacheMetricsView> = safeCall { api.getCacheStats() }.mapData { it.asView() }

    override suspend fun getCacheTtl(): Outcome<String> = safeCall { api.getCacheTtl() }.mapData { it.ttl }

    override suspend fun setCacheTtl(hours: Int): Outcome<Unit> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }.managed { }

    /**
     * Clear the cache — only prices, or everything.
     *
     * `everything = false` sends an EMPTY body and not `all=false`: the
     * server checks `req.body?.all` for truth, so both would be the same —
     * but an empty body says the same more briefly and cannot accidentally
     * be read as „everything".
     */
    override suspend fun clearCache(everything: Boolean): Outcome<Unit> =
        safeCall { api.clearCache(if (everything) mapOf("all" to true) else emptyMap()) }.managed { }

    override suspend fun getApiLimits(): Outcome<ApiLimitsView> = safeCall { api.getApiLimits() }.mapData { it.limits.asView() }

    override suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Outcome<Unit> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }.managed { }

    override suspend fun getBricksetQueue(): Outcome<List<BricksetEntryView>> =
        safeCall { api.getBricksetQueue() }.mapData { r -> r.entries.map { it.asView() } }

    override suspend fun retryBricksetEntry(setNumber: String): Outcome<Unit> = safeCall { api.retryBricksetEntry(setNumber) }.managed { }

    override suspend fun deleteBricksetEntry(setNumber: String): Outcome<Unit> = safeCall { api.deleteBricksetEntry(setNumber) }.managed { }

    override suspend fun redownloadMissingImages(): Outcome<Unit> = safeCall { api.redownloadMissingImages() }.managed { }

    override suspend fun getBackgroundJobs(status: String?, kind: String?): Outcome<BackgroundView> =
        safeCall { api.getBackgroundJobs(status, kind) }.mapData { it.asView() }

    override suspend fun requestJobCancel(id: String): Outcome<Unit> = safeCall { api.requestJobCancel(id) }.withoutContent()

    override suspend fun repeatJob(id: String): Outcome<Unit> = safeCall { api.repeatJob(id) }.withoutContent()

    override suspend fun startJobKind(kind: String): Outcome<Boolean> = safeCall { api.startJobKind(kind) }.mapData { it.gestartet }

    override suspend fun emptyJobKind(kind: String): Outcome<Int> = safeCall { api.emptyJobKind(kind) }.mapData { it.entfernt }

    override suspend fun triggerCsvSync(): Outcome<Unit> = safeCall { api.triggerCsvSync() }.managed { }

    override suspend fun reimportInstructions(): Outcome<Int> = safeCall { api.reimportInstructions() }.managed { it.enqueued }

    override suspend fun triggerPriceJob(): Outcome<Unit> = safeCall { api.triggerPriceJob() }.managed { }

    // Admin-level: saves global default (Monitoring)
    override suspend fun setDefaultCondition(condition: Condition): Outcome<Unit> = safeCall { api.setDefaultCondition(mapOf("condition" to condition.identifier)) }.managed { }
}

/** An admin response carries `success`: a refusal is an error, not a success. */
private inline fun <R> Outcome<GenericAdminResponse>.managed(f: (GenericAdminResponse) -> R): Outcome<R> =
    promised({ it.success }, f = f)
