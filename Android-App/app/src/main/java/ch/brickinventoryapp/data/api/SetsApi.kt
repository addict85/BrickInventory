package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Sets, Anleitungen, Preisalarme, Lagerort je Set, Merkliste, PDF-Export und
 * Teilelisten (SetsRepository). Erbt die Abfragen von Teilen und Figuren, weil
 * der Inhalt eines Sets über dieselben Adressen kommt.
 */
interface SetsApi : TeileAbfrageApi, FigurenAbfrageApi {

    // Umgezogen nach /api/v1: Seit der Zusammenfuehrung gibt es nur noch EINEN
    // Adressraum. Der Router dahinter ist derselbe wie vorher — nur die Adresse
    // hat sich geaendert (siehe server.ts).
    @GET("api/v1/sets/import/csv/status")
    suspend fun getCsvImportStatus(): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    /**
     * Einen laufenden CSV-Import abbrechen. Der Server vermerkt nur `cancelled`; schon
     * angelegte Sets bleiben — abgebrochen heisst „ab hier nicht weiter“, nicht
     * „rückgängig“, wie in der Webapp.
     */
    @POST("api/v1/sets/import/csv/cancel")
    suspend fun cancelCsvImport(): Response<GenericAdminResponse>

    @GET
    suspend fun getCsvImportStatusDirect(
        @retrofit2.http.Url url: String,
        @Header("Authorization") token: String
    ): Response<ch.brickinventoryapp.data.model.CsvImportStatus>

    // ── Anleitungen: hinzufügen und entfernen ──
    //
    // Der Server nimmt nur PDF, JPG und PNG an und leitet die Dateiendung aus dem
    // gemeldeten Typ ab — deshalb kommt der Typ aus der Dateiauswahl und wird nicht
    // geraten.
    @Multipart
    @POST("api/v1/sets/{setNumber}/instructions/upload")
    suspend fun uploadAnleitung(
        @Path("setNumber") setNumber: String,
        @retrofit2.http.Part datei: okhttp3.MultipartBody.Part,
        @retrofit2.http.Part("description") beschreibung: okhttp3.RequestBody,
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}/instructions/{instrId}")
    suspend fun deleteAnleitung(
        @Path("setNumber") setNumber: String,
        @Path("instrId") instrId: Int,
    ): Response<GenericResponse>

    /**
     * Nur der Name, aus dem gemeinsamen Katalog. Getrennt von getSetDetail: „Wie
     * heisst dieses Set?“ gibt es auch für fremde Sets, „was habe ich davon?“ nicht.
     */
    @GET("api/v1/sets/info/{setNumber}")
    suspend fun getSetInfo(
        @Path("setNumber") setNumber: String
    ): Response<ch.brickinventoryapp.data.model.SetInfoResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSetDetail(
        @Path("setNumber") setNumber: String
    ): Response<SetDetailResponse>

    // ── Kontofilter (Haushalt) ──
    //
    // `accounts`: "all" (Vorgabe), "own", "subs" oder die ID eines Kontos. Der Server
    // übersetzt ihn in Konto-IDs, damit Liste, Gesamtzahl, Kennzahlen und Summen aus
    // derselben Menge entstehen — im Gerät gefiltert stimmten die Zahlen nicht. null =
    // weglassen.
    @GET("api/v1/sets")
    /**
     * Galerie — auf dem Server gefiltert, sortiert und seitenweise, mit derselben
     * Regel wie die Webapp (utils/handlers.ts, getSets); eine eigene Suche im Gerät
     * kannte weder Jahr noch Sortierung.
     */
    suspend fun getSets(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("theme") theme: String? = null,
        @Query("sort") sort: String? = null,
        @Query("page") page: Int? = null,
        @Query("page_size") pageSize: Int? = null,
        /** Lagerort — eigener Parameter, nicht Teil der Suche (siehe Server). */
        @Query("storage") storage: String? = null
    ): Response<SetsResponse>

    @GET("api/v1/sets/{setNumber}")
    suspend fun getSet(
        @Path("setNumber") setNumber: String
    ): Response<SetResponse>

    @POST("api/v1/sets")
    suspend fun addSet(
        @Body request: AddSetRequest
    ): Response<AddSetResponse>

    @PUT("api/v1/sets/{setNumber}")
    suspend fun updateSetQuantity(
        @Path("setNumber") setNumber: String,
        @Body request: UpdateQuantityRequest
    ): Response<GenericResponse>

    @DELETE("api/v1/sets/{setNumber}")
    suspend fun deleteSet(
        @Path("setNumber") setNumber: String
    ): Response<GenericResponse>

    /**
     * „Kann ich das bauen?" — welche Teile einer Liste schon da sind.
     *
     * Siehe die Begruendung fuer POST an BestandRequest (TeileMinifigModels.kt).
     */
    // ── Preisalarm ──────────────────────────────────────────────────────────
    //
    // Ohne `accounts=`: Ein Alarm gehoert genau EINEM Konto (siehe Preisalarm).

    /**
     * Was seit `since` ausgeloest hat. Ohne `since` liefert der Server nichts
     * und nur den Zeitpunkt — der erste Aufruf setzt die Marke.
     */
    @GET("api/v1/alerts/pending")
    suspend fun getPendingAlerts(
        @Query("since") since: String? = null,
    ): Response<PendingAlertsResponse>

