package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.api.ManagementApi
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.JobsView
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.contract.CsvKind
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.mapping.asData
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.MultipartBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Operation and data maintenance: CSV import, log, background work, caches, quotas, global defaults — via Retrofit; the common fetch logic stands in Abruf.kt.
 */
@Singleton
class VerwaltungRepositoryImpl @Inject constructor(
    private val api: ManagementApi,
) : ManagementRepository {

    /**
     * Import a CSV file. The bytes come in already read, because a
     * content:// reference needs the ContentResolver and the repository knows no
     * Android types; the file name goes along for the server log.
     */
    override suspend fun importCsv(
        art: CsvImportKind, fileName: String, inhalt: ByteArray,
    ): Ergebnis<CsvResultView> {
        val koerper = inhalt.toRequestBody("text/csv".toMediaType())
        val teil = MultipartBody.Part.createFormData("file", fileName, koerper)
        return sicherAufrufen {
            when (art.asData()) {
                CsvKind.SETS      -> api.importSetsCsv(teil)
                CsvKind.TEILE     -> api.importPartsCsv(teil)
                CsvKind.MINIFIGUREN -> api.importMinifigsCsv(teil)
                CsvKind.MERKLISTE -> api.importWantedCsv(teil)
                CsvKind.PREISALARME -> api.importAlertsCsv(teil)
            }
        }.promised({ it.success }) { it.alsAnsicht() }
    }

    // Server log. The server's user management stays reserved for the web app
    // — see ManagementApi.
    override suspend fun getLog(minuten: Int): Ergebnis<List<LogRowView>> =
        sicherAufrufen { api.getLog(minuten) }.promised({ it.success }) { r -> r.logs.map { it.alsAnsicht() } }

    /**
     * Set the schedule of a job — daily (HH:MM) or as an interval (minutes).
     *
     * Exactly ONE of the two: the server reads `time` for daily jobs and
     * `minutes` for the price job and rejects everything else. Hence two
     * named parameters here instead of a free body — which one applies is decided
     * visibly by the caller.
     */
    override suspend fun setJobSchedule(name: String, zeit: String?, minuten: Int?): Ergebnis<Unit> =
        sicherAufrufen {
            api.setJobSchedule(buildJsonObject {
                put("name", JsonPrimitive(name))
                zeit?.let { put("time", JsonPrimitive(it)) }
                minuten?.let { put("minutes", JsonPrimitive(it)) }
            })
        }.managed { }

    /** Fehlende Katalogbilder einreihen — siehe ManagementApi.queueCatalogImages. */
    override suspend fun queueCatalogImages(): Ergebnis<Unit> = sicherAufrufen { api.queueCatalogImages() }.managed { }

    /** Switch the global design (admins only). */
    override suspend fun setAppTheme(theme: Design): Ergebnis<Unit> =
        sicherAufrufen { api.setAppTheme(mapOf("theme" to theme.kennung)) }.managed { }

    /** Startup state of the server — without sign-in. */
    override suspend fun getStartupStatus(): Ergebnis<StartStateView> = sicherAufrufen { api.getStartupStatus() }.shown { it.alsAnsicht() }

    override suspend fun getJobs(): Ergebnis<JobsView> = sicherAufrufen { api.getJobs() }.shown { r ->
        JobsView(r.jobs.mapValues { it.value.alsAnsicht() }, r.schedules.mapValues { it.value.alsAnsicht() })
    }

    override suspend fun getCacheStats(): Ergebnis<CacheMetricsView> = sicherAufrufen { api.getCacheStats() }.shown { it.alsAnsicht() }

    override suspend fun getCacheTtl(): Ergebnis<String> = sicherAufrufen { api.getCacheTtl() }.shown { it.ttl }

    override suspend fun setCacheTtl(hours: Int): Ergebnis<Unit> = sicherAufrufen { api.setCacheTtl(mapOf("ttl" to hours.toString())) }.managed { }

    /**
     * Clear the cache — only prices, or everything.
     *
     * `alles = false` sends an EMPTY body and not `all=false`: the
     * server checks `req.body?.all` for truth, so both would be the same —
     * but an empty body says the same more briefly and cannot accidentally
     * be read as „everything".
     */
    override suspend fun clearCache(alles: Boolean): Ergebnis<Unit> =
        sicherAufrufen { api.clearCache(if (alles) mapOf("all" to true) else emptyMap()) }.managed { }

    override suspend fun getApiLimits(): Ergebnis<ApiLimitsView> = sicherAufrufen { api.getApiLimits() }.shown { it.limits.alsAnsicht() }

    override suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<Unit> = sicherAufrufen { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }.managed { }

    override suspend fun getBricksetQueue(): Ergebnis<List<BricksetEntryView>> =
        sicherAufrufen { api.getBricksetQueue() }.shown { r -> r.entries.map { it.alsAnsicht() } }

    override suspend fun retryBricksetEntry(setNumber: String): Ergebnis<Unit> = sicherAufrufen { api.retryBricksetEntry(setNumber) }.managed { }

    override suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<Unit> = sicherAufrufen { api.deleteBricksetEntry(setNumber) }.managed { }

    override suspend fun redownloadMissingImages(): Ergebnis<Unit> = sicherAufrufen { api.redownloadMissingImages() }.managed { }

    override suspend fun getAuftraege(status: String?, art: String?): Ergebnis<BackgroundView> =
        sicherAufrufen { api.getAuftraege(status, art) }.shown { it.alsAnsicht() }

    override suspend fun abortJobAb(id: String): Ergebnis<Unit> = sicherAufrufen { api.abortJobAb(id) }.withoutContent()

    override suspend fun repeatJob(id: String): Ergebnis<Unit> = sicherAufrufen { api.repeatJob(id) }.withoutContent()

    override suspend fun starteAuftragsArt(art: String): Ergebnis<Boolean> = sicherAufrufen { api.starteAuftragsArt(art) }.shown { it.gestartet }

    override suspend fun emptyJobKind(art: String): Ergebnis<Int> = sicherAufrufen { api.emptyJobKind(art) }.shown { it.entfernt }

    override suspend fun triggerCsvSync(): Ergebnis<Unit> = sicherAufrufen { api.triggerCsvSync() }.managed { }

    override suspend fun reimportInstructions(): Ergebnis<Int> = sicherAufrufen { api.reimportInstructions() }.managed { it.enqueued }

    override suspend fun triggerPriceJob(): Ergebnis<Unit> = sicherAufrufen { api.triggerPriceJob() }.managed { }

    // Admin-level: saves global default (Monitoring)
    override suspend fun setDefaultCondition(condition: Zustand): Ergebnis<Unit> = sicherAufrufen { api.setDefaultCondition(mapOf("condition" to condition.kennung)) }.managed { }
}

/** An admin response carries `success`: a refusal is an error, not a success. */
private inline fun <R> Ergebnis<GenericAdminResponse>.managed(f: (GenericAdminResponse) -> R): Ergebnis<R> =
    promised({ it.success }, f = f)
