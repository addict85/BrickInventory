package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.VerwaltungApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.model.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Betrieb und Datenpflege: CSV-Import, Protokoll, Hintergrundarbeiten, Caches, Kontingente, globale Vorgaben — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class VerwaltungRepositoryImpl @Inject constructor(
    api: VerwaltungApi,
    cache: ResponseCache,
) : RepoBasis<VerwaltungApi>(api, cache), VerwaltungRepository {

    /**
     * Eine CSV-Datei importieren. Die Bytes kommen fertig gelesen herein, weil ein
     * content://-Verweis den ContentResolver braucht und das Repository keine
     * Android-Typen kennt; der Dateiname geht fürs Serverprotokoll mit.
     */
    override suspend fun importiereCsv(
        art: CsvArt, dateiname: String, inhalt: ByteArray,
    ): Ergebnis<CsvImportErgebnis> {
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
    override suspend fun getProtokoll(minuten: Int): Ergebnis<ProtokollResponse> =
        safeCall { api.getProtokoll(minuten) }

    /**
     * Zeitplan eines Jobs setzen — taeglich (HH:MM) oder als Abstand (Minuten).
     *
     * Genau EINES von beidem: Der Server liest `time` fuer taegliche Jobs und
     * `minutes` fuer den Preis-Job und weist alles andere ab. Deshalb hier zwei
     * benannte Parameter statt eines freien Rumpfes — welcher gilt, entscheidet
     * der Aufrufer sichtbar.
     */
    override suspend fun setJobSchedule(name: String, zeit: String?, minuten: Int?): Ergebnis<GenericAdminResponse> =
        safeCall {
            api.setJobSchedule(kotlinx.serialization.json.buildJsonObject {
                put("name", kotlinx.serialization.json.JsonPrimitive(name))
                zeit?.let { put("time", kotlinx.serialization.json.JsonPrimitive(it)) }
                minuten?.let { put("minutes", kotlinx.serialization.json.JsonPrimitive(it)) }
            })
        }

    /** Fehlende Katalogbilder einreihen — siehe VerwaltungApi.queueCatalogImages. */
    override suspend fun queueCatalogImages(): Ergebnis<GenericAdminResponse> = safeCall { api.queueCatalogImages() }

    /** Das globale Design umstellen (nur Verwalter). */
    override suspend fun setAppTheme(theme: String): Ergebnis<GenericAdminResponse> =
        safeCall { api.setAppTheme(mapOf("theme" to theme)) }

    /** Startzustand des Servers — ohne Anmeldung. */
    override suspend fun getStartupStatus(): Ergebnis<StartupStatus> = safeCall { api.getStartupStatus() }

    override suspend fun getJobs(): Ergebnis<JobsResponse> = safeCall { api.getJobs() }

    override suspend fun getCacheStats(): Ergebnis<CacheStatsResponse> = safeCall { api.getCacheStats() }

    override suspend fun getCacheTtl(): Ergebnis<CacheTtlResponse> = safeCall { api.getCacheTtl() }

    override suspend fun setCacheTtl(hours: Int): Ergebnis<GenericAdminResponse> = safeCall { api.setCacheTtl(mapOf("ttl" to hours.toString())) }

    /**
     * Cache leeren — nur Preise, oder alles.
     *
     * `alles = false` schickt einen LEEREN Rumpf und nicht `all=false`: Der
     * Server prueft `req.body?.all` auf Wahrheit, beides waere also gleich —
     * aber ein leerer Rumpf sagt dasselbe kuerzer und kann nicht versehentlich
     * als „alles" gelesen werden.
     */
    override suspend fun clearCache(alles: Boolean): Ergebnis<GenericAdminResponse> =
        safeCall { api.clearCache(if (alles) mapOf("all" to true) else emptyMap()) }

    override suspend fun getApiLimits(): Ergebnis<ApiLimitsResponse> = safeCall { api.getApiLimits() }

    override suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<GenericAdminResponse> = safeCall { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }

    override suspend fun getBricksetQueue(): Ergebnis<BricksetQueueResponse> = safeCall { api.getBricksetQueue() }

    override suspend fun retryBricksetEntry(setNumber: String): Ergebnis<GenericAdminResponse> = safeCall { api.retryBricksetEntry(setNumber) }

    override suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<GenericAdminResponse> = safeCall { api.deleteBricksetEntry(setNumber) }

    override suspend fun redownloadMissingImages(): Ergebnis<GenericAdminResponse> = safeCall { api.redownloadMissingImages() }

    override suspend fun getAuftraege(status: String?, art: String?): Ergebnis<AuftraegeResponse> =
        safeCall { api.getAuftraege(status, art) }

    override suspend fun brichAuftragAb(id: String): Ergebnis<AuftragAenderung> = safeCall { api.brichAuftragAb(id) }

    override suspend fun wiederholeAuftrag(id: String): Ergebnis<AuftragAenderung> = safeCall { api.wiederholeAuftrag(id) }

    override suspend fun starteAuftragsArt(art: String): Ergebnis<AuftragsArtStart> = safeCall { api.starteAuftragsArt(art) }

    override suspend fun leereAuftragsArt(art: String): Ergebnis<AuftragsArtLeerung> = safeCall { api.leereAuftragsArt(art) }

    override suspend fun triggerCsvSync(): Ergebnis<GenericAdminResponse> = safeCall { api.triggerCsvSync() }

    override suspend fun reimportInstructions(): Ergebnis<GenericAdminResponse> = safeCall { api.reimportInstructions() }

    override suspend fun triggerPriceJob(): Ergebnis<GenericAdminResponse> = safeCall { api.triggerPriceJob() }

    // Admin-level: saves global default (Monitoring)
    override suspend fun setDefaultCondition(condition: Zustand): Ergebnis<GenericAdminResponse> = safeCall { api.setDefaultCondition(mapOf("condition" to condition.kennung)) }
}
