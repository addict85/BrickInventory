package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.VerwaltungApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.decodeFromString
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Betrieb und Datenpflege: CSV-Import, Protokoll, Hintergrundarbeiten, Caches,
 * Kontingente, globale Vorgaben. Erreichbar über `repo.verwaltung.…`.
 */
@Singleton
class VerwaltungRepository @Inject constructor(
    api: VerwaltungApi,
    cache: ResponseCache,
) : RepoBasis<VerwaltungApi>(api, cache) {

    /**
     * Eine CSV-Datei importieren. Die Bytes kommen fertig gelesen herein, weil ein
     * content://-Verweis den ContentResolver braucht und das Repository keine
     * Android-Typen kennt; der Dateiname geht fürs Serverprotokoll mit.
     */
    suspend fun importiereCsv(
        art: CsvArt, dateiname: String, inhalt: ByteArray,
    ): Result<CsvImportErgebnis> {
        val koerper = inhalt.toRequestBody("text/csv".toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        return safeCall {
            when (art) {
                CsvArt.SETS      -> api.importSetsCsv(teil)
                CsvArt.TEILE     -> api.importPartsCsv(teil)
                CsvArt.MINIFIGUREN -> api.importMinifigsCsv(teil)
                CsvArt.MERKLISTE -> api.importMerklisteCsv(teil)
                CsvArt.PREISALARME -> api.importAlarmeCsv(teil)
            }
        }
    }

    // Server-Protokoll. Die Nutzerverwaltung des Servers bleibt der Webapp vorbehalten
    // — siehe VerwaltungApi.
    suspend fun getProtokoll(minuten: Int): Result<ProtokollResponse> =
        safeCall { api.getProtokoll(minuten) }

    /**
     * Zeitplan eines Jobs setzen — taeglich (HH:MM) oder als Abstand (Minuten).
     *
     * Genau EINES von beidem: Der Server liest `time` fuer taegliche Jobs und
     * `minutes` fuer den Preis-Job und weist alles andere ab. Deshalb hier zwei
     * benannte Parameter statt eines freien Rumpfes — welcher gilt, entscheidet
     * der Aufrufer sichtbar.
     */
    suspend fun setJobSchedule(name: String, zeit: String? = null, minuten: Int? = null): Result<GenericAdminResponse> =
        safeCall {
            api.setJobSchedule(kotlinx.serialization.json.buildJsonObject {
                put("name", kotlinx.serialization.json.JsonPrimitive(name))
                zeit?.let { put("time", kotlinx.serialization.json.JsonPrimitive(it)) }
                minuten?.let { put("minutes", kotlinx.serialization.json.JsonPrimitive(it)) }
            })
        }

    /** Fehlende Katalogbilder einreihen — siehe VerwaltungApi.queueCatalogImages. */
    suspend fun queueCatalogImages(): Result<GenericAdminResponse> = safeCall { api.queueCatalogImages() }

    /** Das globale Design umstellen (nur Verwalter). */
    suspend fun setAppTheme(theme: String): Result<GenericAdminResponse> =
        safeCall { api.setAppTheme(mapOf("theme" to theme)) }

    /** Startzustand des Servers — ohne Anmeldung. */
    suspend fun getStartupStatus(): Result<StartupStatus> = safeCall { api.getStartupStatus() }

    suspend fun getJobs(): Result<JobsResponse> = safeCall { api.getJobs() }

    suspend fun getCacheStats(): Result<CacheStatsResponse> = safeCall { api.getCacheStats() }

    suspend fun getCacheTtl(): Result<CacheTtlResponse> = safeCall { api.getCacheTtl() }

    suspend fun setCacheTtl(hours: Int): Result<GenericAdminResponse> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }

    /**
     * Cache leeren — nur Preise, oder alles.
     *
     * `alles = false` schickt einen LEEREN Rumpf und nicht `all=false`: Der
     * Server prueft `req.body?.all` auf Wahrheit, beides waere also gleich —
     * aber ein leerer Rumpf sagt dasselbe kuerzer und kann nicht versehentlich
     * als „alles" gelesen werden.
     */
    suspend fun clearCache(alles: Boolean = false): Result<GenericAdminResponse> =
        safeCall { api.clearCache(if (alles) mapOf("all" to true) else emptyMap()) }

    suspend fun getApiLimits(): Result<ApiLimitsResponse> = safeCall { api.getApiLimits() }

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Result<GenericAdminResponse> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }

    suspend fun getBricksetQueue(): Result<BricksetQueueResponse> = safeCall { api.getBricksetQueue() }

    suspend fun retryBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.retryBricksetEntry(setNumber) }

    suspend fun deleteBricksetEntry(setNumber: String): Result<GenericAdminResponse> = safeCall { api.deleteBricksetEntry(setNumber) }

    suspend fun redownloadMissingImages(): Result<GenericAdminResponse> = safeCall { api.redownloadMissingImages() }

    suspend fun getAuftraege(status: String? = null, art: String? = null): Result<AuftraegeResponse> =
        safeCall { api.getAuftraege(status, art) }

    suspend fun brichAuftragAb(id: String): Result<AuftragAenderung> = safeCall { api.brichAuftragAb(id) }

    suspend fun wiederholeAuftrag(id: String): Result<AuftragAenderung> = safeCall { api.wiederholeAuftrag(id) }

    suspend fun starteAuftragsArt(art: String): Result<AuftragsArtStart> = safeCall { api.starteAuftragsArt(art) }

    suspend fun leereAuftragsArt(art: String): Result<AuftragsArtLeerung> = safeCall { api.leereAuftragsArt(art) }

    suspend fun triggerCsvSync(): Result<GenericAdminResponse> = safeCall { api.triggerCsvSync() }

    suspend fun reimportInstructions(): Result<GenericAdminResponse> = safeCall { api.reimportInstructions() }

    suspend fun triggerPriceJob(): Result<GenericAdminResponse> = safeCall { api.triggerPriceJob() }

    // Admin-level: saves global default (Monitoring)
    suspend fun setDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition)) }
}
