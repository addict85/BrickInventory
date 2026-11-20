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
 * Die Verwaltung des Servers (nur Verwalter), in Ansichten: Das Wire-Format bleibt
 * hinter der Umsetzung (VerwaltungRepositoryImpl). Aktionen ohne verwertbare Antwort
 * liefern Unit; ein `success: false` des Servers kommt als [Ergebnis.Fehler.Absage].
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

    /** Die Cache-Dauer in Stunden, wie der Server sie schreibt. */
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

    /** true, wenn wirklich ein Auftrag angelegt wurde; false, wenn schon einer lief. */
    suspend fun starteAuftragsArt(art: String): Ergebnis<Boolean>

    /** Wie viele wartende Aufträge entfernt wurden. */
    suspend fun emptyJobKind(art: String): Ergebnis<Int>

    suspend fun triggerCsvSync(): Ergebnis<Unit>

    /** Wie viele Sets zum Neueinlesen eingereiht wurden. */
    suspend fun reimportInstructions(): Ergebnis<Int>

    suspend fun triggerPriceJob(): Ergebnis<Unit>

    suspend fun setDefaultCondition(condition: Zustand): Ergebnis<Unit>
}
