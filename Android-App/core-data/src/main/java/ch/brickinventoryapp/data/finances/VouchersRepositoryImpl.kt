package ch.brickinventoryapp.data.finances

import ch.brickinventoryapp.contract.BalanceReply
import ch.brickinventoryapp.contract.SecondFactorRequest
import ch.brickinventoryapp.contract.VoucherReply
import ch.brickinventoryapp.contract.VoucherRequest
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.collection.asRequest
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.reconciled
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.model.domain.BalanceInfo
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.VoucherInfo
import ch.brickinventoryapp.model.domain.VoucherStorage
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.data.api.ErrorBody
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Slots
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody.Companion.toResponseBody
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Vouchers — LEGO gift cards in the own profile. Stored locally is the
 * list without PIN and only with the last four digits of the number: offline
 * „which voucher, how much“ suffices; number plus PIN would be money on disk.
 */
@Singleton
internal class VouchersRepositoryImpl @Inject constructor(
    private val api: VouchersApi,
    private val store: OfflineStore,
    private val json: Json = BrickJson,
) : VouchersRepository {

    override suspend fun list(): Outcome<List<VoucherView>> =
        store.reconciled(Slots.VOUCHERS, { l -> l.map { withoutSecret(it) } }, { it }) {
            safeCall { api.getVouchers() }.mapData { l -> l.vouchers.map { it.asView() } }
        }

    override suspend fun create(info: VoucherInfo): Outcome<VoucherStorage> =
        safeCall { api.createVoucher(info.asRequest()) }.saved()

    override suspend fun edit(id: Int, info: VoucherInfo): Outcome<VoucherStorage> =
        safeCall { api.changeVoucher(id, info.asRequest()) }.saved()

    /**
     * Without outbox: the dialog asked „are you sure“ for a card that is still there; a
     * buffered delete would run later against whatever the list holds then.
     */
    override suspend fun deleteVoucher(id: Int): Outcome<Unit> =
        safeCall { api.deleteVoucher(id, SecondFactorRequest()) }.done()

    override suspend fun restore(id: Int): Outcome<VoucherStorage> = safeCall { api.restoreVoucher(id) }.saved()

    /** Number and PIN in plaintext; never in cache or store. */
    override suspend fun plaintext(id: Int): Outcome<PlaintextView> =
        safeCall { api.voucherPlaintext(id, SecondFactorRequest()) }.mapData { it.asView() }

    /**
     * A one-time ticket for the PDF of a voucher, without [id] for the PDF
     * of all. The one place for the release contract; the address for it is built by
     * voucherPdfAddress() in VoucherAddresses.kt.
     */
    override suspend fun pdfRelease(id: Int?): Outcome<String> {
        val request = SecondFactorRequest()
        return safeCall { if (id == null) api.voucherExportRelease(request) else api.voucherPdfRelease(id, request) }
            .mapData { it.ticket }
    }

    /**
     * Query the balance at LEGO. A blocked query becomes success=false
     * because the pass over all cards needs `reason` and `waitSec` from the body;
     * other errors stay errors.
     */
    override suspend fun balance(id: Int): Outcome<BalanceInfo> = safeCall {
        val response = api.queryBalance(id)
        if (response.isSuccessful) return@safeCall response
        val raw = response.errorBody()?.string()
        if (ErrorBody.read(raw).errorCode !in BALANCE_LOCKED && !isAccountLimit(raw)) {
            // The body is read; safeCall gets it anew, otherwise it would lack the sentence.
            return@safeCall retrofit2.Response.error(response.code(),
                (raw ?: "").toResponseBody("application/json".toMediaType()))
        }
        val parsed = raw?.let {
            runCatching { json.decodeFromString<BalanceReply>(it) }.getOrNull()
        }
        if (parsed != null) retrofit2.Response.success(parsed)
        else retrofit2.Response.error(response.code(), (raw ?: "").toResponseBody("application/json".toMediaType()))
    }.mapData {
        BalanceInfo(success = it.success && it.voucher != null, voucher = it.voucher?.asView(), displayed = it.displayed,
            currencyChanged = it.currencyChanged, reason = it.reason, waitSec = it.waitSeconds, error = it.error)
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
        type: String,
        content: ByteArray,
        number: String?,
        pin: String?,
        amount: String?,
        currency: String?,
    ): Outcome<VoucherStorage> {
        val bodyBytes = content.toRequestBody(type.toMediaType())
        val part = okhttp3.MultipartBody.Part.createFormData("file", fileName, bodyBytes)
        return safeCall {
            val response = api.loadVoucherPdfHigh(
                part,
                asPart(number), asPart(pin), asPart(amount), asPart(currency),
            )
            // With 422 the server has read the PDF but found too little; what it
            // could read the UI needs for prefilling. safeCall would keep only
            // sentence and code, hence the response becomes success=false here.
            if (response.code() == 422) {
                val raw = response.errorBody()?.string()
                // Too many pages: nothing was read, the form has nothing to prefill.
                // An error with sentence and code, otherwise it would say „read incompletely“.
                val toLang = ErrorBody.read(raw).errorCode == ErrorCode.PDF_TOO_MANY_PAGES
                val parsed = raw?.takeIf { !toLang }?.let {
                    runCatching { json.decodeFromString<VoucherReply>(it) }.getOrNull()
                }
                when {
                    parsed != null -> retrofit2.Response.success(parsed)
                    toLang -> retrofit2.Response.error<VoucherReply>(response.code(), (raw ?: "").toResponseBody("application/json".toMediaType()))
                    else -> response
                }
            } else response
        }.mapData { a ->
            if (a.success) VoucherStorage.Saved(a.multiple?.added, a.multiple?.updated)
            else a.parsed.let { g -> VoucherStorage.Incomplete(g?.number, g?.pin, g?.amount.asMoney(), g?.currency) }
        }
    }

    // No own PDF download: the PDF viewer gets an address and loads it with
    // the signed-in client (InstructionLoader — token, cleartext ban and
    // 401 message hang on it). An own path would be a second version and would put
    // number and PIN into the device's cache.

    companion object {
        /** What stays of a voucher offline: no PIN, of the number the last four digits. */
        fun withoutSecret(g: VoucherView): VoucherView =
            g.copy(number = if (g.number.length > 4) "…" + g.number.takeLast(4) else g.number, pin = null)

        /** The codes under which the server defers a balance query. */
        private val BALANCE_LOCKED = setOf(ErrorCode.BALANCE_SPACING, ErrorCode.BALANCE_BOT_GUARD)

        /** The limit per account shares the code with the general throttle; only `reason` distinguishes. */
        private fun isAccountLimit(raw: String?): Boolean = runCatching {
            val o = org.json.JSONObject(raw ?: return false)
            ErrorCode.from(o.optString("code")) == ErrorCode.TOO_MANY_REQUESTS && o.optString("reason") == "konto"
        }.getOrDefault(false)
    }

    /** Empty means „do not send" — see the reasoning at fromPdf(). */
    private fun asPart(value: String?): okhttp3.RequestBody? =
        value?.trim()?.takeIf { it.isNotEmpty() }?.toRequestBody("text/plain".toMediaType())
}

/** A refusal when creating or changing is an error with the server's sentence. */
private fun Outcome<VoucherReply>.saved(): Outcome<VoucherStorage> =
    promised({ it.success }, { it.error }) { VoucherStorage.Saved(it.multiple?.added, it.multiple?.updated) }

private fun VoucherInfo.asRequest() = VoucherRequest(number = number, pin = pin, amount = amount.asDouble(), currency = currency)

