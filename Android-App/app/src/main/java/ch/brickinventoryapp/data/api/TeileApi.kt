package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Die Teileliste abfragen — für den Teile-Reiter und den Inhalt eines Sets;
 * deshalb erben Teile- und Sets-Bereich sie beide.
 */
interface TeileAbfrageApi {

    @GET("api/v1/parts")
    suspend fun getParts(
        @Query("search") search: String? = null,
        @Query("color") color: String? = null,
        @Query("category") category: String? = null,
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 500,
        @Query("set_number") setNumber: String? = null,
        @Query("exclude_manual") excludeManual: String? = null,
        @Query("accounts") accounts: String? = null,
        // "0" = ohne Ersatzteile, "1" = nur Ersatzteile, null = alle.
        // Dieselben drei Werte wie das Auswahlfeld der Webapp (parts-spare);
        // der Server liest sie in utils/handlers/parts.ts.
        @Query("spare") spare: String? = null,
        // "1" holt zusaetzlich, in welchen Sets das Teil steckt. Kostet den
        // Server eine eigene Abfrage — deshalb nur in der Tabellenansicht,
        // genau wie in der Webapp (parts-view === 'table').
        @Query("with_sets") withSets: String? = null,
        /** Lagerort — eigener Parameter, nicht Teil der Suche (siehe Server). */
        @Query("storage") storage: String? = null
    ): Response<PartsResponse>
}

/**
 * Einzelteile, Farben und Lagerorte (TeileRepository). Lagerorte stehen hier,
 * weil ihre Verwaltung im Teile-Reiter liegt; Sets und Figuren lesen sie nur.
 */
interface TeileApi : TeileAbfrageApi {

    // ── In welchen Sets steckt dieses Teil / diese Figur? ──
    //
    // Beide Adressen beantwortet dieselbe Funktion (verwendendeSets), deshalb ein
    // Modell. `accounts` ist das Blickfeld wie sonst, damit der Dialog dasselbe sagt
    // wie die Liste, aus der man kommt.
    @GET("api/v1/parts/{partNumber}/{colorId}/sets")
    suspend fun getSetsMitTeil(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Query("accounts") accounts: String? = null,
    ): Response<VerwendendeSetsResponse>

    @GET("api/v1/parts/stats")
    suspend fun getPartsStats(
        @Query("accounts") accounts: String? = null
    ): Response<PartsStatsResponse>

    @GET("api/v1/parts/brick-colors")
    suspend fun getBrickColors(): Response<BrickColorsResponse>

    /**
     * Die Filterliste Farbe — welche Farben im Bestand vorkommen, mit Anzahl. Nicht
     * `brick-colors`: Das ist der ganze Farbkatalog für die Auswahl beim Erfassen.
     */
    @GET("api/v1/parts/colors")
    suspend fun getPartsFilterColors(
        @Query("accounts") accounts: String? = null
    ): Response<PartsFilterColorsResponse>

    /** Die Filterliste Kategorie — dieselbe Quelle wie in der Webapp. */
    @GET("api/v1/parts/categories")
    suspend fun getPartsCategories(
        @Query("accounts") accounts: String? = null
    ): Response<PartsCategoriesResponse>

    /**
     * Die Farbe eines manuell erfassten Teils ändern: alte Farbe im Pfad (sie ist Teil
     * der Kennung der Zeile), neue im Rumpf. `owner` ist der Besitzer der Karte, nicht
     * der Betrachter — ohne ihn schriebe der Server in die Zeile des Aufrufers.
     */
    @PUT("api/v1/parts/{partNumber}/{colorId}/color")
    suspend fun setPartColor(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: TeilFarbeRequest,
        @Query("owner") owner: Int? = null,
    ): Response<TeilFarbeResponse>

    // ── Lagerort ────────────────────────────────────────────────────────────
    //
    // Setzen trifft ALLE Zeilen des Teil-Farb-Paares bzw. des Sets im
    // Schreibbereich: Dasselbe Teil steckt in mehreren Sets, und wer „Kiste 3"
    // eintraegt, meint das Teil, nicht eine seiner Zeilen.

    @PUT("api/v1/parts/{partNumber}/{colorId}/storage")
    suspend fun setPartStorage(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: LagerortRequest,
    ): Response<LagerortResponse>

    // ── Der Vorrat an Lagerorten ──
    //
    // Getrennt von getLagerorte(): Dort steht, was belegt ist (Filter), hier, was zur
    // Wahl steht — ein neuer Ort ist wählbar und leer. `owner`: wessen Liste, beim Set
    // des Enkels die seine.

    @GET("api/v1/storage/locations")
    suspend fun getLagerortVorrat(
        @Query("owner") owner: String? = null,
    ): Response<LagerortVorratResponse>

    @POST("api/v1/storage/locations")
    suspend fun legeLagerortAn(
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @PUT("api/v1/storage/locations/{id}")
    suspend fun benenneLagerortUm(
        @Path("id") id: Int,
        @Body request: LagerortNameRequest,
    ): Response<LagerortEintragResponse>

    @DELETE("api/v1/storage/locations/{id}")
    suspend fun loescheLagerort(
        @Path("id") id: Int,
    ): Response<LagerortResponse>

    // Der Stern: der Lagerort, der beim Erfassen schon vorausgewählt ist.
    // EIN Endpunkt fuer setzen und abschalten (id = null), weil es eine
    // Einstellung mit genau einem Wert ist. Gelesen wird sie nicht hier,
    // sondern als Feld `vorgabe` der Vorratsantwort darueber.
    @PUT("api/v1/storage/default")
    suspend fun setzeLagerortVorgabe(
        @Body request: LagerortVorgabeRequest,
    ): Response<LagerortVorgabeResponse>

    /** Welche Lagerorte es gibt und was darin liegt — Sets UND Teile. */
    @GET("api/v1/storage")
    suspend fun getLagerorte(
        @Query("accounts") accounts: String? = null,
    ): Response<LagerorteResponse>

    @POST("api/v1/parts/owned")
    suspend fun getOwnedParts(
        @Body request: BestandRequest,
        @Query("accounts") accounts: String? = null,
    ): Response<BestandResponse>

    @POST("api/v1/parts")
    suspend fun addPart(
        @Body request: AddPartRequest
    ): Response<AddPartResponse>

    @PUT("api/v1/parts/{partNumber}/{colorId}")
    suspend fun updatePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        @Body request: UpdateManualItemRequest,
        // Wessen Karte gemeint war — siehe deletePart.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    @DELETE("api/v1/parts/{partNumber}/{colorId}")
    suspend fun deletePart(
        @Path("partNumber") partNumber: String,
        @Path("colorId") colorId: Int,
        // Wessen Karte gemeint war. null = eigenes Konto (Verhalten wie
        // bisher); ob ein fremdes erlaubt ist, entscheidet der Server.
        @Query("owner") owner: Int? = null
    ): Response<GenericResponse>

    /**
     * Die manuell erfassten Teile, mit Suchtext und Lagerort: Der Bildschirm hat ein
     * Suchfeld über manuellen und Set-Teilen, und beide sollen ihm folgen. Gefiltert
     * wird am Server (utils/handlers/parts.ts); ohne Parameter kommt alles.
     */
    @GET("api/v1/parts/manual")
    suspend fun getManualParts(
        @Query("accounts") accounts: String? = null,
        @Query("search") search: String? = null,
        @Query("storage") storage: String? = null
    ): Response<ch.brickinventoryapp.data.model.ManualPartsResponse>
}
