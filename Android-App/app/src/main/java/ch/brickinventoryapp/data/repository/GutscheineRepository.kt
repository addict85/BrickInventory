package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.BrickApiService
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Warum ein eigenes Repository ────────────────────────────────────────────
 *
 * Dieselbe Aufteilung wie bei den anderen fuenf (Nachtrag 155, Begruendung in
 * RepoBasis.kt): Ein Fachgebiet, eine Klasse, erreichbar ueber
 * `repo.gutscheine.…`.
 *
 * ── Warum hier NICHTS zwischengespeichert wird ──────────────────────────────
 *
 * Die anderen Repositories legen Antworten im ResponseCache ab. Hier nicht,
 * und das ist eine Entscheidung: Der Cache liegt auf der Platte des Geraets.
 * Ein Gutschein besteht aus Nummer und PIN — zusammen alles, was zum Einloesen
 * noetig ist. Eine Liste davon in einer Datei, die auch nach dem Abmelden noch
 * liegt, ist genau das, was man nicht will.
 *
 * Es kostet auch nichts: Die Liste hat ein paar Zeilen und wird genau dann
 * geholt, wenn jemand sein Profil oeffnet.
 */
@Singleton
class GutscheineRepository @Inject constructor(
    api: BrickApiService,
    cache: ResponseCache,
) : RepoBasis(api, cache) {

    suspend fun liste(): Result<GutscheinListe> =
        safeCall { api.getGutscheine() }

    suspend fun anlegen(request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.legeGutscheinAn(request) }

    suspend fun aendern(id: Int, request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.aendereGutschein(id, request) }

    suspend fun loeschen(id: Int): Result<GenericResponse> =
        safeCall { api.loescheGutschein(id) }

    /**
     * Aus dem PDF anlegen — mit der Moeglichkeit, Werte von Hand beizusteuern.
     *
     * Leere Felder werden NICHT mitgeschickt (`alsTeil` gibt dafuer null
     * zurueck): Ein leerer Teil ueberschriebe auf dem Server das aus dem PDF
     * Gelesene mit nichts. Genau diesen Fall deckt der Server mit „was
     * mitkommt, gewinnt" ab — also darf nur mitkommen, was auch wirklich da
     * ist.
     *
     * Der Medientyp der Datei kommt aus der Dateiauswahl und wird nicht
     * geraten; dieselbe Regel wie beim Hochladen einer Anleitung. Der Server
     * nimmt ausschliesslich `application/pdf` an.
     */
    suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
        notiz: String? = null,
    ): Result<GutscheinAntwort> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        return safeCall {
            val antwort = api.ladeGutscheinPdfHoch(
                teil,
                alsTeil(nummer), alsTeil(pin), alsTeil(betrag), alsTeil(waehrung), alsTeil(notiz),
            )
            // ── Warum die 422 hier umgebogen wird ────────────────────────────
            //
            // Der Server antwortet mit 422, wenn er das PDF gelesen hat, aber
            // nicht genug darin stand — und legt in den Rumpf, WAS er lesen
            // konnte. Genau das braucht die Oberflaeche, um die Felder
            // vorzubelegen; die Webapp macht es ebenso.
            //
            // safeCall holt aus einem Fehlerrumpf nur `error`, also den Satz.
            // `gelesen` ginge verloren. Statt die Transportbehandlung von
            // safeCall zu verdoppeln (Zeitlimit, Abriss, 401 — sechs Zweige),
            // wird die Antwort hier in eine ERFOLGREICHE umgebogen: Der
            // Transport hat ja geklappt, und `success:false` im Rumpf sagt der
            // Oberflaeche, woran sie ist.
            if (antwort.code() == 422) {
                val roh = antwort.errorBody()?.string()
                val geparst = roh?.let {
                    runCatching { nachsichtigesJson.decodeFromString<GutscheinAntwort>(it) }.getOrNull()
                }
                if (geparst != null) retrofit2.Response.success(geparst) else antwort
            } else antwort
        }
    }

    // `pdf(id)` stand hier und holte die Bytes selbst. ENTFALLEN, ohne je
    // benutzt worden zu sein: Der vorhandene PdfViewerScreen bekommt eine
    // ADRESSE und laedt sie mit demselben angemeldeten Client (vm.apiHttpClient
    // — Bearer-Token, Klartext-Verbot und 401-Meldung haengen als Interceptor
    // daran). Ein eigener Download waere eine zweite Fassung desselben Weges
    // gewesen, und die Datei laege danach im Cache des Geraets — wo Nummer und
    // PIN eines Gutscheins nichts zu suchen haben.

    /**
     * Fuer den 422-Rumpf. Eigene Instanz statt der aus AppModule: Die haengt
     * dort am Retrofit-Konverter und wird nicht herausgereicht — sie hier
     * durchzuschleifen waere ein Konstruktor-Argument fuer eine einzige Zeile.
     * `ignoreUnknownKeys` wie dort, aus demselben Grund: Ein neues Feld auf
     * der Serverseite darf eine aeltere App nicht zum Absturz bringen.
     */
    private val nachsichtigesJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** Leer heisst „nicht mitschicken" — siehe die Begruendung bei ausPdf(). */
    private fun alsTeil(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}
