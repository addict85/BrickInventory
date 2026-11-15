package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.ApiGrenzenAnsicht
import ch.brickinventoryapp.model.fach.BricksetEintragAnsicht
import ch.brickinventoryapp.model.fach.CacheKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.CsvErgebnisAnsicht
import ch.brickinventoryapp.model.fach.CsvImportArt
import ch.brickinventoryapp.model.fach.HintergrundAnsicht
import ch.brickinventoryapp.model.fach.JobsAnsicht
import ch.brickinventoryapp.model.fach.ProtokollZeileAnsicht
import ch.brickinventoryapp.model.fach.StartzustandAnsicht
import ch.brickinventoryapp.model.ui.theme.Design

/**
 * Die Verwaltung des Servers (nur Verwalter), in Ansichten: Das Wire-Format bleibt
 * hinter der Umsetzung (VerwaltungRepositoryImpl). Aktionen ohne verwertbare Antwort
 * liefern Unit; ein `success: false` des Servers kommt als [Ergebnis.Fehler.Absage].
 */
interface VerwaltungRepository {
    suspend fun importiereCsv(art: CsvImportArt, dateiname: String, inhalt: ByteArray): Ergebnis<CsvErgebnisAnsicht>

    suspend fun getProtokoll(minuten: Int): Ergebnis<List<ProtokollZeileAnsicht>>

    suspend fun setJobSchedule(name: String, zeit: String? = null, minuten: Int? = null): Ergebnis<Unit>

    suspend fun queueCatalogImages(): Ergebnis<Unit>

    suspend fun setAppTheme(theme: Design): Ergebnis<Unit>

    suspend fun getStartupStatus(): Ergebnis<StartzustandAnsicht>

    suspend fun getJobs(): Ergebnis<JobsAnsicht>

    suspend fun getCacheStats(): Ergebnis<CacheKennzahlenAnsicht>

    /** Die Cache-Dauer in Stunden, wie der Server sie schreibt. */
    suspend fun getCacheTtl(): Ergebnis<String>

    suspend fun setCacheTtl(hours: Int): Ergebnis<Unit>

    suspend fun clearCache(alles: Boolean = false): Ergebnis<Unit>

    suspend fun getApiLimits(): Ergebnis<ApiGrenzenAnsicht>

    suspend fun setApiLimits(rb: Int, bl: Int, bs: Int): Ergebnis<Unit>

    suspend fun getBricksetQueue(): Ergebnis<List<BricksetEintragAnsicht>>

    suspend fun retryBricksetEntry(setNumber: String): Ergebnis<Unit>

    suspend fun deleteBricksetEntry(setNumber: String): Ergebnis<Unit>

    suspend fun redownloadMissingImages(): Ergebnis<Unit>

    suspend fun getAuftraege(status: String? = null, art: String? = null): Ergebnis<HintergrundAnsicht>

    suspend fun brichAuftragAb(id: String): Ergebnis<Unit>

    suspend fun wiederholeAuftrag(id: String): Ergebnis<Unit>

    /** true, wenn wirklich ein Auftrag angelegt wurde; false, wenn schon einer lief. */
    suspend fun starteAuftragsArt(art: String): Ergebnis<Boolean>

    /** Wie viele wartende Aufträge entfernt wurden. */
    suspend fun leereAuftragsArt(art: String): Ergebnis<Int>

    suspend fun triggerCsvSync(): Ergebnis<Unit>

    /** Wie viele Sets zum Neueinlesen eingereiht wurden. */
    suspend fun reimportInstructions(): Ergebnis<Int>

    suspend fun triggerPriceJob(): Ergebnis<Unit>

    suspend fun setDefaultCondition(condition: Zustand): Ergebnis<Unit>
}
