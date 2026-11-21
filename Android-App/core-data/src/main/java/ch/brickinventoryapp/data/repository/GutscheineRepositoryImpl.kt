package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.Guthabenauskunft
import ch.brickinventoryapp.model.domain.Gutscheinangabe
import ch.brickinventoryapp.model.domain.Gutscheinspeicherung
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.contract.GuthabenAntwort
import ch.brickinventoryapp.contract.GutscheinAntwort
import ch.brickinventoryapp.contract.GutscheinRequest
import ch.brickinventoryapp.contract.ZweiterFaktorAnfrage
import ch.brickinventoryapp.network.data.api.Fehlerrumpf
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import ch.brickinventoryapp.model.domain.asMoney
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vouchers — LEGO gift cards in the own profile. Stored locally is the
 * list without PIN and only with the last four digits of the number: offline
 * „which voucher, how much“ suffices; number plus PIN would be money on disk.
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
     * Delete with password and code. Deliberately without outbox: a buffered delete
     * would have to keep the password until the next network.
     */
    override suspend fun loeschen(id: Int, confirmation: Confirmation): Ergebnis<Unit> =
        sicherAufrufen { api.deleteVoucher(id, confirmation.asRequest()) }.erledigt()

    /** Number and PIN in plaintext; never in cache or store. */
    override suspend fun klartext(id: Int, confirmation: Confirmation): Ergebnis<PlaintextView> =
        sicherAufrufen { api.voucherPlaintext(id, confirmation.asRequest()) }.shown { it.alsAnsicht() }

    /**
     * A one-time ticket for the PDF of a voucher, without [id] for the PDF
     * of all. The one place for the release contract; the address for it is built by
     * voucherPdfAddress() in GutscheinAdressen.kt.
     */
    override suspend fun pdfRelease(id: Int?, confirmation: Confirmation): Ergebnis<String> {
        val anfrage = confirmation.asRequest()
        return sicherAufrufen { if (id == null) api.voucherExportRelease(anfrage) else api.voucherPdfRelease(id, anfrage) }
            .shown { it.ticket }
    }

    /**
     * Query the balance at LEGO. A blocked query becomes success=false
     * because the pass over all cards needs `grund` and `wartenSek` from the body;
     * other errors stay errors.
     */
    override suspend fun guthaben(id: Int): Ergebnis<Guthabenauskunft> = sicherAufrufen {
        val antwort = api.questionBalanceAb(id)
        if (antwort.isSuccessful) return@sicherAufrufen antwort
        val roh = antwort.errorBody()?.string()
        if (Fehlerrumpf.lies(roh).errorCode !in BALANCE_LOCKED && !isAccountLimit(roh)) {
            // The body is read; sicherAufrufen gets it anew, otherwise it would lack the sentence.
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
     * Create from the PDF — with values contributed by hand. Empty fields
     * are not sent (`asPart` returns null): on the server „what comes along
     * wins“ applies, an empty part would overwrite what was read with nothing. The
     * media type comes from the file picker, not guessed; the server accepts only
     * `application/pdf`.
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
            // With 422 the server has read the PDF but found too little; what it
            // could read the UI needs for prefilling. sicherAufrufen would keep only
            // sentence and code, hence the response becomes success=false here.
            if (antwort.code() == 422) {
                val roh = antwort.errorBody()?.string()
                // Too many pages: nothing was read, the form has nothing to prefill.
                // An error with sentence and code, otherwise it would say „read incompletely“.
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

    // No own PDF download: the PDF viewer gets an address and loads it with
    // the signed-in client (AnleitungsLader — token, cleartext ban and
    // 401 message hang on it). An own path would be a second version and would put
    // number and PIN into the device's cache.

    companion object {
        /** What stays of a voucher offline: no PIN, of the number the last four digits. */
        fun withoutSecret(g: VoucherView): VoucherView =
            g.copy(number = if (g.number.length > 4) "…" + g.number.takeLast(4) else g.number, pin = null)

        /** The codes under which the server defers a balance query. */
        private val BALANCE_LOCKED = setOf(Fehlercode.GUTHABEN_ABSTAND, Fehlercode.GUTHABEN_BOTSCHUTZ)

        /** The limit per account shares the code with the general throttle; only `grund` distinguishes. */
        private fun isAccountLimit(roh: String?): Boolean = runCatching {
            val o = org.json.JSONObject(roh ?: return false)
            Fehlercode.aus(o.optString("code")) == Fehlercode.ZU_VIELE_ANFRAGEN && o.optString("grund") == "konto"
        }.getOrDefault(false)
    }

    /** Empty means „do not send" — see the reasoning at fromPdf(). */
    private fun asPart(wert: String?): okhttp3.RequestBody? =
        wert?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}

/** A refusal when creating or changing is an error with the server's sentence. */
private fun Ergebnis<GutscheinAntwort>.gespeichert(): Ergebnis<Gutscheinspeicherung> =
    promised({ it.success }, { it.error }) { Gutscheinspeicherung.Gespeichert(it.mehrere?.added, it.mehrere?.updated) }

private fun Gutscheinangabe.asRequest() = GutscheinRequest(number = nummer, pin = pin, amount = betrag.asDouble(), currency = waehrung)

private fun Confirmation.asRequest() = ZweiterFaktorAnfrage(password = passwort, code = code)
