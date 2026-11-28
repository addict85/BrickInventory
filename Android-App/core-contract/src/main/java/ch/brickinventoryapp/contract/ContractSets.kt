// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.RunStatus
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class AddSetRequest(
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("currency") @EncodeDefault(EncodeDefault.Mode.NEVER) val currency: String? = null,
    @SerialName("date") @EncodeDefault(EncodeDefault.Mode.NEVER) val date: String? = null,
)

@Serializable
data class AddSetResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("catalog_pending") val catalogPending: Boolean = false,
    @SerialName("supplement") val supplement: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class BarcodeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("pieces") val pieces: Int?,
    @SerialName("theme") val theme: String?,
    @SerialName("minifigs") val minifigs: Int?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("source") val source: String?,
    @SerialName("uncertain") val uncertain: Boolean,
)

@Serializable
data class Instruction(
    @SerialName("downloaded_at") val downloadedAt: String? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("id") val id: Int,
    @SerialName("url") val url: String,
    @SerialName("description") val description: String?,
    @SerialName("local_path") val localPath: String?,
    @SerialName("is_manual") val isManual: Boolean,
)

@Serializable
data class InstructionUploadedInstruction(
    @SerialName("url") val url: String,
    @SerialName("description") val description: String?,
    @SerialName("local_path") val localPath: String,
)

@Serializable
data class InstructionsLoaded(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Int,
    @SerialName("instructions") val instructions: List<Instruction>,
    @SerialName("job_id") val jobId: String?,
)

@Serializable
data class MoveSetRequest(
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id") val toUserId: Int,
    @SerialName("acquisition_ids") val acquisitionIds: List<Int>? = null,
)

@Serializable
data class MoveSetResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int,
    @SerialName("acquisitions") val acquisitions: Int,
    @SerialName("merged") val merged: Boolean,
    @SerialName("parts") val parts: Int,
    @SerialName("minifigs") val minifigs: Int,
    @SerialName("instructions") val instructions: Int,
    @SerialName("source_emptied") val sourceEmptied: Boolean,
    @SerialName("from_user_id") val fromUserId: Int,
    @SerialName("to_user_id") val toUserId: Int,
)

@Serializable
data class PartsLoaded(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Int,
)

@Serializable
data class PdfJobPart(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: Int,
    @SerialName("is_fig") val isFig: Boolean = false,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfJobRequest(
    @SerialName("sets") val sets: List<PdfJobSet> = emptyList(),
    @SerialName("parts") val parts: List<PdfJobPart> = emptyList(),
)

@Serializable
data class PdfJobResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("jobId") val jobId: String,
)

@Serializable
data class PdfJobSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
)

@Serializable
data class PdfJobState(
    @SerialName("success") val success: Boolean,
    @SerialName("status") val status: RunStatus,
    @SerialName("error") val error: String?,
    @SerialName("etaSeconds") val etaSeconds: Double?,
    @SerialName("missingImages") val missingImages: JsonElement?,
)

@Serializable
data class PendingAlertsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("alerts") val alerts: List<PriceAlert>,
    @SerialName("now") val now: String?,
)

@Serializable
data class PriceAlert(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Condition,
    @SerialName("direction") val direction: AlarmDirection,
    @SerialName("threshold") val threshold: Double,
    @SerialName("currency_code") val currencyCode: CurrencyCode,
    @SerialName("triggered") val triggered: Boolean,
    @SerialName("last_triggered_at") val lastTriggeredAt: String?,
    @SerialName("last_price") val lastPrice: Double?,
    @SerialName("name") val name: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    @SerialName("owns") val owns: Boolean,
)

@Serializable
data class PriceAlertRequest(
    @SerialName("direction") val direction: AlarmDirection,
    @SerialName("threshold") val threshold: Double,
    @SerialName("condition") val condition: Condition = Condition.NEW,
)

@Serializable
data class PriceAlertResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("alert") val alert: PriceAlert? = null,
    @SerialName("removed") val removed: Int = 0,
)

@Serializable
data class PriceAlertsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("alerts") val alerts: List<PriceAlert>,
)

@Serializable
data class QuantityChanged(
    @SerialName("success") val success: Boolean,
    @SerialName("quantity") val quantity: Int?,
    @SerialName("trash") val trash: Int = 0,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("dropped") val dropped: List<QuantityChangedDroppedEntry> = emptyList(),
)

@Serializable
data class QuantityChangedDroppedEntry(
    @SerialName("id") val id: Int,
    @SerialName("quantity") val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double?,
    @SerialName("currency") val currency: String?,
    @SerialName("price_estimated") val priceEstimated: Boolean,
    @SerialName("condition") val condition: String,
    @SerialName("date") val date: String?,
)

@Serializable
data class SetExistsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("exists") val exists: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class SetInfoResponse(
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("in_catalog") val inCatalog: Boolean,
)

@Serializable
data class SetItem(
    @SerialName("acq_count") val acqCount: Int,
    @SerialName("last_purchase") val lastPurchase: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("id") val id: Int = 0,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("year") val year: Int?,
    @SerialName("theme") val theme: String?,
    @SerialName("pieces") val pieces: Int?,
    @SerialName("minifigs") val minifigs: Int?,
    @SerialName("quantity") val quantity: Int,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("added_at") val addedAt: String?,
    @SerialName("condition") val condition: Condition?,
    @SerialName("storage") val storage: String?,
    @SerialName("conditions") val conditions: List<Condition>,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double?,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double?,
    @SerialName("purchase_price_estimated") val purchasePriceEstimated: Boolean? = null,
    @SerialName("used_count") val usedCount: Int,
    @SerialName("instructions") val instructions: List<Instruction>,
    @SerialName("bricklink") val bricklink: BrickLinkRef? = null,
    @SerialName("price_comparison_url") val priceComparisonUrl: String? = null,
)

@Serializable
data class SetResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: SetItem?,
)

@Serializable
data class SetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Int,
    @SerialName("sets") val sets: List<SetItem>,
    @SerialName("total") val total: Int,
    @SerialName("themes") val themes: List<String> = emptyList(),
)

@Serializable
data class UpdateQuantityRequest(
    @SerialName("quantity") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantity: Int? = null,
    @SerialName("quantity_delta") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantityDelta: Int? = null,
    @SerialName("purchase_price") @EncodeDefault(EncodeDefault.Mode.NEVER) val purchasePrice: Double? = null,
    @SerialName("condition") @EncodeDefault(EncodeDefault.Mode.NEVER) val condition: Condition? = null,
    @SerialName("owner_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val ownerUserId: JsonElement? = null,
)
