package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.lokal.Lokal
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.model.CsvImportStatus
import ch.brickinventoryapp.data.model.SetExistsResponse
import kotlinx.coroutines.flow.Flow

/**
 * Sets: Bestand, Details, Anlegen, Ändern, Merkliste, Preisalarme, PDF-Ausgabe.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (SetsRepositoryImpl).
 */
interface SetsRepository {
    suspend fun getSets(
        accounts: String? = null,
        search: String? = null,
        theme: String? = null,
        sort: String? = null,
        page: Int = 1,
        pageSize: Int = GALLERY_PAGE_SIZE,
        storage: String? = null
    ): Result<SetsResponse>

    suspend fun getSetExists(setNumber: String): Result<SetExistsResponse>

    suspend fun getSetDetail(setNumber: String): Result<SetDetailResponse>

    suspend fun getSetInfo(setNumber: String): Result<SetInfoResponse>

    suspend fun addSet(setNumber: String, quantity: Int = 1, purchasePrice: Double? = null,
                       condition: String? = null, ownerUserId: Int? = null,
                       storage: String? = null): Result<AddSetResponse>

    suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: String? = null): Result<GenericResponse>

    suspend fun aendereMengeUm(setNumber: String, schritt: Int): Result<GenericResponse>

    suspend fun getMerkliste(search: String? = null, condition: String? = null,
                             sort: String? = null, accounts: String? = null): Result<MerklisteResponse>

    fun beobachteMerkliste(): Flow<Lokal<Merkposten>>

    suspend fun legeMerkpostenAn(setNumber: String, condition: String,
                             ownerUserId: Int? = null): Result<MerkpostenAntwort>

    suspend fun verschiebeMerkposten(setNumber: String, condition: String,
                                 vonId: Int, zuId: Int): Result<MerkpostenInhaberAntwort>

    suspend fun loescheMerkposten(setNumber: String, condition: String,
                              ownerUserId: Int? = null): Result<GenericResponse>

    suspend fun getMerkpostenPreise(setNumber: String): Result<MerkpostenPreiseResponse>

    suspend fun uebernimmMerkposten(setNumber: String, condition: String, quantity: Int = 1,
                                purchasePrice: Double? = null, erfasstAls: String? = null,
                                ownerUserId: Int? = null,
                                storage: String? = null): Result<MerkpostenUebernahmeResponse>

    suspend fun deleteSet(setNumber: String): Result<GenericResponse>

    fun beobachteSets(): Flow<Lokal<SetItem>>

    suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>? = null): Result<MoveSetResponse>

    suspend fun getPendingAlerts(since: String?): Result<PendingAlertsResponse>

    suspend fun getAlleAlarme(): Result<PreisalarmeResponse>

    suspend fun getPreisalarme(setNumber: String): Result<PreisalarmeResponse>

    suspend fun setPreisalarm(setNumber: String, richtung: String, schwelle: Double,
                              condition: String = "N"): Result<PreisalarmResponse>

    suspend fun deletePreisalarm(setNumber: String, condition: String = "N"): Result<PreisalarmResponse>

    suspend fun setSetStorage(setNumber: String, ort: String): Result<LagerortResponse>

    suspend fun getSetPartsList(setNumber: String): Result<PartsResponse>

    suspend fun getSetMinifigsList(setNumber: String): Result<MinifigsResponse>

    suspend fun getMinifigsForSet(setNumber: String): Result<MinifigsResponse>

    suspend fun getPartsForSet(setNumber: String): Result<PartsResponse>

    suspend fun resolveBarcode(barcode: String): Result<BarcodeResponse>

    suspend fun getCsvImportStatus(serverUrl: String, token: String): Result<CsvImportStatus>

    suspend fun cancelCsvImport(): Result<GenericAdminResponse>

    suspend fun downloadPdf(jobId: String): Result<ByteArray>

    suspend fun startPdfJob(bodyJson: String): Result<String>

    suspend fun getPdfJobStatus(jobId: String): Result<PdfJobStatus>

    suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Result<GenericResponse>

    suspend fun deleteAnleitung(setNumber: String, instrId: Int): Result<GenericResponse>
}
