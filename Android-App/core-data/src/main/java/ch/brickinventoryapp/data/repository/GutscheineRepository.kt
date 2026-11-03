package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Faecher
import ch.brickinventoryapp.data.lokal.Offlineablage
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.api.Fehlerrumpf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil. Lokal abgelegt wird die
 * Liste ohne PIN und nur mit den letzten vier Ziffern der Nummer: Offline reicht
 * „welcher Gutschein, wie viel“; Nummer plus PIN wären Geld auf der Platte.
 */
@Singleton
class GutscheineRepository @Inject constructor(
    api: GutscheineApi,
    cache: ResponseCache,
    ablage: Offlineablage = Offlineablage.fluechtig(),
) : RepoBasis<GutscheineApi>(api, cache, ablage) {

    suspend fun liste(): Result<GutscheinListe> =
        abgeglichen(Faecher.GUTSCHEINE, { l -> l.vouchers.map { ohneGeheimnis(it) } },
            { GutscheinListe(success = true, vouchers = it) }) { safeCall { api.getGutscheine() } }

    suspend fun anlegen(request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.legeGutscheinAn(request) }

    suspend fun aendern(id: Int, request: GutscheinRequest): Result<GutscheinAntwort> =
        safeCall { api.aendereGutschein(id, request) }

    /**
     * Löschen mit Passwort und Code. Bewusst ohne Ausgang: Ein gepuffertes Löschen
     * müsste das Passwort bis zum nächsten Netz aufbewahren.
     */
    suspend fun loeschen(id: Int, bestaetigung: ZweiterFaktorAnfrage): Result<GenericResponse> =
        safeCall { api.loescheGutschein(id, bestaetigung) }

    /** Nummer und PIN im Klartext; nie in Cache oder Ablage. */
    suspend fun klartext(id: Int, bestaetigung: ZweiterFaktorAnfrage): Result<GutscheinKlartext> =
        safeCall { api.gutscheinKlartext(id, bestaetigung) }

    /**
     * Ein einmaliges Ticket für das PDF eines Gutscheins, ohne [id] für das PDF
     * aller. Die eine Stelle für den Freigabe-Vertrag; die Adresse dazu baut
     * gutscheinPdfAdresse() in GutscheinAdressen.kt.
     */
    suspend fun pdfFreigabe(id: Int?, bestaetigung: ZweiterFaktorAnfrage): Result<GutscheinPdfFreigabe> =
        safeCall { if (id == null) api.gutscheinExportFreigabe(bestaetigung) else api.gutscheinPdfFreigabe(id, bestaetigung) }

    /**
     * Das Guthaben bei LEGO abfragen. Eine gesperrte Abfrage wird zu success=false,
     * weil der Durchgang über alle Karten `grund` und `wartenSek` aus dem Rumpf
     * braucht; andere Fehler bleiben Fehler.
     */
    suspend fun guthaben(id: Int): Result<GuthabenAntwort> = safeCall {
        val antwort = api.frageGuthabenAb(id)
        if (antwort.isSuccessful) return@safeCall antwort
        val roh = antwort.errorBody()?.string()
        if (Fehlerrumpf.lies(roh).code !in GUTHABEN_GESPERRT && !istKontogrenze(roh)) {
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
            // Bei 422 hat der Server das PDF gelesen, aber nicht genug gefunden; was er
            // lesen konnte, braucht die Oberfläche zum Vorbelegen. safeCall behielte nur
            // Satz und Code, deshalb wird die Antwort hier zu success=false.
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

    companion object {
        /** Was offline von einem Gutschein bleibt: keine PIN, von der Nummer die letzten vier Ziffern. */
        fun ohneGeheimnis(g: Gutschein): Gutschein =
            g.copy(number = if (g.number.length > 4) "…" + g.number.takeLast(4) else g.number, pin = null)

        /** Die Codes, unter denen der Server eine Guthabenabfrage zurückstellt. */
        private val GUTHABEN_GESPERRT = setOf("guthaben_abstand", "guthaben_botschutz")

        /** Die Grenze je Konto teilt den Code mit der allgemeinen Drossel; nur `grund` unterscheidet. */
        private fun istKontogrenze(roh: String?): Boolean = runCatching {
            val o = org.json.JSONObject(roh ?: return false)
            o.optString("code") == "zu_viele_anfragen" && o.optString("grund") == "konto"
        }.getOrDefault(false)
    }

    /** Leer heisst „nicht mitschicken" — siehe die Begruendung bei ausPdf(). */
    private fun alsTeil(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())

}
