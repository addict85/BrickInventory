package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Gutscheine im eigenen Profil (GutscheineRepository).
 */
interface GutscheineApi {

    // ── Gutscheine (LEGO-Geschenkkarten im eigenen Profil) ──
    //
    // Dieselben Adressen wie die Webapp; requireToken nimmt Sitzung und Bearer an.
    // Gutscheine gehören streng ihrem Besitzer, deshalb kein `accounts`-Parameter.
    @GET("api/v1/vouchers")
    suspend fun getGutscheine(): Response<GutscheinListe>

    @POST("api/v1/vouchers")
    suspend fun legeGutscheinAn(@Body request: GutscheinRequest): Response<GutscheinAntwort>

    @PUT("api/v1/vouchers/{id}")
    suspend fun aendereGutschein(
        @Path("id") id: Int,
        @Body request: GutscheinRequest,
    ): Response<GutscheinAntwort>

    @DELETE("api/v1/vouchers/{id}")
    suspend fun loescheGutschein(@Path("id") id: Int): Response<GenericResponse>

    /**
     * Einen Gutschein aus seinem PDF anlegen. Mitgeschickte Werte gewinnen gegen das
     * Gelesene; reicht das PDF nicht, antwortet der Server mit 422 und dem, was er
     * lesen konnte. Die Teile sind optional, weil ein leeres Feld das Gelesene
     * überschriebe. Enthält die Datei mehrere Gutscheine, antwortet dieselbe Route mit
     * `mehrere`.
     */
    @Multipart
    @POST("api/v1/vouchers/pdf")
    suspend fun ladeGutscheinPdfHoch(
        @retrofit2.http.Part datei: okhttp3.MultipartBody.Part,
        @retrofit2.http.Part("number") nummer: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("pin") pin: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("amount") betrag: okhttp3.RequestBody? = null,
        @retrofit2.http.Part("currency") waehrung: okhttp3.RequestBody? = null,
    ): Response<GutscheinAntwort>

    /**
     * Das Guthaben einer Karte bei LEGO abfragen und speichern. Kein Rumpf: Nummer und
     * PIN liegen schon auf dem Server. Keine Methode für alle Karten — der Server
     * erlaubt eine Abfrage je 30 Sekunden, die Oberfläche taktet sich selbst durch
     * diese Route.
     */
    @POST("api/v1/vouchers/{id}/guthaben")
    suspend fun frageGuthabenAb(@Path("id") id: Int): Response<GuthabenAntwort>

    // Kein `GET /vouchers/export/pdf`: Der Export ist eine Datei zum Behalten, und die
    // App kann Dateien nicht speichern oder weitergeben (begründet in
    // test/webapp-endpunkte.test.js, NUR_WEB).

    // Eine Methode fuer `GET /vouchers/{id}/pdf` steht hier mit Absicht NICHT:
    // Das PDF holt der PdfViewerScreen selbst ueber seine Adresse, mit dem
    // angemeldeten Client der App. Siehe gutscheinPdfAdresse() in
    // ui/viewmodel/GutscheinAdressen.kt.
}
