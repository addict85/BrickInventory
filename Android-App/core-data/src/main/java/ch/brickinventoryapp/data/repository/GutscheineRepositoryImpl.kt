package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.model.fach.Bestaetigung
import ch.brickinventoryapp.model.fach.Guthabenauskunft
import ch.brickinventoryapp.model.fach.Gutscheinangabe
import ch.brickinventoryapp.model.fach.Gutscheinspeicherung
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.model.ui.model.KlartextAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.offline.Faecher
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.fach.Fehlercode
import ch.brickinventoryapp.vertrag.GuthabenAntwort
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.GutscheinAntwort
import ch.brickinventoryapp.vertrag.GutscheinListe
import ch.brickinventoryapp.vertrag.GutscheinRequest
import ch.brickinventoryapp.vertrag.ZweiterFaktorAnfrage
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

    override suspend fun liste(): Ergebnis<List<GutscheinAnsicht>> =
        ablage.abgeglichen(Faecher.GUTSCHEINE, { l -> l.vouchers.map { ohneGeheimnis(it) } },
            { GutscheinListe(success = true, vouchers = it) }) { sicherAufrufen { api.getGutscheine() } }
            .abgebildet { l -> l.vouchers.map { it.alsAnsicht() } }

    override suspend fun anlegen(angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung> =
        sicherAufrufen { api.legeGutscheinAn(angabe.alsAnfrage()) }.gespeichert()

    override suspend fun aendern(id: Int, angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung> =
        sicherAufrufen { api.aendereGutschein(id, angabe.alsAnfrage()) }.gespeichert()

    /**
     * Löschen mit Passwort und Code. Bewusst ohne Ausgang: Ein gepuffertes Löschen
     * müsste das Passwort bis zum nächsten Netz aufbewahren.
     */
    override suspend fun loeschen(id: Int, bestaetigung: Bestaetigung): Ergebnis<Unit> =
        sicherAufrufen { api.loescheGutschein(id, bestaetigung.alsAnfrage()) }.erledigt()

    /** Nummer und PIN im Klartext; nie in Cache oder Ablage. */
    override suspend fun klartext(id: Int, bestaetigung: Bestaetigung): Ergebnis<KlartextAnsicht> =
        sicherAufrufen { api.gutscheinKlartext(id, bestaetigung.alsAnfrage()) }.abgebildet { it.alsAnsicht() }

    /**
     * Ein einmaliges Ticket für das PDF eines Gutscheins, ohne [id] für das PDF
     * aller. Die eine Stelle für den Freigabe-Vertrag; die Adresse dazu baut
     * gutscheinPdfAdresse() in GutscheinAdressen.kt.
     */
    override suspend fun pdfFreigabe(id: Int?, bestaetigung: Bestaetigung): Ergebnis<String> {
        val anfrage = bestaetigung.alsAnfrage()
        return sicherAufrufen { if (id == null) api.gutscheinExportFreigabe(anfrage) else api.gutscheinPdfFreigabe(id, anfrage) }
            .abgebildet { it.ticket }
    }

    /**
     * Das Guthaben bei LEGO abfragen. Eine gesperrte Abfrage wird zu success=false,
     * weil der Durchgang über alle Karten `grund` und `wartenSek` aus dem Rumpf
     * braucht; andere Fehler bleiben Fehler.
     */
    override suspend fun guthaben(id: Int): Ergebnis<Guthabenauskunft> = sicherAufrufen {
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
    }.abgebildet {
        Guthabenauskunft(erfolg = it.success && it.voucher != null, gutschein = it.voucher?.alsAnsicht(), angezeigt = it.angezeigt,
            waehrungGeaendert = it.waehrungGeaendert, grund = it.grund, wartenSek = it.wartenSek, fehler = it.error)
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
    ): Ergebnis<Gutscheinspeicherung> {
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
        }.abgebildet { a ->
            if (a.success) Gutscheinspeicherung.Gespeichert(a.mehrere?.added, a.mehrere?.updated)
            else a.gelesen.let { g -> Gutscheinspeicherung.Unvollstaendig(g?.number, g?.pin, g?.amount, g?.currency) }
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

/** Eine Absage beim Anlegen oder Ändern ist ein Fehler mit dem Satz des Servers. */
private fun Ergebnis<GutscheinAntwort>.gespeichert(): Ergebnis<Gutscheinspeicherung> =
    zugesagt({ it.success }, { it.error }) { Gutscheinspeicherung.Gespeichert(it.mehrere?.added, it.mehrere?.updated) }

private fun Gutscheinangabe.alsAnfrage() = GutscheinRequest(number = nummer, pin = pin, amount = betrag, currency = waehrung)

private fun Bestaetigung.alsAnfrage() = ZweiterFaktorAnfrage(password = passwort, code = code)
