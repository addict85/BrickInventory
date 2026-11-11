package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Netzlage.Wiederholung
import kotlinx.coroutines.flow.map
import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.offline.Bearbeitung
import ch.brickinventoryapp.offline.Filterspalten
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage.Nachzug
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
    private val wiederholung: Wiederholung,
) : SetsRepository {

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
        // Der Server kann deckeln (fremde Exemplare bleiben): Es gilt seine Zahl.
        ablage.nachgezogen({ r -> Nachzug.SetMengeGesetzt(setNumber, r.quantity ?: quantity).takeIf { r.success } }) {
            sicherAufrufen { api.updateSetQuantity(setNumber, UpdateQuantityRequest(quantity, null, purchasePrice, condition)) }
        }

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

    override fun beobachteMerkliste(suche: String?, zustand: Zustand?, sort: Merksortierung?): Flow<Lokal<Merkposten>> =
        ablage.beobachte(Faecher.MERKLISTE, Filterspalten(suchtext = suche?.ifBlank { null }, zustand = zustand?.kennung))
            .map { l -> l.copy(liste = l.liste.sortiert(merkOrdnung(sort))) }

    /** Die Merkliste kommt ganz, ohne Seiten: Die Gesamtzahl ist die Länge der Antwort. */
    override suspend fun aktualisiereMerkliste(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.MERKLISTE, { it.merkposten }, { it.merkposten.size }, wiederholung) { _ ->
            sicherAufrufen { api.getMerkliste(null, null, null, null) }
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
        ablage.nachgezogen({ r -> Nachzug.MerkpostenVerschoben(setNumber, condition, vonId, zuId).takeIf { r.success } }) {
            sicherAufrufen { api.verschiebeMerkposten(setNumber, condition.kennung, MerkpostenInhaberRequest(vonId, zuId)) }
        }

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
                                storage: String?): Ergebnis<MerkpostenUebernahmeResponse> {
        val anfrage = AddSetRequest(setNumber, quantity, purchasePrice, erfasstAls ?: condition, ownerUserId, storage)
        return ablage.nachgezogen({ r -> Nachzug.MerkpostenUebernommen(setNumber, condition, ownerUserId, anfrage).takeIf { r.success } }) {
            sicherAufrufen { api.uebernimmMerkposten(setNumber, condition.kennung,
                MerkpostenUebernahmeRequest(quantity, purchasePrice, erfasstAls, ownerUserId, storage)) }
        }
    }

    /** Löschen nur online: Der Papierkorb des Servers entscheidet, was zurückkommt. */
    override suspend fun deleteSet(setNumber: String): Ergebnis<GenericResponse> =
        ablage.nachgezogen({ r -> Nachzug.SetEntfernt(setNumber).takeIf { r.success } }) { sicherAufrufen { api.deleteSet(setNumber) } }

    /** Die Galerie aus der Ablage, nach den Filtern der Anzeige; ändert sich auch durch offline Bearbeitetes. */
    override fun beobachteSets(suche: String?, thema: String?, lagerort: String?, sort: Setsortierung?): Flow<Lokal<SetItem>> =
        ablage.beobachte(Faecher.SETS, Filterspalten(suchtext = suche?.ifBlank { null }, thema = thema?.ifBlank { null },
            lagerort = lagerort?.ifBlank { null })).map { l -> l.copy(liste = l.liste.sortiert(setOrdnung(sort))) }

    override suspend fun aktualisiereSets(): Ergebnis<Unit> =
        ablage.aktualisiereSeitenweise(Faecher.SETS, { it.sets }, { it.total }, wiederholung) { seite ->
            sicherAufrufen { api.getSets(null, null, null, null, seite, GALLERY_PAGE_SIZE) }
        }

    override suspend fun moveSet(setNumber: String, fromUserId: Int?, toUserId: Int,
                        acquisitionIds: List<Int>?): Ergebnis<MoveSetResponse> =
        ablage.nachgezogen({ r -> Nachzug.SetVerschoben(setNumber, fromUserId, toUserId, acquisitionIds == null).takeIf { r.success } }) {
            sicherAufrufen { api.moveSet(setNumber, MoveSetRequest(fromUserId, toUserId, acquisitionIds)) }
        }

    override suspend fun uebernimmZusammenfassung(agg: SetAggregate) {
        if (agg.setNumber.isNotBlank()) ablage.wendeAn(Nachzug.SetZusammenfassung(agg))
    }

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
        ablage.nachgezogen({ r -> Nachzug.SetLagerort(setNumber, r.storage).takeIf { r.success } }) {
            sicherAufrufen { api.setSetStorage(setNumber, LagerortRequest(ort)) }
        }

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

    // Über den api-Client wie jeder Abruf: Adresse und Token setzt der Wächter.
    override suspend fun getCsvImportStatus(): Ergebnis<CsvImportStatus> =
        sicherAufrufen { api.getCsvImportStatus() }

    /** Laufenden CSV-Import abbrechen — siehe SetsApi.cancelCsvImport. */
    override suspend fun cancelCsvImport(): Ergebnis<GenericAdminResponse> = sicherAufrufen { api.cancelCsvImport() }

    override suspend fun downloadPdf(jobId: String): Ergebnis<ByteArray> {
        val r = when (val a = sicherAufrufen { api.downloadPdf(jobId) }) {
            is Ergebnis.Success -> a
            is Ergebnis.Error -> return a
        }
        // Ohne @Streaming liegt der Rumpf schon im Speicher; ein Lesefehler ist trotzdem Transport.
        val bytes = try { r.data.use { it.bytes() } } catch (e: java.io.IOException) {
            return Ergebnis.Error.Netz(technisch = e.message)
        }
        return if (bytes.size > PDF_MINDESTGROESSE) Ergebnis.Success(bytes)
        // Die Grösse gehört ins Log, nicht in die Meldung.
        else Ergebnis.Error.LeereAntwort(technisch = "PDF ${bytes.size} bytes")
    }

    override suspend fun startPdfJob(bodyJson: String): Ergebnis<String> {
        val rumpf = bodyJson.toRequestBody("application/json; charset=utf-8".toMediaType())
        return when (val r = sicherAufrufen { api.startPdfJob(rumpf) }) {
            is Ergebnis.Success -> if (r.data.jobId.isNotBlank()) Ergebnis.Success(r.data.jobId) else Ergebnis.Error.LeereAntwort()
            is Ergebnis.Error -> r
        }
    }

    override suspend fun getPdfJobStatus(jobId: String): Ergebnis<PdfAuftragStand> =
        sicherAufrufen { api.getPdfJobStatus(jobId) }

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

/** Kleiner ist in der Praxis eine Fehlerseite statt eines PDFs. */
private const val PDF_MINDESTGROESSE = 100
