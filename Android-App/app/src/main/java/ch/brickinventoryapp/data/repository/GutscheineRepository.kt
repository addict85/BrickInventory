package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.api.Fehlerrumpf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil, erreichbar über
 * `repo.gutscheine.…` (Aufteilung wie in RepoBasis.kt).
 *
 * Hier wird nichts zwischengespeichert: Der ResponseCache liegt auf der Platte,
 * und Nummer plus PIN sind alles, was zum Einlösen nötig ist — eine Liste davon
 * gehört nicht in eine Datei, die das Abmelden überlebt. Es kostet nichts: Die
 * Liste ist kurz und wird beim Öffnen des Profils geholt.
 */
@Singleton
class GutscheineRepository @Inject constructor(
    api: GutscheineApi,
    cache: ResponseCache,
) : RepoBasis<GutscheineApi>(api, cache) {

    suspend fun liste(): Result<GutscheinListe> =
        safeCall { api.getGutscheine() }

    suspend fun anlegen(request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.legeGutscheinAn(request) }

    suspend fun aendern(id: Int, request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.aendereGutschein(id, request) }

    suspend fun loeschen(id: Int): Result<GenericResponse> =
        safeCall { api.loescheGutschein(id) }

    /**
     * Das Guthaben bei LEGO abfragen.
     *
     * Ist die Abfrage gesperrt (Code `guthaben_abstand` oder `guthaben_botschutz`),
     * braucht der Durchgang über alle Karten `grund` und `wartenSek` aus dem Rumpf;
     * safeCall behielte nur Satz und Code. Deshalb wird diese Antwort zu einer
     * gewöhnlichen mit success=false. Andere Fehler (502: die Gegenseite schwieg)
     * bleiben Fehler.
     */
    suspend fun guthaben(id: Int): Result<GuthabenAntwort> = safeCall {
        val antwort = api.frageGuthabenAb(id)
        if (antwort.isSuccessful) return@safeCall antwort
        val roh = antwort.errorBody()?.string()
        if (Fehlerrumpf.lies(roh).code !in GUTHABEN_GESPERRT) {
            // Der Rumpf ist gelesen; safeCall bekommt ihn neu, sonst fehlte ihm der Satz.
            return@safeCall retrofit2.Response.error(antwort.code(),
                (roh ?: "").toResponseBody("application/json".toMediaType()))
        }
        val geparst = roh?.let {
            runCatching { nachsichtigesJson.decodeFromString<GuthabenAntwort>(it) }.getOrNull()
        }
        if (geparst != null) retrofit2.Response.success(geparst)
        else retrofit2.Response.error(antwort.code(), (roh ?: "").toResponseBody("application/json".toMediaType()))
    }

    /**
     * Aus dem PDF anlegen — mit Werten, die man von Hand beisteuert. Leere Felder
     * werden nicht mitgeschickt (`alsTeil` gibt null zurück): Auf dem Server gilt „was
     * mitkommt, gewinnt“, ein leerer Teil überschriebe das Gelesene mit nichts. Der
     * Medientyp kommt aus der Dateiauswahl, nicht geraten; der Server nimmt nur
     * `application/pdf` an.
     */
    suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String? = null,
        pin: String? = null,
        betrag: String? = null,
        waehrung: String? = null,
    ): Result<GutscheinAntwort> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        return safeCall {
            val antwort = api.ladeGutscheinPdfHoch(
                teil,
                alsTeil(nummer), alsTeil(pin), alsTeil(betrag), alsTeil(waehrung),
            )
            // ── Warum die 422 hier umgebogen wird ──
            //
            // Bei 422 hat der Server das PDF gelesen, aber nicht genug gefunden, und legt in
            // den Rumpf, was er lesen konnte — das braucht die Oberfläche zum Vorbelegen (wie
            // die Webapp). safeCall holt aus einem Fehlerrumpf nur Satz und Code, `gelesen`
            // ginge verloren. Statt seine Transportbehandlung zu verdoppeln, wird die Antwort
            // zu einer erfolgreichen: Der Transport hat geklappt, `success:false` sagt der
            // Oberfläche, woran sie ist.
            if (antwort.code() == 422) {
                val roh = antwort.errorBody()?.string()
                val geparst = roh?.let {
                    runCatching { nachsichtigesJson.decodeFromString<GutscheinAntwort>(it) }.getOrNull()
                }
                if (geparst != null) retrofit2.Response.success(geparst) else antwort
            } else antwort
        }
    }

    // Kein eigener PDF-Download: PdfViewerScreen bekommt eine Adresse und lädt sie mit
    // dem angemeldeten Client (vm.apiHttpClient — Token, Klartext-Verbot und
    // 401-Meldung hängen daran). Ein eigener Weg wäre eine zweite Fassung und legte
    // Nummer und PIN in den Cache des Geräts.

    /**
     * Für den 422-Rumpf. Eine eigene Instanz statt der aus dem NetzModule, die am
     * Retrofit-Konverter hängt — durchgeschleift wäre sie ein Konstruktor-Argument für
     * eine Zeile. `ignoreUnknownKeys` wie dort: Ein neues Feld des Servers darf eine
     * ältere App nicht zum Absturz bringen.
     */
    private val nachsichtigesJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    private companion object {
        /** Die Codes, unter denen der Server eine Guthabenabfrage zurückstellt. */
        val GUTHABEN_GESPERRT = setOf("guthaben_abstand", "guthaben_botschutz")
    }

    /** Leer heisst „nicht mitschicken" — siehe die Begruendung bei ausPdf(). */
    private fun alsTeil(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}
