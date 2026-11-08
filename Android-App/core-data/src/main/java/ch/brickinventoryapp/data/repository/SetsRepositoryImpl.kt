package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Lokal
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.model.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.SetExistsResponse

/**
 * Sets: Bestand, Details, Anlegen, Ändern, PDF-Ausgabe — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class SetsRepositoryImpl @Inject constructor(
    api: SetsApi,
    cache: ResponseCache,
    ablage: Offlineablage,
) : RepoBasis<SetsApi>(api, cache, ablage), SetsRepository {

    /**
     * Galerie-Seite vom Server — gefiltert, sortiert, paginiert. Lokal abgelegt wird
     * nur die ungefilterte Liste (Seite für Seite): Eine gefilterte Antwort erschiene
     * offline als der ganze Bestand.
     */
    override suspend fun getSets(
        accounts: String?,
        search: String?,
        theme: String?,
        sort: String?,
        page: Int,
        pageSize: Int,
        storage: String?
    ): Ergebnis<SetsResponse> {
        // `storage` gehört in die Bedingung für „ungefiltert“: Sonst landete eine nach
        // Lagerort gefilterte Antwort unter dem Schlüssel der vollen Liste, und die
        // Galerie zeigte je nach Cache-Zustand mal alles, mal eine Kiste.
        val ungefiltert = accounts == null && search.isNullOrBlank() && theme.isNullOrBlank() &&
            storage.isNullOrBlank() &&
            (sort == null || sort == GALLERY_DEFAULT_SORT)
        return if (ungefiltert)
            abgeglichen(Faecher.SETS, { it.sets },
                { SetsResponse(success = true, count = it.size, sets = it, total = it.size) },
                anhaengen = page > 1) {
                safeCall { api.getSets(null, null, null, sort, page, pageSize) }
            }
        else safeCall { api.getSets(accounts, search?.ifBlank { null }, theme?.ifBlank { null }, sort, page, pageSize, storage?.ifBlank { null }) }
    }

    /**
     * Steht das Set schon im Blickfeld? Die Regel dahinter (Normalisierung der
     * Nummer, Haushalt) liegt auf dem Server — hier wird nur gefragt.
     */
    override suspend fun getSetExists(setNumber: String): Ergebnis<SetExistsResponse> =
        safeCall { api.getSetExists(setNumber) }

    override suspend fun getSetDetail(setNumber: String): Ergebnis<SetDetailResponse> =
        safeCall { api.getSetDetail(setNumber) }

    /** Setname aus dem gemeinsamen Katalog, auch fuer fremde Sets. */
    override suspend fun getSetInfo(setNumber: String): Ergebnis<SetInfoResponse> =
        safeCall { api.getSetInfo(setNumber) }

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Double?,
                       condition: String?, ownerUserId: Int?,
                       storage: String?): Ergebnis<AddSetResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId, storage)
        return schreibe(Bearbeitung.SetErfassen(anfrage),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { schluessel ->
            safeCall { api.addSet(anfrage, schluessel) }
        }
    }

    override suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: String?): Ergebnis<GenericResponse> =
        safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, null, purchasePrice, condition)) }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    override suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<GenericResponse> =
        schreibe(Bearbeitung.SetMenge(setNumber, schritt), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt), schluessel) }
        }

    // ── Merkliste ─────────────────────────────────────────────────────────
    //
    // Hier und nicht in einem eigenen Repository: Ein Merkposten ist ein Set, das
    // man noch nicht hat — dieselbe Sache, andere Tabelle. Ein sechstes
    // Repository fuer vier Aufrufe waere mehr Apparat als Nutzen.

    /** Lokal abgelegt wird nur die ungefilterte Liste — wie bei der Galerie. */
    override suspend fun getMerkliste(search: String?, condition: String?,
                             sort: String?, accounts: String?): Ergebnis<MerklisteResponse> =
        if (search.isNullOrBlank() && condition.isNullOrBlank() && accounts == null &&
            (sort == null || sort == MERKLISTE_DEFAULT_SORT))
            abgeglichen(Faecher.MERKLISTE, { it.merkposten }, { MerklisteResponse(success = true, merkposten = it) }) {
                safeCall { api.getMerkliste(search, condition, sort, accounts) }
            }
        else safeCall { api.getMerkliste(search, condition, sort, accounts) }

    /** Die lokale Merkliste (ungefiltert), wie beobachteSets. */
    override fun beobachteMerkliste(): Flow<Lokal<Merkposten>> = ablage.beobachte(Faecher.MERKLISTE)

    override suspend fun legeMerkpostenAn(setNumber: String, condition: String,
                             ownerUserId: Int?): Ergebnis<MerkpostenAntwort> {
        val anfrage = MerkpostenRequest(setNumber, condition, ownerUserId)
        return schreibe(Bearbeitung.MerkpostenAnlegen(anfrage), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { schluessel -> safeCall { api.legeMerkpostenAn(anfrage, schluessel) } }
    }

    override suspend fun verschiebeMerkposten(setNumber: String, condition: String,
                                 vonId: Int, zuId: Int): Ergebnis<MerkpostenInhaberAntwort> =
        safeCall { api.verschiebeMerkposten(setNumber, condition, MerkpostenInhaberRequest(vonId, zuId)) }

    override suspend fun loescheMerkposten(setNumber: String, condition: String,
                              ownerUserId: Int?): Ergebnis<GenericResponse> =
        schreibe(Bearbeitung.MerkpostenLoeschen(setNumber, condition, ownerUserId), { GenericResponse(success = true) }) { schluessel ->
            safeCall { api.loescheMerkposten(setNumber, condition, ownerUserId, schluessel) }
        }

    override suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseResponse> =
        safeCall { api.getMerkpostenPreise(setNumber) }

    override suspend fun uebernimmMerkposten(setNumber: String, condition: String, quantity: Int,
                                purchasePrice: Double?, erfasstAls: String?,
                                ownerUserId: Int?,
                                storage: String?): Ergebnis<MerkpostenUebernahmeResponse> =
        safeCall { api.uebernimmMerkposten(setNumber, condition,
                                       MerkpostenUebernahmeRequest(quantity, purchasePrice,
                                                               erfasstAls, ownerUserId, storage)) }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse> =
        safeCall { api.deleteSet(setNumber) }.also { if (it is Ergebnis.Success) ablage.entferne(Faecher.SETS, setNumber) }

    /** Die lokale Liste der Galerie (ungefiltert); sie ändert sich auch durch offline Bearbeitetes. */
    override fun beobachteSets(): Flow<Lokal<SetItem>> = ablage.beobachte(Faecher.SETS)

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<MoveSetResponse> =
        safeCall { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }

    // ── Preisalarm ──────────────────────────────────────────────────────────
    //
    // BEWUSST ohne Zwischenspeicher: Ein Alarm wird selten gelesen (nur beim
    // Oeffnen des Detailbildschirms) und aendert sich durch den Preislauf auch
    // ohne Zutun der App — der Merker `ausgeloest` springt dort um. Ein
    // Speicher zeigte danach „scharf", waehrend die Mail schon unterwegs ist.
    /**
     * Was seit `since` ausgeloest hat.
     *
     * Ohne Zwischenspeicher, und zwar besonders deutlich: Diese Antwort ist
     * genau EINMAL gueltig — beim zweiten Lesen derselben Antwort kaeme
     * dieselbe Meldung ein zweites Mal.
     */
    override suspend fun getPendingAlerts(since: String?): Ergebnis<PendingAlertsResponse> =
        safeCall { api.getPendingAlerts(since) }

    /** Alle Alarme des Kontos — die Uebersicht in den Einstellungen. */
    override suspend fun getAlleAlarme(): Ergebnis<PreisalarmeResponse> =
        safeCall { api.getAlleAlarme() }

    override suspend fun getPreisalarme(setNumber: String): Ergebnis<PreisalarmeResponse> =
        safeCall { api.getPreisalarme(setNumber) }

    override suspend fun setPreisalarm(setNumber: String, richtung: String, schwelle: Double,
                              condition: String): Ergebnis<PreisalarmResponse> =
        safeCall { api.setPreisalarm(setNumber, PreisalarmRequest(richtung, schwelle, condition)) }

    override suspend fun deletePreisalarm(setNumber: String, condition: String):
        Ergebnis<PreisalarmResponse> =
        safeCall { api.deletePreisalarm(setNumber, condition) }

    /** Lagerort eines Sets setzen. Leerer Text loescht ihn. */
    override suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<LagerortResponse> =
        safeCall { api.setSetStorage(setNumber, LagerortRequest(ort)) }

    override suspend fun getSetPartsList(setNumber: String): Ergebnis<PartsResponse> =
        safeCall { api.getSetPartsList(setNumber) }

    override suspend fun getSetMinifigsList(setNumber: String): Ergebnis<MinifigsResponse> =
        safeCall { api.getSetMinifigsList(setNumber) }

    override suspend fun getMinifigsForSet(setNumber: String): Ergebnis<MinifigsResponse> =
        safeCall { api.getMinifigs(setNumber = setNumber) }

    override suspend fun getPartsForSet(setNumber: String): Ergebnis<PartsResponse> =
        safeCall { api.getParts(page = 1, pageSize = 2000, setNumber = setNumber) }

    override suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeResponse> =
        safeCall { api.getBarcodeSet(barcode) }

    override suspend fun getCsvImportStatus(serverUrl: String, token: String): Ergebnis<CsvImportStatus> {
        // Use full URL via Retrofit @Url — bypasses localhost rewrite, uses existing SSL client
        // Umgezogen nach /api/v1 — ein Adressraum (siehe server.ts).
        val url = serverUrl.trimEnd('/') + "/api/v1/sets/import/csv/status"
        return safeCall { api.getCsvImportStatusDirect(url, "Bearer $token") }
    }

    /** Laufenden CSV-Import abbrechen — siehe SetsApi.cancelCsvImport. */
    override suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse> = safeCall { api.cancelCsvImport() }

    /** Download finished PDF — returns bytes */
    override suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray> {
        return fangeAusserAbbruch {
            val response = api.downloadPdf(jobId)
            if (response.isSuccessful) {
                val bytes = response.body()?.bytes() ?: ByteArray(0)
                if (bytes.size > 100) Ergebnis.Success(bytes)
                // Zu kleine Antwort heisst in der Praxis: Fehlerseite statt PDF.
                // Die Grösse gehört ins Log, nicht in die Meldung.
                else Ergebnis.Error("", art = Fehlerart.LEERE_ANTWORT, technisch = "PDF ${bytes.size} bytes")
            } else {
                Ergebnis.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }

    /** Start async PDF job — returns jobId or error */
    override suspend fun startPdfJob(bodyJson: String): Ergebnis<String> {
        return fangeAusserAbbruch {
            val requestBody = bodyJson.toRequestBody("application/json; charset=utf-8".toMediaType())
            val response = api.startPdfJob(requestBody)
            if (response.isSuccessful) {
                val body = response.body()?.string() ?: ""
                val jobId = org.json.JSONObject(body).optString("jobId", "")
                if (jobId.isNotBlank()) Ergebnis.Success(jobId)
                else Ergebnis.Error("", art = Fehlerart.LEERE_ANTWORT)
            } else {
                Ergebnis.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }

    /** Poll PDF job status — returns "running", "done", or "error" */
    override suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfJobStatus> {
        return fangeAusserAbbruch {
            val response = api.getPdfJobStatus(jobId)
            if (response.isSuccessful) {
                val body = response.body()?.string() ?: ""
                val obj = org.json.JSONObject(body)
                val status = obj.optString("status", "error")
                val eta = if (obj.has("etaSeconds") && !obj.isNull("etaSeconds")) obj.optInt("etaSeconds") else null
                Ergebnis.Success(PdfJobStatus(status, eta))
            } else {
                Ergebnis.Error("", art = Fehlerart.SERVER, httpCode = response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error("", art = Fehlerart.UNBEKANNT, technisch = e.message)
        }
    }
    /**
     * Eine Anleitung hochladen — PDF, JPG oder PNG. Der Typ kommt aus der Dateiauswahl
     * und wird nicht geraten: Der Server leitet die Dateiendung aus dem gemeldeten Typ
     * ab und lehnt alles ausserhalb seiner festen Liste ab (routes/sets.ts) —
     * `application/octet-stream` würde abgewiesen, obwohl die Datei in Ordnung ist.
     */
    override suspend fun uploadAnleitung(
        setNumber: String, dateiname: String, typ: String, inhalt: ByteArray, beschreibung: String,
    ): Ergebnis<GenericResponse> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        val text = beschreibung.toRequestBody("text/plain".toMediaType())
        return safeCall { api.uploadAnleitung(setNumber, teil, text) }
    }

    override suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<GenericResponse> =
        safeCall { api.deleteAnleitung(setNumber, instrId) }
}
