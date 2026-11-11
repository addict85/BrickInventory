package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.lokal.Lokal
import ch.brickinventoryapp.model.data.model.*
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.SetExistsResponse
import kotlinx.coroutines.flow.Flow

/**
 * Sets: Bestand, Details, Anlegen, Ändern, Merkliste, Preisalarme, PDF-Ausgabe.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (SetsRepositoryImpl).
 */
interface SetsRepository {
    suspend fun getSetExists(setNumber: String): Ergebnis<SetExistsResponse>

    suspend fun getSetDetail(setNumber: String): Ergebnis<SetDetailResponse>

    suspend fun getSetInfo(setNumber: String): Ergebnis<SetInfoResponse>

    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: Zustand? = null, ownerUserId: Int? = null,
                       storage: String? = null): Ergebnis<AddSetResponse>

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null): Ergebnis<GenericResponse>

    suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<GenericResponse>

    /** Die Merkliste aus der Ablage nach Suche und Zustand, sortiert wie am Server. */
    fun beobachteMerkliste(suche: String? = null, zustand: Zustand? = null,
                           sort: Merksortierung? = null): Flow<Lokal<Merkposten>>

    /**
     * Die ungefilterte Merkliste vom Server in die lokale Ablage holen. Zu sehen ist
     * sie nur über [beobachteMerkliste]: ein Weg für die Daten, der Abruf meldet nur
     * Erfolg oder Fehler.
     */
    suspend fun aktualisiereMerkliste(): Ergebnis<Unit>

    suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                             ownerUserId: Int? = null): Ergebnis<MerkpostenAntwort>

    suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                 vonId: Int, zuId: Int): Ergebnis<MerkpostenInhaberAntwort>

    suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                              ownerUserId: Int? = null): Ergebnis<GenericResponse>

    suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseResponse>

    suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int = 1,
                                purchasePrice: Double? = null, erfasstAls: Zustand? = null,
                                ownerUserId: Int? = null,
                                storage: String? = null): Ergebnis<MerkpostenUebernahmeResponse>

    suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse>

    /**
     * Die Galerie aus der Ablage nach Suche, Thema und Lagerort, sortiert wie am
     * Server — die Quelle der Anzeige; [aktualisiereSets] füllt sie. Die Sicht über
     * gewählte Konten ist ein eigenes Lesemodell (Kontosicht).
     */
    fun beobachteSets(suche: String? = null, thema: String? = null, lagerort: String? = null,
                      sort: Setsortierung? = null): Flow<Lokal<SetItem>>

    /** Alle Seiten der ungefilterten Galerie in die Ablage; gezeigt wird die Ablage. */
    suspend fun aktualisiereSets(): Ergebnis<Unit>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Ergebnis<MoveSetResponse>

    /** Ein Kauf hat sich geändert; die Zusammenfassung des Servers geht in die Ablage. */
    suspend fun uebernimmZusammenfassung(agg: SetAggregate)

    suspend fun getPendingAlerts(since: String?): Ergebnis<PendingAlertsResponse>

    suspend fun getAlleAlarme(): Ergebnis<PreisalarmeResponse>

    suspend fun getPreisalarme(setNumber: String): Ergebnis<PreisalarmeResponse>

    suspend fun setPreisalarm(setNumber: String, richtung: String, schwelle: Double,
                              condition: Zustand = Zustand.NEU): Ergebnis<PreisalarmResponse>

    suspend fun deletePreisalarm(setNumber: String, condition: Zustand = Zustand.NEU): Ergebnis<PreisalarmResponse>

    suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<LagerortResponse>

    suspend fun getSetPartsList(setNumber: String): Ergebnis<PartsResponse>

    suspend fun getSetMinifigsList(setNumber: String): Ergebnis<MinifigsResponse>

    suspend fun getMinifigsForSet(setNumber: String): Ergebnis<MinifigsResponse>

    suspend fun getPartsForSet(setNumber: String): Ergebnis<PartsResponse>

    suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeResponse>

    suspend fun getCsvImportStatus(serverUrl: String, token: String): Ergebnis<CsvImportStatus>

    suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse>

    suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray>

    suspend fun startPdfJob(bodyJson: String): Ergebnis<String>

    suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfJobStatus>

    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<GenericResponse>

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<GenericResponse>
}
