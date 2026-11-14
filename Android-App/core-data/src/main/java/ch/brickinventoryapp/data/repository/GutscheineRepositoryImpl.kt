package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.data.model.Fehlercode
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.model.data.model.GuthabenAntwort
import ch.brickinventoryapp.model.data.model.Gutschein
import ch.brickinventoryapp.model.data.model.GutscheinAntwort
import ch.brickinventoryapp.model.data.model.GutscheinKlartext
import ch.brickinventoryapp.model.data.model.GutscheinListe
import ch.brickinventoryapp.model.data.model.GutscheinPdfFreigabe
import ch.brickinventoryapp.model.data.model.GutscheinRequest
import ch.brickinventoryapp.model.data.model.ZweiterFaktorAnfrage
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil. Lokal abgelegt wird die
 * Liste ohne PIN und nur mit den letzten vier Ziffern der Nummer: Offline reicht
 * „welcher Gutschein, wie viel“; Nummer plus PIN wären Geld auf der Platte.
 */
@Singleton
class GutscheineRepositoryImpl @Inject constructor(
    private val api: GutscheineApi,
    private val ablage: Offlineablage,
    private val json: Json = BrickJson,
) : GutscheineRepository {

    override suspend fun liste(): Ergebnis<GutscheinListe> =
        ablage.abgeglichen(Faecher.GUTSCHEINE, { l -> l.vouchers.map { ohneGeheimnis(it) } },
            { GutscheinListe(success = true, vouchers = it) }) { sicherAufrufen { api.getGutscheine() } }

    override suspend fun anlegen(request: GutscheinRequest): Ergebnis<GutscheinAntwort> =
        sicherAufrufen { api.legeGutscheinAn(request) }

    override suspend fun aendern(id: Int, request: GutscheinRequest): Ergebnis<GutscheinAntwort> =
        sicherAufrufen { api.aendereGutschein(id, request) }

    /**
     * Löschen mit Passwort und Code. Bewusst ohne Ausgang: Ein gepuffertes Löschen
     * müsste das Passwort bis zum nächsten Netz aufbewahren.
     */
    override suspend fun loeschen(id: Int, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GenericResponse> =
        sicherAufrufen { api.loescheGutschein(id, bestaetigung) }

    /** Nummer und PIN im Klartext; nie in Cache oder Ablage. */
    override suspend fun klartext(id: Int, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GutscheinKlartext> =
        sicherAufrufen { api.gutscheinKlartext(id, bestaetigung) }

    /**
     * Ein einmaliges Ticket für das PDF eines Gutscheins, ohne [id] für das PDF
     * aller. Die eine Stelle für den Freigabe-Vertrag; die Adresse dazu baut
     * gutscheinPdfAdresse() in GutscheinAdressen.kt.
     */
    override suspend fun pdfFreigabe(id: Int?, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<GutscheinPdfFreigabe> =
        sicherAufrufen { if (id == null) api.gutscheinExportFreigabe(bestaetigung) else api.gutscheinPdfFreigabe(id, bestaetigung) }

    /**
     * Das Guthaben bei LEGO abfragen. Eine gesperrte Abfrage wird zu success=false,
     * weil der Durchgang über alle Karten `grund` und `wartenSek` aus dem Rumpf
     * braucht; andere Fehler bleiben Fehler.
     */
    override suspend fun guthaben(id: Int): Ergebnis<GuthabenAntwort> = sicherAufrufen {
        val antwort = api.frageGuthabenAb(id)
        if (antwort.isSuccessful) return@sicherAufrufen antwort
        val roh = antwort.errorBody()?.string()
        if (Fehlerrumpf.lies(roh).fehlercode !in GUTHABEN_GESPERRT && !istKontogrenze(roh)) {
            // Der Rumpf ist gelesen; sicherAufrufen bekommt ihn neu, sonst fehlte ihm der Satz.
            return@sicherAufrufen retrofit2.Response.error(antwort.code(),
                (roh ?: "").toResponseBody("application/json".toMediaType()))
        }
        val geparst = roh?.let {
            runCatching { json.decodeFromString<GuthabenAntwort>(it) }.getOrNull()
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
    override suspend fun ausPdf(
        dateiname: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String?,
        pin: String?,
        betrag: String?,
        waehrung: String?,
    ): Ergebnis<GutscheinAntwort> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", dateiname, koerper)
        return sicherAufrufen {
            val antwort = api.ladeGutscheinPdfHoch(
                teil,
                alsTeil(nummer), alsTeil(pin), alsTeil(betrag), alsTeil(waehrung),
            )
            // Bei 422 hat der Server das PDF gelesen, aber nicht genug gefunden; was er
            // lesen konnte, braucht die Oberfläche zum Vorbelegen. sicherAufrufen behielte nur
            // Satz und Code, deshalb wird die Antwort hier zu success=false.
            if (antwort.code() == 422) {
                val roh = antwort.errorBody()?.string()
                // Zu viele Seiten: Gelesen wurde nichts, das Formular hat nichts vorzubelegen.
                // Ein Fehler mit Satz und Code, sonst hiesse es „unvollständig gelesen“.
                val zuLang = Fehlerrumpf.lies(roh).fehlercode == Fehlercode.PDF_ZU_VIELE_SEITEN
                val geparst = roh?.takeIf { !zuLang }?.let {
                    runCatching { json.decodeFromString<GutscheinAntwort>(it) }.getOrNull()
                }
                when {
                    geparst != null -> retrofit2.Response.success(geparst)
                    zuLang -> retrofit2.Response.error<GutscheinAntwort>(antwort.code(), (roh ?: "").toResponseBody("application/json".toMediaType()))
                    else -> antwort
                }
            } else antwort
        }
    }

    // Kein eigener PDF-Download: Der PDF-Betrachter bekommt eine Adresse und lädt sie mit
    // dem angemeldeten Client (AnleitungsLader — Token, Klartext-Verbot und
    // 401-Meldung hängen daran). Ein eigener Weg wäre eine zweite Fassung und legte
    // Nummer und PIN in den Cache des Geräts.

    companion object {
        /** Was offline von einem Gutschein bleibt: keine PIN, von der Nummer die letzten vier Ziffern. */
        fun ohneGeheimnis(g: Gutschein): Gutschein =
            g.copy(number = if (g.number.length > 4) "…" + g.number.takeLast(4) else g.number, pin = null)

        /** Die Codes, unter denen der Server eine Guthabenabfrage zurückstellt. */
        private val GUTHABEN_GESPERRT = setOf(Fehlercode.GUTHABEN_ABSTAND, Fehlercode.GUTHABEN_BOTSCHUTZ)

        /** Die Grenze je Konto teilt den Code mit der allgemeinen Drossel; nur `grund` unterscheidet. */
        private fun istKontogrenze(roh: String?): Boolean = runCatching {
            val o = org.json.JSONObject(roh ?: return false)
            Fehlercode.aus(o.optString("code")) == Fehlercode.ZU_VIELE_ANFRAGEN && o.optString("grund") == "konto"
        }.getOrDefault(false)
    }

    /** Leer heisst „nicht mitschicken" — siehe die Begruendung bei ausPdf(). */
    private fun alsTeil(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}
