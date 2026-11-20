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
 * Betrieb und Datenpflege: CSV-Import, Protokoll, Hintergrundarbeiten, Caches, Kontingente, globale Vorgaben — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class VerwaltungRepositoryImpl @Inject constructor(
    private val api: ManagementApi,
) : ManagementRepository {

    /**
     * Eine CSV-Datei importieren. Die Bytes kommen fertig gelesen herein, weil ein
     * content://-Verweis den ContentResolver braucht und das Repository keine
     * Android-Typen kennt; der Dateiname geht fürs Serverprotokoll mit.
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

    // Server-Protokoll. Die Nutzerverwaltung des Servers bleibt der Webapp vorbehalten
    // — siehe ManagementApi.
    override suspend fun getLog(minuten: Int): Ergebnis<List<LogRowView>> =
        sicherAufrufen { api.getLog(minuten) }.promised({ it.success }) { r -> r.logs.map { it.alsAnsicht() } }

    /**
     * Zeitplan eines Jobs setzen — taeglich (HH:MM) oder als Abstand (Minuten).
     *
     * Genau EINES von beidem: Der Server liest `time` fuer taegliche Jobs und
     * `minutes` fuer den Preis-Job und weist alles andere ab. Deshalb hier zwei
     * benannte Parameter statt eines freien Rumpfes — welcher gilt, entscheidet
     * der Aufrufer sichtbar.
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

    /** Das globale Design umstellen (nur Verwalter). */
    override suspend fun setAppTheme(theme: Design): Ergebnis<Unit> =
        sicherAufrufen { api.setAppTheme(mapOf("theme" to theme.kennung)) }.managed { }

    /** Startzustand des Servers — ohne Anmeldung. */
    override suspend fun getStartupStatus(): Ergebnis<StartStateView> = sicherAufrufen { api.getStartupStatus() }.shown { it.alsAnsicht() }

    override suspend fun getJobs(): Ergebnis<JobsView> = sicherAufrufen { api.getJobs() }.shown { r ->
        JobsView(r.jobs.mapValues { it.value.alsAnsicht() }, r.schedules.mapValues { it.value.alsAnsicht() })
    }

    override suspend fun getCacheStats(): Ergebnis<CacheMetricsView> = sicherAufrufen { api.getCacheStats() }.shown { it.alsAnsicht() }

    override suspend fun getCacheTtl(): Ergebnis<String> = sicherAufrufen { api.getCacheTtl() }.shown { it.ttl }

    override suspend fun setCacheTtl(hours: Int): Ergebnis<Unit> = sicherAufrufen { api.setCacheTtl(mapOf("ttl" to hours.toString())) }.managed { }

    /**
     * Cache leeren — nur Preise, oder alles.
     *
     * `alles = false` schickt einen LEEREN Rumpf und nicht `all=false`: Der
     * Server prueft `req.body?.all` auf Wahrheit, beides waere also gleich —
     * aber ein leerer Rumpf sagt dasselbe kuerzer und kann nicht versehentlich
     * als „alles" gelesen werden.
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

/** Eine Verwalter-Antwort trägt `success`: eine Absage ist ein Fehler, kein Erfolg. */
private inline fun <R> Ergebnis<GenericAdminResponse>.managed(f: (GenericAdminResponse) -> R): Ergebnis<R> =
    promised({ it.success }, f = f)
