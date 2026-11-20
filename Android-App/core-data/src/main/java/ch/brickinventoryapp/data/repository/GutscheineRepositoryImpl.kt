package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.model.fach.Confirmation
import ch.brickinventoryapp.model.fach.Guthabenauskunft
import ch.brickinventoryapp.model.fach.Gutscheinangabe
import ch.brickinventoryapp.model.fach.Gutscheinspeicherung
import ch.brickinventoryapp.model.fach.VoucherView
import ch.brickinventoryapp.model.fach.PlaintextView
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.fach.Fehlercode
import ch.brickinventoryapp.vertrag.GuthabenAntwort
import ch.brickinventoryapp.vertrag.GutscheinAntwort
import ch.brickinventoryapp.vertrag.GutscheinRequest
import ch.brickinventoryapp.vertrag.ZweiterFaktorAnfrage
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.fach.asMoney
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil. Lokal abgelegt wird die
 * Liste ohne PIN und nur mit den letzten vier Ziffern der Nummer: Offline reicht
 * „welcher Gutschein, wie viel“; Nummer plus PIN wären Geld auf der Platte.
 */
@Singleton
class GutscheineRepositoryImpl @Inject constructor(
    private val api: VouchersApi,
    private val ablage: Offlineablage,
    private val json: Json = BrickJson,
) : VouchersRepository {

    override suspend fun liste(): Ergebnis<List<VoucherView>> =
        ablage.reconciled(Slots.GUTSCHEINE, { l -> l.map { withoutSecret(it) } }, { it }) {
            sicherAufrufen { api.getVouchers() }.shown { l -> l.vouchers.map { it.alsAnsicht() } }
        }

    override suspend fun anlegen(angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung> =
        sicherAufrufen { api.putVoucherAn(angabe.asRequest()) }.gespeichert()

    override suspend fun aendern(id: Int, angabe: Gutscheinangabe): Ergebnis<Gutscheinspeicherung> =
        sicherAufrufen { api.changeVoucher(id, angabe.asRequest()) }.gespeichert()

    /**
     * Löschen mit Passwort und Code. Bewusst ohne Ausgang: Ein gepuffertes Löschen
     * müsste das Passwort bis zum nächsten Netz aufbewahren.
     */
    override suspend fun loeschen(id: Int, confirmation: Confirmation): Ergebnis<Unit> =
        sicherAufrufen { api.deleteVoucher(id, confirmation.asRequest()) }.erledigt()

    /** Nummer und PIN im Klartext; nie in Cache oder Ablage. */
    override suspend fun klartext(id: Int, confirmation: Confirmation): Ergebnis<PlaintextView> =
        sicherAufrufen { api.voucherPlaintext(id, confirmation.asRequest()) }.shown { it.alsAnsicht() }

    /**
     * Ein einmaliges Ticket für das PDF eines Gutscheins, ohne [id] für das PDF
     * aller. Die eine Stelle für den Freigabe-Vertrag; die Adresse dazu baut
     * voucherPdfAddress() in GutscheinAdressen.kt.
     */
    override suspend fun pdfRelease(id: Int?, confirmation: Confirmation): Ergebnis<String> {
        val anfrage = confirmation.asRequest()
        return sicherAufrufen { if (id == null) api.voucherExportRelease(anfrage) else api.voucherPdfRelease(id, anfrage) }
            .shown { it.ticket }
    }

    /**
     * Das Guthaben bei LEGO abfragen. Eine gesperrte Abfrage wird zu success=false,
     * weil der Durchgang über alle Karten `grund` und `wartenSek` aus dem Rumpf
     * braucht; andere Fehler bleiben Fehler.
     */
    override suspend fun guthaben(id: Int): Ergebnis<Guthabenauskunft> = sicherAufrufen {
        val antwort = api.questionBalanceAb(id)
        if (antwort.isSuccessful) return@sicherAufrufen antwort
        val roh = antwort.errorBody()?.string()
        if (Fehlerrumpf.lies(roh).errorCode !in BALANCE_LOCKED && !isAccountLimit(roh)) {
            // Der Rumpf ist gelesen; sicherAufrufen bekommt ihn neu, sonst fehlte ihm der Satz.
            return@sicherAufrufen retrofit2.Response.error(antwort.code(),
                (roh ?: "").toResponseBody("application/json".toMediaType()))
        }
        val parsed = roh?.let {
            runCatching { json.decodeFromString<GuthabenAntwort>(it) }.getOrNull()
        }
        if (parsed != null) retrofit2.Response.success(parsed)
        else retrofit2.Response.error(antwort.code(), (roh ?: "").toResponseBody("application/json".toMediaType()))
    }.shown {
        Guthabenauskunft(erfolg = it.success && it.voucher != null, gutschein = it.voucher?.alsAnsicht(), angezeigt = it.angezeigt,
            waehrungGeaendert = it.waehrungGeaendert, grund = it.grund, wartenSek = it.wartenSek, fehler = it.error)
    }

    /**
     * Aus dem PDF anlegen — mit Werten, die man von Hand beisteuert. Leere Felder
     * werden nicht mitgeschickt (`asPart` gibt null zurück): Auf dem Server gilt „was
     * mitkommt, gewinnt“, ein leerer Teil überschriebe das Gelesene mit nichts. Der
     * Medientyp kommt aus der Dateiauswahl, nicht geraten; der Server nimmt nur
     * `application/pdf` an.
     */
    override suspend fun fromPdf(
        fileName: String,
        typ: String,
        inhalt: ByteArray,
        nummer: String?,
        pin: String?,
        betrag: String?,
        waehrung: String?,
    ): Ergebnis<Gutscheinspeicherung> {
        val koerper = inhalt.toRequestBody(typ.toMediaType())
        val teil = okhttp3.MultipartBody.Part.createFormData("file", fileName, koerper)
        return sicherAufrufen {
            val antwort = api.loadVoucherPdfHigh(
                teil,
                asPart(nummer), asPart(pin), asPart(betrag), asPart(waehrung),
            )
            // Bei 422 hat der Server das PDF gelesen, aber nicht genug gefunden; was er
            // lesen konnte, braucht die Oberfläche zum Vorbelegen. sicherAufrufen behielte nur
            // Satz und Code, deshalb wird die Antwort hier zu success=false.
            if (antwort.code() == 422) {
                val roh = antwort.errorBody()?.string()
                // Zu viele Seiten: Gelesen wurde nichts, das Formular hat nichts vorzubelegen.
                // Ein Fehler mit Satz und Code, sonst hiesse es „unvollständig gelesen“.
                val toLang = Fehlerrumpf.lies(roh).errorCode == Fehlercode.PDF_ZU_VIELE_SEITEN
                val parsed = roh?.takeIf { !toLang }?.let {
                    runCatching { json.decodeFromString<GutscheinAntwort>(it) }.getOrNull()
                }
                when {
                    parsed != null -> retrofit2.Response.success(parsed)
                    toLang -> retrofit2.Response.error<GutscheinAntwort>(antwort.code(), (roh ?: "").toResponseBody("application/json".toMediaType()))
                    else -> antwort
                }
            } else antwort
        }.shown { a ->
            if (a.success) Gutscheinspeicherung.Gespeichert(a.mehrere?.added, a.mehrere?.updated)
            else a.gelesen.let { g -> Gutscheinspeicherung.Incomplete(g?.number, g?.pin, g?.amount.asMoney(), g?.currency) }
        }
    }

    // Kein eigener PDF-Download: Der PDF-Betrachter bekommt eine Adresse und lädt sie mit
    // dem angemeldeten Client (AnleitungsLader — Token, Klartext-Verbot und
    // 401-Meldung hängen daran). Ein eigener Weg wäre eine zweite Fassung und legte
    // Nummer und PIN in den Cache des Geräts.

    companion object {
        /** Was offline von einem Gutschein bleibt: keine PIN, von der Nummer die letzten vier Ziffern. */
        fun withoutSecret(g: VoucherView): VoucherView =
            g.copy(number = if (g.number.length > 4) "…" + g.number.takeLast(4) else g.number, pin = null)

        /** Die Codes, unter denen der Server eine Guthabenabfrage zurückstellt. */
        private val BALANCE_LOCKED = setOf(Fehlercode.GUTHABEN_ABSTAND, Fehlercode.GUTHABEN_BOTSCHUTZ)

        /** Die Grenze je Konto teilt den Code mit der allgemeinen Drossel; nur `grund` unterscheidet. */
        private fun isAccountLimit(roh: String?): Boolean = runCatching {
            val o = org.json.JSONObject(roh ?: return false)
            Fehlercode.aus(o.optString("code")) == Fehlercode.ZU_VIELE_ANFRAGEN && o.optString("grund") == "konto"
        }.getOrDefault(false)
    }

    /** Leer heisst „nicht mitschicken" — siehe die Begruendung bei fromPdf(). */
    private fun asPart(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}

/** Eine Absage beim Anlegen oder Ändern ist ein Fehler mit dem Satz des Servers. */
private fun Ergebnis<GutscheinAntwort>.gespeichert(): Ergebnis<Gutscheinspeicherung> =
    promised({ it.success }, { it.error }) { Gutscheinspeicherung.Gespeichert(it.mehrere?.added, it.mehrere?.updated) }

private fun Gutscheinangabe.asRequest() = GutscheinRequest(number = nummer, pin = pin, amount = betrag.asDouble(), currency = waehrung)

private fun Confirmation.asRequest() = ZweiterFaktorAnfrage(password = passwort, code = code)
