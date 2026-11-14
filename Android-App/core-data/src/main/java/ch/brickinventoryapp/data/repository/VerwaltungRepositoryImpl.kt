package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.VerwaltungApi
import ch.brickinventoryapp.model.ui.model.ApiGrenzenAnsicht
import ch.brickinventoryapp.model.ui.model.BricksetEintragAnsicht
import ch.brickinventoryapp.model.ui.model.CacheKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.CsvErgebnisAnsicht
import ch.brickinventoryapp.model.ui.model.CsvImportArt
import ch.brickinventoryapp.model.ui.model.HintergrundAnsicht
import ch.brickinventoryapp.model.ui.model.JobsAnsicht
import ch.brickinventoryapp.model.ui.model.ProtokollZeileAnsicht
import ch.brickinventoryapp.model.ui.model.StartzustandAnsicht
import ch.brickinventoryapp.vertrag.CsvArt
import ch.brickinventoryapp.vertrag.GenericAdminResponse
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsDaten
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
    private val api: VerwaltungApi,
) : VerwaltungRepository {

    /**
     * Eine CSV-Datei importieren. Die Bytes kommen fertig gelesen herein, weil ein
     * content://-Verweis den ContentResolver braucht und das Repository keine
     * Android-Typen kennt; der Dateiname geht fürs Serverprotokoll mit.
     */
    override suspend fun importiereCsv(
        art: CsvImportArt, dateiname: String, inhalt: ByteArray,
    ): Ergebnis<CsvErgebnisAnsicht> {
        val koerper = inhalt.toRequestBody("text/csv".toMediaType())
        val teil = MultipartBody.Part.createFormData("file", dateiname, koerper)
        return sicherAufrufen {
            when (art.alsDaten()) {
                CsvArt.SETS      -> api.importSetsCsv(teil)
                CsvArt.TEILE     -> api.importPartsCsv(teil)
                CsvArt.MINIFIGUREN -> api.importMinifigsCsv(teil)
                CsvArt.MERKLISTE -> api.importMerklisteCsv(teil)
                CsvArt.PREISALARME -> api.importAlarmeCsv(teil)
            }
        }.zugesagt({ it.success }, { it.error }) { it.alsAnsicht() }
    }

    // Server-Protokoll. Die Nutzerverwaltung des Servers bleibt der Webapp vorbehalten
    // — siehe VerwaltungApi.
    override suspend fun getProtokoll(minuten: Int): Ergebnis<List<ProtokollZeileAnsicht>> =
        sicherAufrufen { api.getProtokoll(minuten) }.zugesagt({ it.success }, { it.error }) { r -> r.logs.map { it.alsAnsicht() } }

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
        }.verwaltet { }

    /** Fehlende Katalogbilder einreihen — siehe VerwaltungApi.queueCatalogImages. */
    override suspend fun queueCatalogImages(): Ergebnis<Unit> = sicherAufrufen { api.queueCatalogImages() }.verwaltet { }

    /** Das globale Design umstellen (nur Verwalter). */
    override suspend fun setAppTheme(theme: Design): Ergebnis<Unit> =
        sicherAufrufen { api.setAppTheme(mapOf("theme" to theme.kennung)) }.verwaltet { }

    /** Startzustand des Servers — ohne Anmeldung. */
    override suspend fun getStartupStatus(): Ergebnis<StartzustandAnsicht> = sicherAufrufen { api.getStartupStatus() }.abgebildet { it.alsAnsicht() }

    override suspend fun getJobs(): Ergebnis<JobsAnsicht> = sicherAufrufen { api.getJobs() }.abgebildet { r ->
        JobsAnsicht(r.jobs.mapValues { it.value.alsAnsicht() }, r.schedules.mapValues { it.value.alsAnsicht() })
    }

    override suspend fun getCacheStats(): Ergebnis<CacheKennzahlenAnsicht> = sicherAufrufen { api.getCacheStats() }.abgebildet { it.alsAnsicht() }

    override suspend fun getCacheTtl(): Ergebnis<String> = sicherAufrufen { api.getCacheTtl() }.abgebildet { it.ttl }

    override suspend fun setCacheTtl(hours: Int): Ergebnis<Unit> = sicherAufrufen { api.setCacheTtl(mapOf("ttl" to hours.toString())) }.verwaltet { }

    /**
     * Cache leeren — nur Preise, oder alles.
     *
     * `alles = false` schickt einen LEEREN Rumpf und nicht `all=false`: Der
     * Server prueft `req.body?.all` auf Wahrheit, beides waere also gleich —
     * aber ein leerer Rumpf sagt dasselbe kuerzer und kann nicht versehentlich
     * als „alles" gelesen werden.
     */
    override suspend fun clearCache(alles: Boolean): Ergebnis<Unit> =
        sicherAufrufen { api.clearCache(if (alles) mapOf("all" to true) else emptyMap()) }.verwaltet { }

    override suspend fun getApiLimits(): Ergebnis<ApiGrenzenAnsicht> = sicherAufrufen { api.getApiLimits() }.abgebildet { it.limits.alsAnsicht() }

    override suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<Unit> = sicherAufrufen { api.setApiLimits(mapOf("rebrickable" to rb, "bricklink" to bl, "brickset" to bs)) }.verwaltet { }

    override suspend fun getBricksetQueue(): Ergebnis<List<BricksetEintragAnsicht>> =
        sicherAufrufen { api.getBricksetQueue() }.abgebildet { r -> r.entries.map { it.alsAnsicht() } }

    override suspend fun retryBricksetEntry(setNumber: String): Ergebnis<Unit> = sicherAufrufen { api.retryBricksetEntry(setNumber) }.verwaltet { }

    override suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<Unit> = sicherAufrufen { api.deleteBricksetEntry(setNumber) }.verwaltet { }

    override suspend fun redownloadMissingImages(): Ergebnis<Unit> = sicherAufrufen { api.redownloadMissingImages() }.verwaltet { }

    override suspend fun getAuftraege(status: String?, art: String?): Ergebnis<HintergrundAnsicht> =
        sicherAufrufen { api.getAuftraege(status, art) }.abgebildet { it.alsAnsicht() }

    override suspend fun brichAuftragAb(id: String): Ergebnis<Unit> = sicherAufrufen { api.brichAuftragAb(id) }.ohneInhalt()

    override suspend fun wiederholeAuftrag(id: String): Ergebnis<Unit> = sicherAufrufen { api.wiederholeAuftrag(id) }.ohneInhalt()

    override suspend fun starteAuftragsArt(art: String): Ergebnis<Boolean> = sicherAufrufen { api.starteAuftragsArt(art) }.abgebildet { it.gestartet }

    override suspend fun leereAuftragsArt(art: String): Ergebnis<Int> = sicherAufrufen { api.leereAuftragsArt(art) }.abgebildet { it.entfernt }

    override suspend fun triggerCsvSync(): Ergebnis<Unit> = sicherAufrufen { api.triggerCsvSync() }.verwaltet { }

    override suspend fun reimportInstructions(): Ergebnis<Int> = sicherAufrufen { api.reimportInstructions() }.verwaltet { it.enqueued }

    override suspend fun triggerPriceJob(): Ergebnis<Unit> = sicherAufrufen { api.triggerPriceJob() }.verwaltet { }

    // Admin-level: saves global default (Monitoring)
    override suspend fun setDefaultCondition(condition: Zustand): Ergebnis<Unit> = sicherAufrufen { api.setDefaultCondition(mapOf("condition" to condition.kennung)) }.verwaltet { }
}

/** Eine Verwalter-Antwort trägt `success` und `error`: eine Absage ist ein Fehler, kein Erfolg. */
private inline fun <R> Ergebnis<GenericAdminResponse>.verwaltet(f: (GenericAdminResponse) -> R): Ergebnis<R> =
    zugesagt({ it.success }, { it.error }, f)
