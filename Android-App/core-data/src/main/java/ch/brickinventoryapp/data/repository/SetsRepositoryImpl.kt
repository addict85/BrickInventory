package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.model.lokal.Lokal
import kotlinx.coroutines.flow.Flow
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.SetExistsResponse

/**
 * Sets: Bestand, Details, Anlegen, Ändern, PDF-Ausgabe — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class SetsRepositoryImpl @Inject constructor(
    private val api: SetsApi,
    private val ablage: Offlineablage,
) : SetsRepository {

    /**
     * Galerie-Seite vom Server — gefiltert, sortiert, paginiert. Die ungefilterte
     * Liste wird Seite für Seite abgelegt; gefiltert beantwortet sie ohne Netz
     * dieselben Filter. Nicht beim Kontofilter: Menge und Preise rechnet der Server
     * über die gewählten Konten, die lokale Zeile trägt die Summe aller.
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
        val filter = Filterspalten(suchtext = search?.ifBlank { null }, thema = theme?.ifBlank { null },
            lagerort = storage?.ifBlank { null })
        val ausLokal = { l: List<SetItem> -> l.sortiert(setOrdnung(sort)).let {
            SetsResponse(success = true, count = it.size, sets = it, total = it.size)
        } }
        val ungefiltert = search.isNullOrBlank() && theme.isNullOrBlank() && storage.isNullOrBlank() &&
            (sort == null || sort == GALLERY_DEFAULT_SORT)
        return when {
            accounts != null -> sicherAufrufen { api.getSets(accounts, filter.suchtext, filter.thema, sort, page, pageSize, filter.lagerort) }
            ungefiltert ->
                ablage.abgeglichen(Faecher.SETS, { it.sets }, ausLokal, anhaengen = page > 1) {
                    sicherAufrufen { api.getSets(null, null, null, sort, page, pageSize) }
                }
            else -> ablage.gefiltert(Faecher.SETS, filter, ausLokal) {
                sicherAufrufen { api.getSets(null, filter.suchtext, filter.thema, sort, page, pageSize, filter.lagerort) }
            }
        }
    }

    /**
     * Steht das Set schon im Blickfeld? Die Regel dahinter (Normalisierung der
     * Nummer, Haushalt) liegt auf dem Server — hier wird nur gefragt.
     */
    override suspend fun getSetExists(setNumber: String): Ergebnis<SetExistsResponse> =
        sicherAufrufen { api.getSetExists(setNumber) }

    override suspend fun getSetDetail(setNumber: String): Ergebnis<SetDetailResponse> =
        sicherAufrufen { api.getSetDetail(setNumber) }

    /** Setname aus dem gemeinsamen Katalog, auch fuer fremde Sets. */
    override suspend fun getSetInfo(setNumber: String): Ergebnis<SetInfoResponse> =
        sicherAufrufen { api.getSetInfo(setNumber) }

    override suspend fun addSet(setNumber: String, quantity: Int, purchasePrice: Double?,
                       condition: Zustand?, ownerUserId: Int?,
                       storage: String?): Ergebnis<AddSetResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, condition, ownerUserId, storage)
        return ablage.schreibe(Bearbeitung.SetErfassen(anfrage),
            { AddSetResponse(success = true, action = "gepuffert", setNumber = setNumber) }) { schluessel ->
            sicherAufrufen { api.addSet(anfrage, schluessel) }
        }
    }

    override suspend fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double?, condition: Zustand?): Ergebnis<GenericResponse> =
        sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, null, purchasePrice, condition)) }

    /** Menge um [schritt] ändern; der Server rechnet unter Bestandssperre. */
    override suspend fun aendereMengeUm(setNumber: String, schritt: Int): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.SetMenge(setNumber, schritt), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantityDelta = schritt), schluessel) }
        }

    // ── Merkliste ─────────────────────────────────────────────────────────
    //
    // Hier und nicht in einem eigenen Repository: Ein Merkposten ist ein Set, das
    // man noch nicht hat — dieselbe Sache, andere Tabelle. Ein sechstes
    // Repository fuer vier Aufrufe waere mehr Apparat als Nutzen.

    /** Wie die Galerie: ungefiltert abgelegt, gefiltert ohne Netz aus der lokalen Liste. */
    override suspend fun getMerkliste(search: String?, condition: Zustand?,
                             sort: String?, accounts: String?): Ergebnis<MerklisteResponse> {
        val filter = Filterspalten(suchtext = search?.ifBlank { null }, zustand = condition?.kennung)
        val ausLokal = { l: List<Merkposten> -> MerklisteResponse(success = true, merkposten = l.sortiert(merkOrdnung(sort))) }
        return when {
            accounts != null -> sicherAufrufen { api.getMerkliste(search, condition?.kennung, sort, accounts) }
            filter == Filterspalten() && (sort == null || sort == MERKLISTE_DEFAULT_SORT) ->
                ablage.abgeglichen(Faecher.MERKLISTE, { it.merkposten }, ausLokal) {
                    sicherAufrufen { api.getMerkliste(search, condition?.kennung, sort, accounts) }
                }
            else -> ablage.gefiltert(Faecher.MERKLISTE, filter, ausLokal) { sicherAufrufen { api.getMerkliste(search, condition?.kennung, sort, accounts) } }
        }
    }

    /** Die lokale Merkliste (ungefiltert), wie beobachteSets. */
    override fun beobachteMerkliste(): Flow<Lokal<Merkposten>> = ablage.beobachte(Faecher.MERKLISTE)

    override suspend fun aktualisiereMerkliste(): Ergebnis<Unit> = when (val r = getMerkliste()) {
        is Ergebnis.Success -> Ergebnis.Success(Unit, r.stand, r.gepuffert)
        is Ergebnis.Error -> r
    }

    override suspend fun legeMerkpostenAn(setNumber: String, condition: Zustand,
                             ownerUserId: Int?): Ergebnis<MerkpostenAntwort> {
        val anfrage = MerkpostenRequest(setNumber, condition, ownerUserId)
        return ablage.schreibe(Bearbeitung.MerkpostenAnlegen(anfrage), {
            MerkpostenAntwort(success = true, warNeu = true,
                merkposten = Merkposten(setNumber = setNumber, condition = condition, userId = ownerUserId ?: 0))
        }) { schluessel -> sicherAufrufen { api.legeMerkpostenAn(anfrage, schluessel) } }
    }

    override suspend fun verschiebeMerkposten(setNumber: String, condition: Zustand,
                                 vonId: Int, zuId: Int): Ergebnis<MerkpostenInhaberAntwort> =
        sicherAufrufen { api.verschiebeMerkposten(setNumber, condition.kennung, MerkpostenInhaberRequest(vonId, zuId)) }

    override suspend fun loescheMerkposten(setNumber: String, condition: Zustand,
                              ownerUserId: Int?): Ergebnis<GenericResponse> =
        ablage.schreibe(Bearbeitung.MerkpostenLoeschen(setNumber, condition.kennung, ownerUserId), { GenericResponse(success = true) }) { schluessel ->
            sicherAufrufen { api.loescheMerkposten(setNumber, condition.kennung, ownerUserId, schluessel) }
        }

    override suspend fun getMerkpostenPreise(setNumber: String): Ergebnis<MerkpostenPreiseResponse> =
        sicherAufrufen { api.getMerkpostenPreise(setNumber) }

    override suspend fun uebernimmMerkposten(setNumber: String, condition: Zustand, quantity: Int,
                                purchasePrice: Double?, erfasstAls: Zustand?,
                                ownerUserId: Int?,
                                storage: String?): Ergebnis<MerkpostenUebernahmeResponse> =
        sicherAufrufen { api.uebernimmMerkposten(setNumber, condition.kennung,
                                       MerkpostenUebernahmeRequest(quantity, purchasePrice,
                                                               erfasstAls, ownerUserId, storage)) }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse> =
        sicherAufrufen { api.deleteSet(setNumber) }.also { if (it is Ergebnis.Success) ablage.entferne(Faecher.SETS, setNumber) }

    /** Die lokale Liste der Galerie (ungefiltert); sie ändert sich auch durch offline Bearbeitetes. */
    override fun beobachteSets(): Flow<Lokal<SetItem>> = ablage.beobachte(Faecher.SETS)

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<MoveSetResponse> =
        sicherAufrufen { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }

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
        sicherAufrufen { api.getPendingAlerts(since) }

    /** Alle Alarme des Kontos — die Uebersicht in den Einstellungen. */
    override suspend fun getAlleAlarme(): Ergebnis<PreisalarmeResponse> =
        sicherAufrufen { api.getAlleAlarme() }

    override suspend fun getPreisalarme(setNumber: String): Ergebnis<PreisalarmeResponse> =
        sicherAufrufen { api.getPreisalarme(setNumber) }

    override suspend fun setPreisalarm(setNumber: String, richtung: String, schwelle: Double,
                              condition: Zustand): Ergebnis<PreisalarmResponse> =
        sicherAufrufen { api.setPreisalarm(setNumber, PreisalarmRequest(richtung, schwelle, condition)) }

    override suspend fun deletePreisalarm(setNumber: String, condition: Zustand):
        Ergebnis<PreisalarmResponse> =
        sicherAufrufen { api.deletePreisalarm(setNumber, condition.kennung) }

    /** Lagerort eines Sets setzen. Leerer Text loescht ihn. */
    override suspend fun setSetStorage(setNumber: String, ort: String): Ergebnis<LagerortResponse> =
        sicherAufrufen { api.setSetStorage(setNumber, LagerortRequest(ort)) }

    override suspend fun getSetPartsList(setNumber: String): Ergebnis<PartsResponse> =
        sicherAufrufen { api.getSetPartsList(setNumber) }

    override suspend fun getSetMinifigsList(setNumber: String): Ergebnis<MinifigsResponse> =
        sicherAufrufen { api.getSetMinifigsList(setNumber) }

    override suspend fun getMinifigsForSet(setNumber: String): Ergebnis<MinifigsResponse> =
        sicherAufrufen { api.getMinifigs(setNumber = setNumber) }

    override suspend fun getPartsForSet(setNumber: String): Ergebnis<PartsResponse> =
        sicherAufrufen { api.getParts(page = 1, pageSize = 2000, setNumber = setNumber) }

    override suspend fun resolveBarcode(barcode: String): Ergebnis<BarcodeResponse> =
        sicherAufrufen { api.getBarcodeSet(barcode) }

    override suspend fun getCsvImportStatus(serverUrl: String, token: String): Ergebnis<CsvImportStatus> {
        // Use full URL via Retrofit @Url — bypasses localhost rewrite, uses existing SSL client
        // Umgezogen nach /api/v1 — ein Adressraum (siehe server.ts).
        val url = serverUrl.trimEnd('/') + "/api/v1/sets/import/csv/status"
        return sicherAufrufen { api.getCsvImportStatusDirect(url, "Bearer $token") }
    }

    /** Laufenden CSV-Import abbrechen — siehe SetsApi.cancelCsvImport. */
    override suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse> = sicherAufrufen { api.cancelCsvImport() }

    /** Download finished PDF — returns bytes */
    override suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray> {
        return fangeAusserAbbruch {
            val response = api.downloadPdf(jobId)
            if (response.isSuccessful) {
                val bytes = response.body()?.bytes() ?: ByteArray(0)
                if (bytes.size > 100) Ergebnis.Success(bytes)
                // Zu kleine Antwort heisst in der Praxis: Fehlerseite statt PDF.
                // Die Grösse gehört ins Log, nicht in die Meldung.
                else Ergebnis.Error.LeereAntwort(technisch = "PDF ${bytes.size} bytes")
            } else {
                Ergebnis.Error.Server(response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error.Unbekannt(technisch = e.message)
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
                else Ergebnis.Error.LeereAntwort()
            } else {
                Ergebnis.Error.Server(response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error.Unbekannt(technisch = e.message)
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
                Ergebnis.Error.Server(response.code())
            }
        }.getOrElse { e ->
            Ergebnis.Error.Unbekannt(technisch = e.message)
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
        return sicherAufrufen { api.uploadAnleitung(setNumber, teil, text) }
    }

    override suspend fun deleteAnleitung(setNumber: String, instrId: Int): Ergebnis<GenericResponse> =
        sicherAufrufen { api.deleteAnleitung(setNumber, instrId) }
}
