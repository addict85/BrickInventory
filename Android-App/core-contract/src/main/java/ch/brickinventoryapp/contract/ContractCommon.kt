// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

@Serializable
data class AccountName(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
)

@Serializable
data class BrickLinkRef(
    @SerialName("type") val type: String,
    @SerialName("number") val number: String,
    @SerialName("url") val url: String? = null,
    @SerialName("exact") val exact: Boolean,
    @SerialName("resolved") val resolved: Boolean,
)

@Serializable
data class ComponentHeader(
    @SerialName("number") val number: String,
    @SerialName("name") val name: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("is_spare") val isSpare: Boolean,
    @SerialName("storage") val storage: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int>,
    @SerialName("total_quantity") val totalQuantity: Int,
)

@Serializable
data class ConfigExport(
    @SerialName("version") val version: String = "",
    @SerialName("exported_at") val exportedAt: String = "",
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: JsonObject = JsonObject(emptyMap()),
    @SerialName("user_settings") val userSettings: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class CsvImportResult(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("added") val added: Int = 0,
    @SerialName("updated") val updated: Int = 0,
    @SerialName("errors") val errors: Int = 0,
    @SerialName("results") val results: List<CsvImportRow> = emptyList(),
    @SerialName("skipped") val skipped: Int = 0,
    @SerialName("skipped_hint") val skippedHint: String = "",
    @SerialName("currency_note") val currencyNote: String? = null,
    @SerialName("started") val started: Boolean = false,
    @SerialName("existing") val existing: Int = 0,
    @SerialName("existing_numbers") val existingNumbers: List<String> = emptyList(),
)

@Serializable
data class CsvImportRow(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("row") val row: Int = 0,
    @SerialName("success") val success: Boolean = false,
    @SerialName("action") val action: String = "",
    @SerialName("isWarning") val isWarning: Boolean = false,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String = "",
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("catalog_pending") val catalogPending: Boolean = false,
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("condition") val condition: String = "",
    @SerialName("vars") val vars: JsonObject = JsonObject(emptyMap()),
    @SerialName("currency_adjusted") val currencyAdjusted: Boolean = false,
    @SerialName("file_currency") val fileCurrency: String = "",
    @SerialName("account_currency") val accountCurrency: String = "",
)

@Serializable
data class Done(
    @SerialName("success") val success: Boolean,
)

@Serializable
data class ErrorResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("error") val error: String,
    @SerialName("code") val code: String,
)

@Serializable
data class FigValuationItem(
    @SerialName("id") val id: Int?,
    @SerialName("quantity") val quantity: Int,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("condition") val condition: Condition?,
    @SerialName("conditions") val conditions: List<Condition>,
    @SerialName("user_id") val userId: Int?,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("fig_number") val figNumber: String,
    @SerialName("bl_fig_number") val blFigNumber: String?,
    @SerialName("fig_name") val figName: String?,
    @SerialName("set_number") val setNumber: String?,
    @SerialName("source") val source: String?,
    @SerialName("storage_id") val storageId: Int?,
    @SerialName("pending") val pending: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
)

@Serializable
data class GenericAdminResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("condition") val condition: String? = null,
    @SerialName("message") val message: String = "",
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("started") val started: Boolean = false,
    @SerialName("theme") val theme: String = "",
    @SerialName("ttl") val ttl: JsonElement = JsonNull,
    @SerialName("queued") val queued: Int = 0,
    @SerialName("pending") val pending: Int = 0,
    @SerialName("skipped") val skipped: Int = 0,
    @SerialName("discarded") val discarded: Int = 0,
    @SerialName("duration_minutes") val durationMinutes: Int = 0,
    @SerialName("enqueued") val enqueued: Int = 0,
)

@Serializable
data class GenericResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0,
    @SerialName("from_user_id") val fromUserId: Int = 0,
    @SerialName("to_user_id") val toUserId: Int = 0,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("unchanged") val unchanged: Boolean = false,
    @SerialName("acquisitions") val acquisitions: Int = 0,
    @SerialName("instructions") val instructions: Int = 0,
    @SerialName("set") val set: SetAggregate? = null,
    @SerialName("parts") val parts: Int = 0,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("trash") val trash: List<Int> = emptyList(),
    @SerialName("linked_to") val linkedTo: AccountName? = null,
    @SerialName("removed") val removed: Int = 0,
    @SerialName("instruction") val instruction: InstructionUploadedInstruction? = null,
    @SerialName("updated") val updated: Int = 0,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class Minifig(
    @SerialName("id") val id: Int? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_number") val figNumber: String,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("conditions") val conditions: List<Condition>,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("fig_name") val figName: String?,
    @SerialName("quantity") val quantity: Int,
    @SerialName("total_quantity") val totalQuantity: Int?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String,
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

@Serializable
data class MinifigsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("figs") val figs: List<Minifig>,
    @SerialName("source") val source: String = "",
    @SerialName("error") val error: String = "",
)

@Serializable
data class Part(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String?,
    @SerialName("part_name") val partName: String?,
    @SerialName("color_id") val colorId: Int,
    @SerialName("color_name") val colorName: String?,
    @SerialName("color_hex") val colorHex: String?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("total_quantity") val totalQuantity: Int,
    @SerialName("is_spare") val isSpare: Boolean,
    @SerialName("condition") val condition: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("bl_color_id") val blColorId: Int? = null,
)

@Serializable
data class PartValuationItem(
    @SerialName("id") val id: Int?,
    @SerialName("quantity") val quantity: Int,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("avg_price") val avgPrice: Double?,
    @SerialName("condition") val condition: Condition?,
    @SerialName("conditions") val conditions: List<Condition>,
    @SerialName("user_id") val userId: Int?,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String?,
    @SerialName("part_name") val partName: String?,
    @SerialName("color_id") val colorId: Int,
    @SerialName("color_name") val colorName: String?,
    @SerialName("color_hex") val colorHex: String?,
    @SerialName("unit_price") val unitPrice: Double?,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("pending") val pending: Boolean = false,
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("display_value") val displayValue: String? = null,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
)

@Serializable
data class PartsResponse(
    @SerialName("source") val source: String?,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("parts") val parts: List<Part>,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("error") val error: String = "",
)

@Serializable
data class PdfInput(
    @SerialName("sets") val sets: List<PdfInputSetsEntry> = emptyList(),
    @SerialName("parts") val parts: List<PdfInputPartsEntry> = emptyList(),
)

@Serializable
data class PdfInputPartsEntry(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: JsonElement,
    @SerialName("is_fig") val isFig: JsonElement? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfInputSetsEntry(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
)

@Serializable
data class SecondFactorRequest(
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class UpdateManualItemRequest(
    @SerialName("quantity") val quantity: Int,
    @SerialName("quantity_delta") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantityDelta: Int? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
)

@Serializable
data class UsingSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("set_name") val setName: String? = null,
    @SerialName("quantity") val quantity: Int,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int,
)

@Serializable
data class UsingSetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("item") val item: ComponentHeader? = null,
    @SerialName("sets") val sets: List<UsingSet>,
)