    /**
     * Alle Alarme des Kontos für die Übersicht — dieselbe Antwortform wie die
     * Einzelroute, damit es ein Modell bleibt.
     */
    @GET("api/v1/alerts")
    suspend fun getAlleAlarme(): Response<PreisalarmeResponse>

    @GET("api/v1/sets/{setNumber}/alert")
    suspend fun getPreisalarme(
        @Path("setNumber") setNumber: String,
    ): Response<PreisalarmeResponse>

    @PUT("api/v1/sets/{setNumber}/alert")
    suspend fun setPreisalarm(
        @Path("setNumber") setNumber: String,
        @Body request: PreisalarmRequest,
    ): Response<PreisalarmResponse>

    @DELETE("api/v1/sets/{setNumber}/alert")
    suspend fun deletePreisalarm(
        @Path("setNumber") setNumber: String,
        @Query("condition") condition: String = "N",
    ): Response<PreisalarmResponse>

    // ── Lagerort je Set (für Teile und Figuren siehe TeileApi) ──

    @PUT("api/v1/sets/{setNumber}/storage")
    suspend fun setSetStorage(
        @Path("setNumber") setNumber: String,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── Merkliste ──
    //
    // Der Zustand steht im Pfad, weil er zum Schlüssel gehört: Dasselbe Set neu und
    // gebraucht sind zwei Einträge.

    /**
     * Die Merkliste mit Suche, Zustand, Sortierung und Inhaber (`accounts`), dieselben
     * Namen wie bei getSets(). Alle optional, damit ein Aufruf ohne Filter dieselbe
     * Adresse ergibt.
     */
    @GET("api/v1/wanted")
    suspend fun getMerkliste(
        @Query("search") search: String? = null,
        @Query("condition") condition: String? = null,
        @Query("sort") sort: String? = null,
        @Query("accounts") accounts: String? = null,
    ): Response<MerklisteResponse>

    @POST("api/v1/wanted")
    suspend fun legeMerkpostenAn(
        @Body request: MerkpostenRequest,
    ): Response<MerkpostenAntwort>

    /**
     * Den Inhaber eines Merkpostens wechseln. PUT, weil nichts Neues entsteht; die
     * Regel (Aufnahmedatum bleibt, Alarm zieht mit) steht in utils/merkliste.ts.
     */
    @PUT("api/v1/wanted/{setNumber}/{condition}/inhaber")
    suspend fun verschiebeMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenInhaberRequest,
    ): Response<MerkpostenInhaberAntwort>

    @DELETE("api/v1/wanted/{setNumber}/{condition}")
    suspend fun loescheMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Query("owner_user_id") ownerUserId: Int? = null,
    ): Response<GenericResponse>

    /**
     * Marktpreise eines Merkpostens, frisch geholt. Nicht /sets/{sn}/price: Die
     * antwortet 404, wenn einem das Set nicht gehört — bei einem Merkposten der
     * Regelfall.
     */
    @GET("api/v1/wanted/{setNumber}/preise")
    suspend fun getMerkpostenPreise(
        @Path("setNumber") setNumber: String,
    ): Response<MerkpostenPreiseResponse>

    @POST("api/v1/wanted/{setNumber}/{condition}/uebernehmen")
    suspend fun uebernimmMerkposten(
        @Path("setNumber") setNumber: String,
        @Path("condition") condition: String,
        @Body request: MerkpostenUebernahmeRequest,
    ): Response<MerkpostenUebernahmeResponse>

    @POST("api/v1/sets/partslist-pdf")
    suspend fun startPdfJob(
        @Body body: okhttp3.RequestBody
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/partslist-pdf/status/{jobId}")
    suspend fun getPdfJobStatus(
        @Path("jobId") jobId: String
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/partslist-pdf/download/{jobId}")
    suspend fun downloadPdf(
        @Path("jobId") jobId: String
    ): retrofit2.Response<okhttp3.ResponseBody>

    @GET("api/v1/sets/{setNumber}/parts-list")
    suspend fun getSetPartsList(
        @Path("setNumber") setNumber: String
    ): Response<PartsResponse>

    @GET("api/v1/sets/{setNumber}/minifigs-list")
    suspend fun getSetMinifigsList(
        @Path("setNumber") setNumber: String
    ): Response<MinifigsResponse>

    @GET("api/v1/sets/exists/{setNumber}")
    suspend fun getSetExists(
        @Path("setNumber") setNumber: String
    ): Response<ch.brickinventoryapp.data.model.SetExistsResponse>

    @GET("api/v1/sets/barcode/{barcode}")
    suspend fun getBarcodeSet(
        @Path("barcode") barcode: String
    ): Response<BarcodeResponse>

    /**
     * Set oder einzelne Kaufpreise in ein anderes Konto verschieben; `acquisition_ids`
     * leer = das ganze Set. Was mitwandert, entscheidet der Server (utils/setMove.ts).
     */
    @POST("api/v1/sets/{setNumber}/move")
    suspend fun moveSet(
        @Path("setNumber") setNumber: String,
        @Body body: MoveSetRequest
    ): Response<MoveSetResponse>
}
