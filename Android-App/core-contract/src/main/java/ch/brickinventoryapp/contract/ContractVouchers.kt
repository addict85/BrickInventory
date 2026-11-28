// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class BalanceReply(
    @SerialName("success") val success: Boolean,
    @SerialName("voucher") val voucher: Voucher?,
    @SerialName("displayed") val displayed: String?,
    @SerialName("currency_changed") val currencyChanged: Boolean,
    @SerialName("removed") val removed: Boolean,
    @SerialName("reason") val reason: String? = null,
    @SerialName("waitSeconds") val waitSeconds: Int? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class ParsedVoucher(
    @SerialName("number") val number: String?,
    @SerialName("pin") val pin: String?,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("currency") val currency: CurrencyCode?,
)

@Serializable
data class Voucher(
    @SerialName("id") val id: Int,
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String?,
    @SerialName("amount") val amount: Double,
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("has_pdf") val hasPdf: Boolean,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("balance_checked_at") val balanceCheckedAt: String?,
)

@Serializable
data class VoucherBatch(
    @SerialName("results") val results: List<JsonElement?>,
    @SerialName("added") val added: Int,
    @SerialName("updated") val updated: Int,
    @SerialName("errors") val errors: Int,
    @SerialName("total") val total: Int,
)

@Serializable
data class VoucherList(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("vouchers") val vouchers: List<Voucher>,
)

@Serializable
data class VoucherPdfGrant(
    @SerialName("success") val success: Boolean,
    @SerialName("ticket") val ticket: String,
    @SerialName("valid_seconds") val validSeconds: Int,
)

@Serializable
data class VoucherPlaintext(
    @SerialName("success") val success: Boolean,
    @SerialName("id") val id: Int,
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String?,
)

@Serializable
data class VoucherReply(
    @SerialName("success") val success: Boolean,
    @SerialName("voucher") val voucher: Voucher? = null,
    @SerialName("multiple") val multiple: VoucherBatch? = null,
    @SerialName("parsed") val parsed: ParsedVoucher? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class VoucherRequest(
    @SerialName("number") val number: String,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.CHF,
)
