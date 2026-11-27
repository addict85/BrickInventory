// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.NO_COLOR
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.ui.theme.DesignOrNothing
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

@Serializable
data class AccountActive(
    @SerialName("success") val success: Boolean = false,
    @SerialName("is_active") val isActive: Boolean = false,
    @SerialName("effective_at") val effectiveAt: String = "",
)

@Serializable
data class AccountInList(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
    @SerialName("is_admin") val isAdmin: Boolean = false,
    @SerialName("is_active") val isActive: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("second_factor") val secondFactor: Boolean = false,
    @SerialName("awaiting_confirmation") val awaitingConfirmation: Boolean = false,
    @SerialName("announced") val announced: List<AccountInListAnnouncedEntry> = emptyList(),
)

@Serializable
data class AccountInListAnnouncedEntry(
    @SerialName("type") val type: String = "",
    @SerialName("effective_at") val effectiveAt: String = "",
)

@Serializable
data class AccountList(
    @SerialName("success") val success: Boolean = false,
    @SerialName("users") val users: List<AccountInList> = emptyList(),
)

@Serializable
data class AccountName(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
)

@Serializable
data class Acquisition(
    @SerialName("id") val id: Int,
    @SerialName("quantity") val quantity: Int,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
    @SerialName("currency") val currency: CurrencyCode? = null,
    @SerialName("account_price") val accountPrice: Double? = null,
)

@Serializable
data class AcquisitionTotals(
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("priced_rows") val pricedRows: Int = 0,
    @SerialName("currency") val currency: String = "",
    @SerialName("without_rate") val withoutRate: Int = 0,
)

@Serializable
data class AcquisitionsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("acquisitions") val acquisitions: List<Acquisition> = emptyList(),
    @SerialName("totals") val totals: AcquisitionTotals = AcquisitionTotals(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class AddMinifigRequest(
    @SerialName("fig_number") val figNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("fig_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val figName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddMinifigResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String = "",
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Condition? = null,
)

@Serializable
data class AddPartRequest(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("part_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val partName: String? = null,
    @SerialName("image_url") @EncodeDefault(EncodeDefault.Mode.NEVER) val imageUrl: String? = null,
    @SerialName("category_name") @EncodeDefault(EncodeDefault.Mode.NEVER) val categoryName: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("acquired_at") @EncodeDefault(EncodeDefault.Mode.NEVER) val acquiredAt: String? = null,
)

@Serializable
data class AddPartResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String = "",
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("part_name") val partName: String? = null,
    @SerialName("price_from_condition") val priceFromCondition: Condition? = null,
)

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
    @SerialName("success") val success: Boolean = true,
    @SerialName("action") val action: String = "",
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("catalog_pending") val catalogPending: Boolean = false,
    @SerialName("supplement") val supplement: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class ApiLimits(
    @SerialName("rebrickable") val rebrickable: Int = 0,
    @SerialName("bricklink") val bricklink: Int = 0,
    @SerialName("brickset") val brickset: Int = 0,
)

@Serializable
data class ApiLimitsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("limits") val limits: ApiLimits = ApiLimits(),
)

@Serializable
data class AppThemeResponse(
    @SerialName("success") val success: Boolean = false,
    @Serializable(with = DesignOrNothing::class) @SerialName("theme") val theme: Design? = null,
    @Serializable(with = DesignOrNothing::class) @SerialName("preset") val preset: Design? = null,
    @Serializable(with = DesignOrNothing::class) @SerialName("own") val own: Design? = null,
)

@Serializable
data class AppToken(
    @SerialName("token_id") val tokenId: String,
    @SerialName("label") val label: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("current") val current: Boolean = false,
    @SerialName("token_prefix") val tokenPrefix: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("scope") val scope: String = "",
    @SerialName("ip_range") val ipRange: String? = null,
    @SerialName("rotated_at") val rotatedAt: String = "",
)

@Serializable
data class Backup(
    @SerialName("version") val version: String = "",
    @SerialName("exported_at") val exportedAt: String = "",
    @SerialName("exported_by") val exportedBy: String? = null,
    @SerialName("global") val global: Map<String, String> = emptyMap(),
    @SerialName("user_settings") val userSettings: Map<String, String> = emptyMap(),
)

@Serializable
data class BackupRestored(
    @SerialName("success") val success: Boolean = false,
    @SerialName("imported") val imported: Int = 0,
    @SerialName("note") val note: String = "",
    @SerialName("smtp_skipped") val smtpSkipped: List<String> = emptyList(),
)

@Serializable
data class BalanceReply(
    @SerialName("success") val success: Boolean = false,
    @SerialName("voucher") val voucher: Voucher? = null,
    @SerialName("displayed") val displayed: String? = null,
    @SerialName("currency_changed") val currencyChanged: Boolean = false,
    @SerialName("removed") val removed: Boolean = false,
    @SerialName("reason") val reason: String? = null,
    @SerialName("waitSeconds") val waitSeconds: Int? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("code") val code: String? = null,
)

@Serializable
data class BarcodeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("uncertain") val uncertain: Boolean = false,
)

@Serializable
data class BlColorTable(
    @SerialName("success") val success: Boolean = false,
    @SerialName("source") val source: String = "",
    @SerialName("map") val map: JsonObject = JsonObject(emptyMap()),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class BrickColor(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
    @SerialName("hex") val hex: String? = null,
)

@Serializable
data class BrickColorsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("colors") val colors: List<BrickColor> = emptyList(),
)

@Serializable
data class BrickLinkRef(
    @SerialName("type") val type: String = "SET",
    @SerialName("number") val number: String = "",
    @SerialName("url") val url: String? = null,
    @SerialName("exact") val exact: Boolean = true,
    @SerialName("resolved") val resolved: Boolean = false,
)

@Serializable
data class BricklinkLinks(
    @SerialName("success") val success: Boolean = false,
    @SerialName("links") val links: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class BricksetQueueEntry(
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("attempts") val attempts: Int = 0,
    @SerialName("retry_after") val retryAfter: String? = null,
    @SerialName("last_error") val lastError: String? = null,
)

@Serializable
data class BricksetQueueResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("count") val count: Int = 0,
    @SerialName("entries") val entries: List<BricksetQueueEntry> = emptyList(),
)

@Serializable
data class CacheStatsResponse(
    @SerialName("db_pool") val dbPool: JsonObject = JsonObject(emptyMap()),
    @SerialName("success") val success: Boolean,
    @SerialName("prices") val prices: Int = 0,
    @SerialName("subsets") val subsets: Int = 0,
    @SerialName("catalog") val catalog: Int = 0,
    @SerialName("price_stale") val priceStale: Int = 0,
    @SerialName("rate_limits") val rateLimits: RateLimits? = null,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class CacheTtlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("ttl") val ttl: String = "24",
)

@Serializable
data class CatalogMetaResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("themes") val themes: List<CatalogTheme> = emptyList(),
    @SerialName("year_min") val yearMin: Int? = null,
    @SerialName("year_max") val yearMax: Int? = null,
    @SerialName("year_counts") val yearCounts: List<CatalogYearCount> = emptyList(),
)

@Serializable
data class CatalogSetDetail(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
    @SerialName("bricklink") val bricklink: BrickLinkRef? = null,
    @SerialName("price_comparison_url") val priceComparisonUrl: String? = null,
)

@Serializable
data class CatalogSetDetailResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: CatalogSetDetail? = null,
)

@Serializable
data class CatalogSetItem(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("theme_name") val themeName: String? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("owned_quantity") val ownedQuantity: Int = 0,
)

@Serializable
data class CatalogSetsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("pages") val pages: Int = 0,
    @SerialName("sets") val sets: List<CatalogSetItem> = emptyList(),
)

@Serializable
data class CatalogTheme(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String = "",
    @SerialName("set_count") val setCount: Int = 0,
)

@Serializable
data class CatalogYearCount(
    @SerialName("year") val year: Int = 0,
    @SerialName("n") val n: Int = 0,
)

@Serializable
data class CatalogYearDistributionResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("years") val years: List<YearCount> = emptyList(),
)

@Serializable
data class ChartPoint(
    @SerialName("x_label") val xLabel: String = "",
    @SerialName("value") val value: Double = 0.0,
    @SerialName("y_frac") val yFrac: Double = 0.0,
)

@Serializable
data class ChartYAxis(
    @SerialName("label") val label: String = "",
    @SerialName("value") val value: Double = 0.0,
    @SerialName("frac") val frac: Double = 0.0,
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
    @SerialName("is_spare") val isSpare: Boolean = false,
    @SerialName("storage") val storage: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class ConditionValuation(
    @SerialName("market_price") val marketPrice: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPctText: String? = null,
    @SerialName("pnl_percent") val pnlPct: Double? = null,
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
    @SerialName("total") val total: Int = 0,
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
data class CsvImportStatus(
    @SerialName("code") val code: String? = null,
    @SerialName("results") val results: List<CsvImportRow> = emptyList(),
    @SerialName("success") val success: Boolean = false,
    @SerialName("status") val status: RunStatus = RunStatus.UNKNOWN,
    @SerialName("total") val total: Int = 0,
    @SerialName("done") val done: Int = 0,
    @SerialName("current") val current: String? = null,
    @SerialName("ok") val ok: Int = 0,
    @SerialName("warn") val warn: Int = 0,
    @SerialName("err") val err: Int = 0,
    @SerialName("error") val error: String? = null,
    @SerialName("finished_at") val finishedAt: String = "",
)

@Serializable
data class CurrentByCondition(
    @SerialName("N") val new: CurrentPrice? = null,
    @SerialName("U") val used: CurrentPrice? = null,
)

@Serializable
data class CurrentPrice(
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

@Serializable
data class DashboardStats(
    @SerialName("currency") val currency: String = "",
    @SerialName("default_condition") val defaultCondition: String = "",
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("total_sets") val totalSets: Int,
    @SerialName("total_quantity") val totalQuantity: Int,
    @SerialName("total_pieces") val totalPieces: Int,
    @SerialName("total_instructions") val totalInstructions: Int,
    @SerialName("total_parts") val totalParts: Int,
    @SerialName("set_parts") val setParts: Int? = null,
    @SerialName("manual_parts") val manualParts: Int? = null,
    @SerialName("total_minifigs") val totalMinifigs: Int,
)

@Serializable
data class DefaultConditionResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("condition") val condition: Condition = Condition.NEW,
)

@Serializable
data class DeleteWithQuantityResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0,
)

@Serializable
data class Deleted(
    @SerialName("success") val success: Boolean = false,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class DeviceKeyRequest(
    @SerialName("public_key") @EncodeDefault(EncodeDefault.Mode.NEVER) val publicKey: String? = null,
    @SerialName("chain") val chain: List<String>,
)

@Serializable
class Diagnosis

@Serializable
data class Done(
    @SerialName("success") val success: Boolean = false,
)

@Serializable
data class EmailPreview(
    @SerialName("success") val success: Boolean = false,
    @SerialName("username") val username: String = "",
)

@Serializable
data class EndOthersRequest(
    @SerialName("accesses") val accesses: Boolean = true,
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class Endpoints(
    @SerialName("auth") val auth: JsonObject = JsonObject(emptyMap()),
    @SerialName("api") val api: String = "",
    @SerialName("version") val version: String = "",
    @SerialName("endpoints") val endpoints: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class ErrorResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("error") val error: String = "",
    @SerialName("code") val code: String = "",
)

@Serializable
data class FigValuationItem(
    @SerialName("id") val id: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("conditions") val conditions: List<Condition> = emptyList(),
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("fig_number") val figNumber: String = "",
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    @SerialName("source") val source: String? = null,
    @SerialName("storage_id") val storageId: Int? = null,
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
data class FigsValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int = 0,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("figs") val figs: List<FigValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String,
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("prices_pending") val pricesPending: Int = 0,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int = 0,
)

@Serializable
data class ForgotPasswordRequest(
    @SerialName("email") val email: String,
)

@Serializable
data class ForgotPasswordResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String? = null,
    @SerialName("error") val error: String? = null,
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
    @SerialName("linked_to") val linkedTo: AccountName = AccountName(),
    @SerialName("removed") val removed: Int = 0,
    @SerialName("instruction") val instruction: InstructionUploadedInstruction = InstructionUploadedInstruction(),
    @SerialName("updated") val updated: Int = 0,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class Health(
    @SerialName("status") val status: String = "",
    @SerialName("startup") val startup: StartupStatus = StartupStatus(),
    @SerialName("db_pool") val dbPool: JsonObject = JsonObject(emptyMap()),
    @SerialName("uptime_seconds") val uptimeSeconds: Int = 0,
)

@Serializable
data class Heartbeat(
    @SerialName("status") val status: String = "",
)

@Serializable
data class HoldingCleared(
    @SerialName("success") val success: Boolean = false,
    @SerialName("sets") val sets: Int = 0,
    @SerialName("parts") val parts: Int = 0,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("trash") val trash: List<Int> = emptyList(),
)

@Serializable
data class HoldingEntry(
    @SerialName("total") val total: Int = 0,
    @SerialName("loose") val loose: Int = 0,
)

@Serializable
data class HoldingPart(
    @SerialName("part_number") val partNumber: String,
    @SerialName("color_id") val colorId: Int,
)

@Serializable
data class HoldingRequest(
    @SerialName("parts") val parts: List<HoldingPart>,
)

@Serializable
data class HoldingResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("holding") val holding: Map<String, HoldingEntry> = emptyMap(),
)

@Serializable
data class HouseholdInviteCheckResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("inviter") val inviter: HouseholdInviteCheckResponseInviter = HouseholdInviteCheckResponseInviter(),
)

@Serializable
data class HouseholdInviteCheckResponseInviter(
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
)

@Serializable
data class HouseholdInviteResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("code") val code: String? = null,
    @SerialName("expires_in") val expiresIn: Int? = null,
)

@Serializable
data class HouseholdMember(
    @SerialName("depth") val depth: Int = 0,
    @SerialName("id") val id: Int = 0,
    @SerialName("username") val username: String = "",
    @SerialName("is_self") val isSelf: Boolean = false,
)

@Serializable
data class HouseholdMembersResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("members") val members: List<HouseholdMember> = emptyList(),
)

@Serializable
data class HouseholdStatusResponse(
    @SerialName("view") val view: List<HouseholdMember> = emptyList(),
    @SerialName("success") val success: Boolean = false,
    @SerialName("is_main") val isMain: Boolean = false,
    @SerialName("is_sub") val isSub: Boolean = false,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.NONE,
    @SerialName("linked_to") val linkedTo: AccountName? = null,
    @SerialName("parents") val parents: List<AccountName> = emptyList(),
    @SerialName("sub_accounts") val subAccounts: List<HouseholdMember> = emptyList(),
    @SerialName("open_invites") val openInvites: Int = 0,
    @SerialName("former_links") val formerLinks: List<SeparatedAccount> = emptyList(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class ImageDiagnosis(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("hints") val hints: List<String> = emptyList(),
    @SerialName("database") val database: ImageDiagnosisDatabase = ImageDiagnosisDatabase(),
    @SerialName("local") val local: ImageDiagnosisLocal = ImageDiagnosisLocal(),
    @SerialName("proxy") val proxy: ImageDiagnosisProxy = ImageDiagnosisProxy(),
    @SerialName("marker") val marker: ImageDiagnosisMarker? = null,
)

@Serializable
data class ImageDiagnosisDatabase(
    @SerialName("account_count") val accountCount: Int = 0,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("catalog_image") val catalogImage: String? = null,
)

@Serializable
data class ImageDiagnosisLocal(
    @SerialName("original") val original: ImageDiagnosisLocalOriginal = ImageDiagnosisLocalOriginal(),
    @SerialName("preview") val preview: ImageDiagnosisLocalPreview = ImageDiagnosisLocalPreview(),
)

@Serializable
data class ImageDiagnosisLocalOriginal(
    @SerialName("existing") val existing: Boolean = false,
    @SerialName("bytes") val bytes: Int = 0,
    @SerialName("changed") val changed: String? = null,
)

@Serializable
data class ImageDiagnosisLocalPreview(
    @SerialName("existing") val existing: Boolean = false,
    @SerialName("bytes") val bytes: Int = 0,
    @SerialName("changed") val changed: String? = null,
)

@Serializable
data class ImageDiagnosisMarker(
    @SerialName("since") val since: String? = null,
    @SerialName("reason") val reason: String? = null,
)

@Serializable
data class ImageDiagnosisProxy(
    @SerialName("cached") val cached: Boolean = false,
    @SerialName("address") val address: String? = null,
)

@Serializable
data class ImageMarkerForgotten(
    @SerialName("success") val success: Boolean = false,
    @SerialName("removed") val removed: Int = 0,
    @SerialName("hint") val hint: String = "",
)

@Serializable
data class Instruction(
    @SerialName("downloaded_at") val downloadedAt: String? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("id") val id: Int = 0,
    @SerialName("url") val url: String,
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String? = null,
    @SerialName("is_manual") val isManual: Boolean = false,
)

@Serializable
data class InstructionUploadedInstruction(
    @SerialName("url") val url: String = "",
    @SerialName("description") val description: String? = null,
    @SerialName("local_path") val localPath: String = "",
)

@Serializable
data class InstructionsLoaded(
    @SerialName("success") val success: Boolean = false,
    @SerialName("count") val count: Int = 0,
    @SerialName("instructions") val instructions: List<Instruction> = emptyList(),
    @SerialName("job_id") val jobId: String? = null,
)

@Serializable
data class Job(
    @SerialName("id") val id: String,
    @SerialName("type") val type: String,
    @SerialName("status") val status: String,
    @SerialName("attempts") val attempts: Int,
    @SerialName("max_attempts") val maxAttempts: Int,
    @SerialName("due_at") val dueAt: String?,
    @SerialName("deadline_at") val deadlineAt: String?,
    @SerialName("started_at") val startedAt: String?,
    @SerialName("created_at") val createdAt: String?,
    @SerialName("updated_at") val updatedAt: String?,
    @SerialName("progress") val progress: JobProgress?,
    @SerialName("error_message") val errorMessage: String?,
    @SerialName("scheduled") val scheduled: Boolean,
    @SerialName("waiting") val waiting: Boolean = false,
    @SerialName("set_number") val setNumber: String?,
)

@Serializable
data class JobChange(
    @SerialName("success") val success: Boolean,
    @SerialName("id") val id: String,
    @SerialName("status") val status: String,
)

@Serializable
data class JobCounter(
    @SerialName("type") val type: String,
    @SerialName("status") val status: String,
    @SerialName("count") val count: Int,
)

@Serializable
data class JobKindDrain(
    @SerialName("success") val success: Boolean,
    @SerialName("kind") val kind: String,
    @SerialName("removed") val removed: Int,
)

@Serializable
data class JobKindStart(
    @SerialName("success") val success: Boolean,
    @SerialName("kind") val kind: String,
    @SerialName("started") val started: Boolean,
)

@Serializable
data class JobPause(
    @SerialName("type") val type: String,
    @SerialName("until_at") val untilAt: String?,
    @SerialName("reason") val reason: String?,
)

@Serializable
data class JobProcess(
    @SerialName("heartbeat") val heartbeat: String?,
    @SerialName("age_seconds") val ageSeconds: Int?,
    @SerialName("running") val running: Boolean,
)

@Serializable
data class JobProgress(
    @SerialName("done") val done: Int? = null,
    @SerialName("total") val total: Int? = null,
    @SerialName("text") val text: String? = null,
)

@Serializable
data class JobQueueResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("jobs") val jobs: List<Job>,
    @SerialName("summary") val summary: List<JobCounter>,
    @SerialName("pauses") val pauses: List<JobPause>,
    @SerialName("image_demand") val imageDemand: Int,
    @SerialName("job_process") val jobProcess: JobProcess,
)

@Serializable
data class JobSchedule(
    @SerialName("type") val type: String = "daily",
    @SerialName("time") val time: String? = null,
    @SerialName("minutes") val minutes: Int? = null,
)

@Serializable
data class JobStatus(
    @SerialName("lastRun") val lastRun: JsonElement? = null,
    @SerialName("canRedownload") val canRedownload: Boolean = false,
    @SerialName("queue") val queue: Int? = null,
    @SerialName("queueLastRun") val queueLastRun: JsonElement? = null,
    @SerialName("label") val label: String = "",
    @SerialName("status") val status: RunStatus = RunStatus.IDLE,
    @SerialName("progress") val progress: Int = 0,
    @SerialName("total") val total: Int = 0,
    @SerialName("sub") val sub: String? = null,
    @SerialName("sub_parts") val subParts: List<JobStatusSubPartsEntry> = emptyList(),
)

@Serializable
data class JobStatusSubPartsEntry(
    @SerialName("code") val code: String = "",
    @SerialName("values") val values: JsonObject = JsonObject(emptyMap()),
    @SerialName("ago") val ago: String = "",
)

@Serializable
data class JobsResponse(
    @SerialName("db") val db: JsonObject = JsonObject(emptyMap()),
    @SerialName("success") val success: Boolean,
    @SerialName("jobs") val jobs: Map<String, JobStatus> = emptyMap(),
    @SerialName("schedules") val schedules: Map<String, JobSchedule> = emptyMap(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("proxy_hint") val proxyHint: JobsResponseProxyHint? = null,
)

@Serializable
data class JobsResponseProxyHint(
    @SerialName("kind") val kind: String = "",
    @SerialName("vars") val vars: JobsResponseProxyHintVars = JobsResponseProxyHintVars(),
)

@Serializable
data class JobsResponseProxyHintVars(
    @SerialName("ip") val ip: String = "",
    @SerialName("minutes") val minutes: Int = 0,
    @SerialName("count") val count: Int = 0,
)

@Serializable
data class KeyNonceResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("nonce") val nonce: String,
)

@Serializable
data class LogEntries(
    @SerialName("success") val success: Boolean = false,
    @SerialName("entries") val entries: List<JsonObject> = emptyList(),
)

@Serializable
data class LogResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("minutes") val minutes: Int = 0,
    @SerialName("count") val count: Int = 0,
    @SerialName("logs") val logs: List<LogRow> = emptyList(),
)

@Serializable
data class LogRow(
    @SerialName("id") val id: Int? = null,
    @SerialName("level") val level: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("logged_at") val loggedAt: String? = null,
)

@Serializable
data class LoginRequest(
    @SerialName("username") val username: String,
    @SerialName("password") val password: String,
    @SerialName("code") @EncodeDefault(EncodeDefault.Mode.NEVER) val code: String? = null,
    @SerialName("without_token") @EncodeDefault(EncodeDefault.Mode.NEVER) val withoutToken: Boolean? = null,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class LoginResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("second_factor") val secondFactor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("cookie_missing") val cookieMissing: Boolean = false,
)

@Serializable
data class ManualFigsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("figs") val figs: List<FigValuationItem> = emptyList(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class ManualPartsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("parts") val parts: List<PartValuationItem> = emptyList(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class MeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("loggedIn") val loggedIn: Boolean = false,
    @SerialName("user") val user: User? = null,
    @SerialName("token_expires") val tokenExpires: String? = null,
    @SerialName("token_last_used") val tokenLastUsed: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
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
    @SerialName("conditions") val conditions: List<Condition> = emptyList(),
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("fig_name") val figName: String? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("total_quantity") val totalQuantity: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("source") val source: String = "set",
    @SerialName("set_added_at") val setAddedAt: String? = null,
)

@Serializable
data class MinifigParts(
    @SerialName("success") val success: Boolean = false,
    @SerialName("source") val source: String = "",
    @SerialName("parts") val parts: List<JsonObject> = emptyList(),
)

@Serializable
data class MinifigStats(
    @SerialName("unique_figs") val uniqueFigs: Int = 0,
    @SerialName("types") val types: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("manual") val manual: Int = 0,
)

@Serializable
data class MinifigStatsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("stats") val stats: MinifigStats = MinifigStats(),
)

@Serializable
data class MinifigsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("figs") val figs: List<Minifig> = emptyList(),
    @SerialName("source") val source: String = "",
    @SerialName("error") val error: String = "",
)

@Serializable
data class MoveSetRequest(
    @SerialName("from_user_id") val fromUserId: Int? = null,
    @SerialName("to_user_id") val toUserId: Int,
    @SerialName("acquisition_ids") val acquisitionIds: List<Int>? = null,
)

@Serializable
data class MoveSetResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("acquisitions") val acquisitions: Int = 0,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("parts") val parts: Int = 0,
    @SerialName("minifigs") val minifigs: Int = 0,
    @SerialName("instructions") val instructions: Int = 0,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    @SerialName("from_user_id") val fromUserId: Int = 0,
    @SerialName("to_user_id") val toUserId: Int = 0,
)

@Serializable
data class OthersEnded(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int = 0,
    @SerialName("accesses") val accesses: Int = 0,
)

@Serializable
data class ParsedVoucher(
    @SerialName("number") val number: String? = null,
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double? = null,
    @SerialName("currency") val currency: CurrencyCode? = null,
)

@Serializable
data class Part(
    @SerialName("part_number") val partNumber: String,
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
    @SerialName("is_spare") val isSpare: Boolean = false,
    @SerialName("condition") val condition: String? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("in_sets") val inSets: String? = null,
    @SerialName("bl_color_id") val blColorId: Int? = null,
)

@Serializable
data class PartColorRequest(
    @SerialName("color_id") val colorId: Int,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
)

@Serializable
data class PartColorResponse(
    @SerialName("image") val image: String? = null,
    @SerialName("success") val success: Boolean = false,
    @SerialName("combined") val combined: Boolean = false,
    @SerialName("moved") val moved: Int = 0,
    @SerialName("united") val united: Int = 0,
)

@Serializable
data class PartValuationItem(
    @SerialName("id") val id: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("conditions") val conditions: List<Condition> = emptyList(),
    @SerialName("user_id") val userId: Int? = null,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_id") val colorId: Int = NO_COLOR,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
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
data class PartsCategoriesResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("categories") val categories: List<PartsCategory> = emptyList(),
)

@Serializable
data class PartsCategory(
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("label") val label: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsFilterColor(
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("total_quantity") val totalQuantity: Int = 0,
)

@Serializable
data class PartsFilterColorsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("colors") val colors: List<PartsFilterColor> = emptyList(),
)

@Serializable
data class PartsLoaded(
    @SerialName("success") val success: Boolean = false,
    @SerialName("count") val count: Int = 0,
)

@Serializable
data class PartsResponse(
    @SerialName("source") val source: String? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 1,
    @SerialName("page_size") val pageSize: Int = 100,
    @SerialName("parts") val parts: List<Part> = emptyList(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("error") val error: String = "",
)

@Serializable
data class PartsStats(
    @SerialName("unique_parts") val uniqueParts: Int = 0,
    @SerialName("unique_colors") val uniqueColors: Int = 0,
    @SerialName("total_parts") val totalParts: Int = 0,
    @SerialName("manual_parts") val manualParts: Int? = null,
)

@Serializable
data class PartsStatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: PartsStats? = null,
)

@Serializable
data class PartsValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int = 0,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("parts") val parts: List<PartValuationItem> = emptyList(),
    @SerialName("total_value") val totalValue: String,
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("prices_pending") val pricesPending: Int = 0,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int = 0,
)

@Serializable
data class Passkey(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String? = null,
    @SerialName("transports") val transports: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("last_used") val lastUsed: String? = null,
)

@Serializable
data class PasskeyCreated(
    @SerialName("success") val success: Boolean = false,
    @SerialName("passkey") val passkey: PasskeyCreatedPasskey = PasskeyCreatedPasskey(),
)

@Serializable
data class PasskeyCreatedPasskey(
    @SerialName("id") val id: Int = 0,
    @SerialName("name") val name: String = "",
)

@Serializable
data class PasskeyList(
    @SerialName("success") val success: Boolean = false,
    @SerialName("available") val available: Boolean = false,
    @SerialName("passkeys") val passkeys: List<Passkey> = emptyList(),
)

@Serializable
data class PasskeyLoginRequest(
    @SerialName("response") @EncodeDefault(EncodeDefault.Mode.NEVER) val response: JsonObject? = null,
    @SerialName("with_token") val withToken: Boolean = true,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
)

@Serializable
data class PasskeyOptions(
    @SerialName("success") val success: Boolean = false,
    @SerialName("options") val options: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class PasskeyOptionsRequest(
    @SerialName("purpose") val purpose: String,
)

@Serializable
data class PasswordChange(
    @SerialName("newPassword") val newPassword: String,
    @SerialName("passkeys_revoked") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkeysRevoked: Boolean? = null,
    @SerialName("current") val current: String,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class PasswordSet(
    @SerialName("success") val success: Boolean = false,
    @SerialName("effective_at") val effectiveAt: String = "",
)

@Serializable
data class PdfInput(
    @SerialName("sets") val sets: List<PdfInputSetsEntry> = emptyList(),
    @SerialName("parts") val parts: List<PdfInputPartsEntry> = emptyList(),
)

@Serializable
data class PdfInputPartsEntry(
    @SerialName("part_number") val partNumber: String = "",
    @SerialName("bl_part_number") val blPartNumber: String? = null,
    @SerialName("part_name") val partName: String? = null,
    @SerialName("color_name") val colorName: String? = null,
    @SerialName("color_hex") val colorHex: String? = null,
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("quantity") val quantity: JsonElement = JsonNull,
    @SerialName("is_fig") val isFig: JsonElement? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
)

@Serializable
data class PdfInputSetsEntry(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
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
    @SerialName("success") val success: Boolean = false,
    @SerialName("jobId") val jobId: String = "",
)

@Serializable
data class PdfJobSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
)

@Serializable
data class PdfJobState(
    @SerialName("success") val success: Boolean = false,
    @SerialName("status") val status: RunStatus = RunStatus.UNKNOWN,
    @SerialName("error") val error: String? = null,
    @SerialName("etaSeconds") val etaSeconds: Double? = null,
    @SerialName("missingImages") val missingImages: JsonElement? = null,
)

@Serializable
data class PendingAlertsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alerts") val alerts: List<PriceAlert> = emptyList(),
    @SerialName("now") val now: String? = null,
)

@Serializable
data class PnlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("totals") val totals: PnlTotals,
    @SerialName("sets") val sets: List<PnlSetRow> = emptyList(),
)

@Serializable
data class PnlSetRow(
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("condition") val condition: String = "",
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("pnl_abs") val pnlAbs: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("set_number") val setNumber: String,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("current_price") val currentPrice: Double? = null,
    @SerialName("baseline_price") val baselinePrice: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("baseline_pnl_pct") val baselinePnlPct: String? = null,
    @SerialName("pnl_amount") val pnlAmount: Double? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("baseline_pnl_percent") val baselinePnlPercent: Double? = null,
    @SerialName("tile_price") val tilePrice: Double? = null,
    @SerialName("tile_pnl_pct") val tilePnlPct: Double? = null,
    @SerialName("tile_source") val tileSource: String? = null,
)

@Serializable
data class PnlTotals(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int = 0,
    @SerialName("pnl_current") val pnlCurrent: JsonElement? = null,
    @SerialName("pnl_purchase") val pnlPurchase: JsonElement? = null,
    @SerialName("purchase") val purchase: String,
    @SerialName("current") val current: String,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int = 0,
    @SerialName("sets_purchase") val setsPurchase: String = "",
    @SerialName("parts_purchase") val partsPurchase: String = "",
    @SerialName("figs_purchase") val figsPurchase: String = "",
    @SerialName("grand_total") val grandTotal: String = "",
    @SerialName("positions") val positions: Int? = null,
    @SerialName("positions_valued") val positionsValued: Int? = null,
    @SerialName("positions_without_market_price") val positionsWithoutMarketPrice: Int? = null,
    @SerialName("positions_without_purchase_price") val positionsWithoutPurchasePrice: Int? = null,
    @SerialName("baseline_cost") val baselineCost: String? = null,
    @SerialName("baseline_market_value") val baselineMarketValue: String? = null,
    @SerialName("baseline_pnl_amount") val baselinePnlAmount: String? = null,
    @SerialName("cost_without_market_price") val costWithoutMarketPrice: String? = null,
    @SerialName("market_value_without_purchase_price") val marketValueWithoutPurchasePrice: String? = null,
)

@Serializable
data class PortfolioHistoryResponse(
    @SerialName("chart") val chart: PriceChartData? = null,
    @SerialName("data_points") val dataPoints: Int? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("period") val period: String = "week",
    @SerialName("points") val points: List<ChartPoint> = emptyList(),
    @SerialName("y_axis") val yAxis: List<ChartYAxis> = emptyList(),
    @SerialName("period_change_pct") val periodChangePct: Double? = null,
    @SerialName("purchase_total") val purchaseTotal: String? = null,
)

@Serializable
data class PriceAlert(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("direction") val direction: AlarmDirection = AlarmDirection.BELOW,
    @SerialName("threshold") val threshold: Double = 0.0,
    @SerialName("currency_code") val currencyCode: CurrencyCode = CurrencyCode.NONE,
    @SerialName("triggered") val triggered: Boolean = false,
    @SerialName("last_triggered_at") val lastTriggeredAt: String? = null,
    @SerialName("last_price") val lastPrice: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("set_img_url") val setImgUrl: String? = null,
    @SerialName("owns") val owns: Boolean = true,
)

@Serializable
data class PriceAlertRequest(
    @SerialName("direction") val direction: AlarmDirection,
    @SerialName("threshold") val threshold: Double,
    @SerialName("condition") val condition: Condition = Condition.NEW,
)

@Serializable
data class PriceAlertResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alert") val alert: PriceAlert? = null,
    @SerialName("removed") val removed: Int = 0,
)

@Serializable
data class PriceAlertsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("alerts") val alerts: List<PriceAlert> = emptyList(),
)

@Serializable
data class PriceByCondition(
    @SerialName("N") val new: ConditionValuation? = null,
    @SerialName("U") val used: ConditionValuation? = null,
)

@Serializable
data class PriceChartData(
    @SerialName("values") val values: List<PriceChartSeries> = emptyList(),
    @SerialName("x") val x: List<String> = emptyList(),
)

@Serializable
data class PriceChartPoint(
    @SerialName("x") val x: String = "",
    @SerialName("y") val y: Double = 0.0,
)

@Serializable
data class PriceChartSeries(
    @SerialName("name") val name: String = "",
    @SerialName("values") val values: List<PriceChartPoint> = emptyList(),
    @SerialName("firstRealIndex") val firstRealIndex: Int = 0,
)

@Serializable
data class PriceHistoryPoint(
    @SerialName("is_purchase_price") val isPurchasePrice: Boolean = false,
    @SerialName("recorded_at") val recordedAt: String = "",
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
)

@Serializable
data class PriceHistoryResponse(
    @SerialName("condition") val condition: String? = null,
    @SerialName("current") val current: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.NONE,
    @SerialName("history_new") val historyNew: List<PriceHistoryPoint> = emptyList(),
    @SerialName("history_used") val historyUsed: List<PriceHistoryPoint> = emptyList(),
    @SerialName("by_condition") val byCondition: PriceByCondition = PriceByCondition(),
    @SerialName("chart") val chart: PriceChartData = PriceChartData(),
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
)

@Serializable
data class PriceJobState(
    @SerialName("success") val success: Boolean = false,
    @SerialName("job") val job: PriceJobStateJob = PriceJobStateJob(),
    @SerialName("rate_limit") val rateLimit: PriceJobStateRateLimit = PriceJobStateRateLimit(),
)

@Serializable
data class PriceJobStateJob(
    @SerialName("running") val running: Boolean = false,
    @SerialName("lastRun") val lastRun: String? = null,
    @SerialName("nextRun") val nextRun: String? = null,
    @SerialName("lastErrors") val lastErrors: Int = 0,
    @SerialName("log") val log: List<JsonElement?> = emptyList(),
    @SerialName("lastDuration") val lastDuration: Double? = null,
    @SerialName("lastUpdated") val lastUpdated: Double? = null,
    @SerialName("progress") val progress: PriceJobStateJobProgress? = null,
)

@Serializable
data class PriceJobStateJobProgress(
    @SerialName("current") val current: JsonElement? = null,
    @SerialName("total") val total: JsonElement? = null,
    @SerialName("set") val set: JsonElement? = null,
)

@Serializable
data class PriceJobStateRateLimit(
    @SerialName("count") val count: Int = 0,
    @SerialName("limit") val limit: Int = 0,
    @SerialName("remaining") val remaining: Int = 0,
    @SerialName("date") val date: String? = null,
)

@Serializable
data class Profile(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("email") val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("email_verified") val emailVerified: Boolean = false,
    @SerialName("new_email") val newEmail: String? = null,
)

@Serializable
data class ProfileRequest(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") @EncodeDefault(EncodeDefault.Mode.NEVER) val password: String? = null,
    @SerialName("password_current") val passwordCurrent: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class ProfileResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("user") val user: Profile? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProfileSavedResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("emailChanged") val emailChanged: Boolean? = null,
    @SerialName("emailSent") val emailSent: Boolean? = null,
)

@Serializable
data class QrCollectRequest(
    @SerialName("pickup") val pickup: String,
    @SerialName("preview") val preview: Boolean = false,
)

@Serializable
data class QrDiscard(
    @SerialName("pickup") val pickup: String,
)

@Serializable
data class QrLoginRequest(
    @SerialName("token") val token: String,
    @SerialName("label") val label: String = "Android App",
)

@Serializable
data class QrMessage(
    @SerialName("success") val success: Boolean,
    @SerialName("waiting") val waiting: Boolean = false,
    @SerialName("pickup") val pickup: String = "",
    @SerialName("code") val code: String = "",
    @SerialName("expires_in") val expiresIn: Int = 300,
)

@Serializable
data class QrPairingState(
    @SerialName("success") val success: Boolean = false,
    @SerialName("state") val state: String = "",
    @SerialName("device") val device: String? = null,
    @SerialName("ip_range") val ipRange: String? = null,
)

@Serializable
data class QrPickup(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("second_factor") val secondFactor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("waiting") val waiting: Boolean = false,
    @SerialName("username") val username: String? = null,
    @SerialName("isAdmin") val isAdmin: Boolean = false,
    @SerialName("userId") val userId: Int = 0,
    @SerialName("preview") val preview: Boolean = false,
    @SerialName("key_nonce") val keyNonce: String? = null,
)

@Serializable
data class QrToken(
    @SerialName("success") val success: Boolean = false,
    @SerialName("token") val token: String = "",
    @SerialName("pairing") val pairing: Int = 0,
    @SerialName("expires_in") val expiresIn: Int = 0,
    @SerialName("url") val url: String = "",
    @SerialName("token_days") val tokenDays: Int? = null,
    @SerialName("fp") val fp: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
)

@Serializable
data class QuantityChanged(
    @SerialName("success") val success: Boolean = false,
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("trash") val trash: Int = 0,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("dropped") val dropped: List<QuantityChangedDroppedEntry> = emptyList(),
)

@Serializable
data class QuantityChangedDroppedEntry(
    @SerialName("id") val id: Int = 0,
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("currency") val currency: String? = null,
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
    @SerialName("condition") val condition: String = "",
    @SerialName("date") val date: String? = null,
)

@Serializable
data class RateLimit(
    @SerialName("date") val date: String? = null,
    @SerialName("count") val count: Int = 0,
    @SerialName("limit") val limit: Int = 0,
    @SerialName("remaining") val remaining: Int = 0,
)

@Serializable
data class RateLimits(
    @SerialName("bricklink") val bricklink: RateLimit = RateLimit(),
    @SerialName("rebrickable") val rebrickable: RateLimit = RateLimit(),
    @SerialName("brickset") val brickset: RateLimit = RateLimit(),
)

@Serializable
data class RawSettings(
    @SerialName("success") val success: Boolean = false,
    @SerialName("settings") val settings: Map<String, String> = emptyMap(),
)

@Serializable
data class RegisterRequest(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") val password: String,
    @SerialName("language") val language: String = "de",
)

@Serializable
data class RegisterResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String = "",
    @SerialName("email_sent") val emailSent: Boolean = false,
    @SerialName("console_mode") val consoleMode: Boolean = false,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class RegistrationStatusResponse(
    @SerialName("enabled") val enabled: Boolean = false,
    @SerialName("passkey") val passkey: Boolean = false,
    @SerialName("forgot_password") val forgotPassword: Boolean = false,
    @SerialName("mail_delivery") val mailDelivery: Boolean = false,
)

@Serializable
data class Restored(
    @SerialName("success") val success: Boolean = false,
    @SerialName("type") val type: String = "",
    @SerialName("number") val number: String = "",
    @SerialName("user_id") val userId: Int = 0,
)

@Serializable
data class SecondFactorCodes(
    @SerialName("success") val success: Boolean,
    @SerialName("codes") val codes: List<String> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SecondFactorRequest(
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class SecondFactorSetupResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("secret") val secret: String? = null,
    @SerialName("otpauth") val otpauth: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SecondFactorStateResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("active") val active: Boolean = false,
    @SerialName("codes_left") val codesLeft: Int = 0,
    @SerialName("old_codes_until") val oldCodesUntil: String? = null,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SeparatedAccount(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String = "",
    @SerialName("via") val via: String? = null,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("acq_count") val acqCount: Int = 0,
    @SerialName("used_count") val usedCount: Int = 0,
    @SerialName("conditions") val conditions: List<Condition> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
)

@Serializable
data class SetExistsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("exists") val exists: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
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
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("name") val name: String? = null,
    @SerialName("in_catalog") val inCatalog: Boolean = false,
)

@Serializable
data class SetItem(
    @SerialName("acq_count") val acqCount: Int = 0,
    @SerialName("last_purchase") val lastPurchase: String? = null,
    @SerialName("owner_ids") val ownerIds: List<Int> = emptyList(),
    @SerialName("id") val id: Int = 0,
    @SerialName("storage_id") val storageId: Int? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("theme") val theme: String? = null,
    @SerialName("pieces") val pieces: Int? = null,
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("storage") val storage: String? = null,
    @SerialName("conditions") val conditions: List<Condition> = emptyList(),
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("purchase_price_estimated") val purchasePriceEstimated: Boolean? = null,
    @SerialName("used_count") val usedCount: Int = 0,
    @SerialName("instructions") val instructions: List<Instruction> = emptyList(),
    @SerialName("bricklink") val bricklink: BrickLinkRef? = null,
    @SerialName("price_comparison_url") val priceComparisonUrl: String? = null,
)

@Serializable
data class SetPriceResponse(
    @SerialName("from_cache") val fromCache: Boolean = false,
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.NONE,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
    @SerialName("error") val error: String = "",
)

@Serializable
data class SetResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("set") val set: SetItem? = null,
)

@Serializable
data class SetsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("count") val count: Int = 0,
    @SerialName("sets") val sets: List<SetItem> = emptyList(),
    @SerialName("total") val total: Int = 0,
    @SerialName("themes") val themes: List<String> = emptyList(),
)

@Serializable
data class SettingsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: UserSettings = UserSettings(),
)

@Serializable
data class Setup(
    @SerialName("success") val success: Boolean = false,
    @SerialName("open") val open: Boolean = false,
    @SerialName("change_password") val changePassword: Boolean = false,
    @SerialName("sources") val sources: SetupSources = SetupSources(),
)

@Serializable
data class SetupSources(
    @SerialName("rebrickable") val rebrickable: Boolean = false,
    @SerialName("bricklink") val bricklink: Boolean = false,
    @SerialName("brickset") val brickset: Boolean = false,
)

@Serializable
data class SetupState(
    @SerialName("success") val success: Boolean = false,
    @SerialName("done") val done: Boolean = false,
    @SerialName("configured") val configured: Boolean = false,
    @SerialName("steps") val steps: List<SetupStateStepsEntry> = emptyList(),
    @SerialName("ca") val ca: SetupStateCa = SetupStateCa(),
    @SerialName("base_url") val baseUrl: String? = null,
    @SerialName("https") val https: Boolean = false,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class SetupStateCa(
    @SerialName("existing") val existing: Boolean = false,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
    @SerialName("valid_until") val validUntil: String = "",
    @SerialName("download") val download: String = "",
)

@Serializable
data class SetupStateStepsEntry(
    @SerialName("id") val id: String = "",
    @SerialName("ok") val ok: Boolean = false,
    @SerialName("required") val required: Boolean = false,
)

@Serializable
data class SmtpProbe(
    @SerialName("mode") val mode: String? = null,
    @SerialName("success") val success: Boolean = false,
)

@Serializable
data class StartupStatus(
    @SerialName("error") val error: String? = null,
    @SerialName("path") val path: String? = null,
    @SerialName("ready") val ready: Boolean = false,
    @SerialName("step") val step: String? = null,
    @SerialName("progress") val progress: Double = 0.0,
    @SerialName("total") val total: Int = 0,
    @SerialName("sub") val sub: String? = null,
)

@Serializable
data class StatsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("stats") val stats: DashboardStats? = null,
)

@Serializable
data class StepApprovalRequest(
    @SerialName("challenge") val challenge: String,
    @SerialName("signature") val signature: String,
)

@Serializable
data class StepApprovalResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("action") val action: String,
    @SerialName("valid_until") val validUntil: String,
)

@Serializable
data class StepChallengeRequest(
    @SerialName("action") val action: String,
)

@Serializable
data class StepChallengeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("challenge") val challenge: String,
    @SerialName("message") val message: String,
    @SerialName("valid_until") val validUntil: String,
)

@Serializable
data class Storage(
    @SerialName("minifigs") val minifigs: Int? = null,
    @SerialName("location") val location: String,
    @SerialName("sets") val sets: Int = 0,
    @SerialName("parts") val parts: Int = 0,
)

@Serializable
data class StorageDefaultRequest(
    @SerialName("id") val id: Int? = null,
)

@Serializable
data class StorageDefaultResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("preset") val preset: StorageEntry? = null,
)

@Serializable
data class StorageEntry(
    @SerialName("id") val id: Int = 0,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("name") val name: String = "",
)

@Serializable
data class StorageEntryResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("location") val location: StorageEntry? = null,
)

@Serializable
data class StorageNameRequest(
    @SerialName("name") val name: String,
    @SerialName("owner") @EncodeDefault(EncodeDefault.Mode.NEVER) val owner: JsonElement? = null,
)

@Serializable
data class StorageRequest(
    @SerialName("storage") val storage: String,
)

@Serializable
data class StorageResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("storage") val storage: String? = null,
    @SerialName("changed") val changed: Int = 0,
)

@Serializable
data class StorageStockResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("locations") val locations: List<StorageEntry> = emptyList(),
    @SerialName("preset") val preset: StorageEntry? = null,
)

@Serializable
data class StoragesResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("locations") val locations: List<Storage> = emptyList(),
)

@Serializable
data class TlsState(
    @SerialName("success") val success: Boolean = false,
    @SerialName("https") val https: Boolean = false,
    @SerialName("fp") val fp: String? = null,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
    @SerialName("subject") val subject: String = "",
    @SerialName("valid_until") val validUntil: String = "",
    @SerialName("download") val download: String = "",
)

@Serializable
data class TokenCreated(
    @SerialName("success") val success: Boolean = false,
    @SerialName("token") val token: String = "",
    @SerialName("label") val label: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
)

@Serializable
data class TokenInfo(
    @SerialName("scope") val scope: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("rotated_at") val rotatedAt: String? = null,
    @SerialName("rotation_due") val rotationDue: Boolean = false,
)

@Serializable
data class TokenRevocation(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int = 0,
)

@Serializable
data class TokenRotation(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("old_valid_until") val oldValidUntil: String? = null,
    @SerialName("overlap_seconds") val overlapSeconds: Int? = null,
)

@Serializable
data class TokensResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("tokens") val tokens: List<AppToken> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Totals(
    @SerialName("min") val min: String = "0.00",
    @SerialName("avg") val avg: String = "0.00",
    @SerialName("max") val max: String = "0.00",
    @SerialName("qty_avg") val qtyAvg: String = "0.00",
)

@Serializable
data class Trash(
    @SerialName("success") val success: Boolean = false,
    @SerialName("entries") val entries: List<TrashEntry> = emptyList(),
)

@Serializable
data class TrashEmptied(
    @SerialName("success") val success: Boolean = false,
    @SerialName("removed") val removed: Int = 0,
)

@Serializable
data class TrashEntry(
    @SerialName("id") val id: Int = 0,
    @SerialName("type") val type: String = "",
    @SerialName("number") val number: String = "",
    @SerialName("color_id") val colorId: Int? = null,
    @SerialName("label") val label: String? = null,
    @SerialName("count") val count: Int = 0,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("deleted_at") val deletedAt: String = "",
    @SerialName("purge_at") val purgeAt: String = "",
)

@Serializable
data class UpdateAcquisitionRequest(
    @SerialName("quantity") val quantity: Int? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("date") val date: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("from_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val fromUserId: JsonElement? = null,
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
data class UpdateQuantityRequest(
    @SerialName("quantity") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantity: Int? = null,
    @SerialName("quantity_delta") @EncodeDefault(EncodeDefault.Mode.NEVER) val quantityDelta: Int? = null,
    @SerialName("purchase_price") @EncodeDefault(EncodeDefault.Mode.NEVER) val purchasePrice: Double? = null,
    @SerialName("condition") @EncodeDefault(EncodeDefault.Mode.NEVER) val condition: Condition? = null,
    @SerialName("owner_user_id") @EncodeDefault(EncodeDefault.Mode.NEVER) val ownerUserId: JsonElement? = null,
)

@Serializable
data class User(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean = false,
    @SerialName("secondFactorRequired") val secondFactorRequired: Boolean = false,
)

@Serializable
data class UserSettings(
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("price_condition") val priceCondition: Condition = Condition.NEW,
    @SerialName("price_cache_ttl") val priceCacheTtl: String = "24",
    @SerialName("default_price_condition") val defaultPriceCondition: Condition = Condition.NEW,
    @SerialName("user_default_condition") val userDefaultCondition: Condition? = null,
    @SerialName("effective_condition") val effectiveCondition: Condition = Condition.NEW,
    @Serializable(with = DesignOrNothing::class) @SerialName("app_theme") val appTheme: Design? = null,
    @SerialName("remove_empty_vouchers") val removeEmptyVouchers: Boolean = false,
)

@Serializable
data class UsingSet(
    @SerialName("set_number") val setNumber: String,
    @SerialName("set_name") val setName: String? = null,
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("owner_user_id") val ownerUserId: Int = 0,
)

@Serializable
data class UsingSetsResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("item") val item: ComponentHeader? = null,
    @SerialName("sets") val sets: List<UsingSet> = emptyList(),
)

@Serializable
data class ValuationAcquisition(
    @SerialName("id") val id: Int = 0,
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("original_purchase_price") val originalPurchasePrice: Double = 0.0,
    @SerialName("purchase_currency") val purchaseCurrency: String = "",
    @SerialName("price_estimated") val priceEstimated: Boolean = false,
)

@Serializable
data class ValuationResponse(
    @SerialName("converted_purchase_prices") val convertedPurchasePrices: Int = 0,
    @SerialName("guide_type") val guideType: String = "",
    @SerialName("ttl_hours") val ttlHours: JsonElement? = null,
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("total_value") val totalValue: String = "",
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("prices_pending") val pricesPending: Int = 0,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("cache_ttl_hours") val cacheTtlHours: Int = 0,
    @SerialName("foreign_currency_purchases") val foreignCurrencyPurchases: Int = 0,
    @SerialName("sets") val sets: List<ValuationSet> = emptyList(),
    @SerialName("totals") val totals: Totals = Totals(),
)

@Serializable
data class ValuationSet(
    @SerialName("bl_unknown") val blUnknown: Boolean = false,
    @SerialName("condition") val condition: String = "",
    @SerialName("conditions") val conditions: List<String> = emptyList(),
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("pnl_pct") val pnlPct: String? = null,
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("set_number") val setNumber: String,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("min_price") val minPrice: Double? = null,
    @SerialName("avg_price") val avgPrice: Double? = null,
    @SerialName("max_price") val maxPrice: Double? = null,
    @SerialName("qty_avg_price") val qtyAvgPrice: Double? = null,
    @SerialName("total_qty_avg") val totalQtyAvg: String? = null,
    @SerialName("price_pending") val pricePending: Boolean = false,
    @SerialName("total_avg") val totalAvg: String? = null,
    @SerialName("value_total") val valueTotal: Double? = null,
    @SerialName("pnl_percent") val pnlPercent: Double? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("from_cache") val fromCache: Boolean = true,
    @SerialName("is_fallback") val isFallback: Boolean = false,
    @SerialName("condition_used") val conditionUsed: Condition? = null,
    @SerialName("no_price") val noPrice: Boolean = false,
    @SerialName("acquisitions") val acquisitions: List<ValuationAcquisition> = emptyList(),
    @SerialName("mixed") val mixed: Boolean = false,
    @SerialName("owners") val owners: List<AccountName> = emptyList(),
    @SerialName("error") val error: String? = null,
)

@Serializable
data class Voucher(
    @SerialName("id") val id: Int = 0,
    @SerialName("number") val number: String = "",
    @SerialName("pin") val pin: String? = null,
    @SerialName("amount") val amount: Double = 0.0,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.CHF,
    @SerialName("has_pdf") val hasPdf: Boolean = false,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
    @SerialName("balance_checked_at") val balanceCheckedAt: String? = null,
)

@Serializable
data class VoucherBatch(
    @SerialName("results") val results: List<JsonElement?> = emptyList(),
    @SerialName("added") val added: Int = 0,
    @SerialName("updated") val updated: Int = 0,
    @SerialName("errors") val errors: Int = 0,
    @SerialName("total") val total: Int = 0,
)

@Serializable
data class VoucherList(
    @SerialName("success") val success: Boolean = true,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("vouchers") val vouchers: List<Voucher> = emptyList(),
)

@Serializable
data class VoucherPdfGrant(
    @SerialName("success") val success: Boolean = false,
    @SerialName("ticket") val ticket: String = "",
    @SerialName("valid_seconds") val validSeconds: Int = 0,
)

@Serializable
data class VoucherPlaintext(
    @SerialName("success") val success: Boolean = false,
    @SerialName("id") val id: Int = 0,
    @SerialName("number") val number: String = "",
    @SerialName("pin") val pin: String? = null,
)

@Serializable
data class VoucherReply(
    @SerialName("success") val success: Boolean = false,
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

@Serializable
data class WantedItem(
    @SerialName("theme_id") val themeId: Int? = null,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("user_id") val userId: Int = 0,
    @SerialName("name") val name: String? = null,
    @SerialName("year") val year: Int? = null,
    @SerialName("num_parts") val numParts: Int? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("market_price") val marketPrice: Double? = null,
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.EUR,
    @SerialName("owned") val owned: Boolean = false,
    @SerialName("alarm") val alarm: WantedItemAlert? = null,
    @SerialName("price_comparison_url") val priceComparisonUrl: String? = null,
)

@Serializable
data class WantedItemAlert(
    @SerialName("direction") val direction: AlarmDirection = AlarmDirection.BELOW,
    @SerialName("threshold") val threshold: Double = 0.0,
    @SerialName("triggered") val triggered: Boolean = false,
)

@Serializable
data class WantedItemOwnerReply(
    @SerialName("success") val success: Boolean = false,
    @SerialName("moved") val moved: Boolean = false,
    @SerialName("merged") val merged: Boolean = false,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

@Serializable
data class WantedItemOwnerRequest(
    @SerialName("owner_user_id") val ownerUserId: Int,
    @SerialName("new_owner") val newOwner: Int,
)

@Serializable
data class WantedItemPricesResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("currency") val currency: CurrencyCode = CurrencyCode.NONE,
    @SerialName("current") val current: CurrentByCondition = CurrentByCondition(),
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class WantedItemReply(
    @SerialName("success") val success: Boolean = false,
    @SerialName("was_new") val wasNew: Boolean = false,
    @SerialName("item") val item: WantedItem? = null,
)

@Serializable
data class WantedItemRequest(
    @SerialName("set_number") val setNumber: String,
    @SerialName("condition") val condition: Condition = Condition.NEW,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
)

@Serializable
data class WantedItemTakeoverRequest(
    @SerialName("quantity") val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @SerialName("condition") val condition: Condition? = null,
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("storage") val storage: String? = null,
)

@Serializable
data class WantedItemTakeoverResponse(
    @SerialName("catalog_pending") val catalogPending: Boolean = false,
    @SerialName("name") val name: String? = null,
    @SerialName("success") val success: Boolean = false,
    @SerialName("action") val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
)

@Serializable
data class WantedListResponse(
    @SerialName("success") val success: Boolean = false,
    @SerialName("total") val total: Int = 0,
    @SerialName("page") val page: Int = 0,
    @SerialName("page_size") val pageSize: Int = 0,
    @SerialName("item") val item: List<WantedItem> = emptyList(),
)

@Serializable
data class WantedXmlResult(
    @SerialName("success") val success: Boolean = false,
    @SerialName("preview") val preview: Boolean = false,
    @SerialName("parsed") val parsed: Int = 0,
    @SerialName("created") val created: Int = 0,
    @SerialName("topped_up") val toppedUp: Int = 0,
    @SerialName("failed") val failed: Int = 0,
    @SerialName("items") val items: List<WantedXmlResultItemsEntry> = emptyList(),
    @SerialName("open") val open: List<WantedXmlResultOpenEntry> = emptyList(),
    @SerialName("foreignTypes") val foreignTypes: Map<String, Int> = emptyMap(),
    @SerialName("withoutNumber") val withoutNumber: Int = 0,
    @SerialName("levels") val levels: Map<String, Int> = emptyMap(),
    @SerialName("colorPending") val colorPending: Int = 0,
    @SerialName("defaultCondition") val defaultCondition: String = "",
    @SerialName("aborted") val aborted: Boolean = false,
    @SerialName("corrections") val corrections: WantedXmlResultCorrections = WantedXmlResultCorrections(),
    @SerialName("rebrickable") val rebrickable: WantedXmlResultRebrickable = WantedXmlResultRebrickable(),
)

@Serializable
data class WantedXmlResultCorrections(
    @SerialName("applied") val applied: Int = 0,
    @SerialName("rejected") val rejected: List<JsonElement?> = emptyList(),
)

@Serializable
data class WantedXmlResultItemsEntry(
    @SerialName("kind") val kind: String = "",
    @SerialName("blId") val blId: String = "",
    @SerialName("quantity") val quantity: Int = 0,
    @SerialName("outcome") val outcome: String = "",
    @SerialName("blColor") val blColor: Int? = null,
    @SerialName("rbId") val rbId: String? = null,
    @SerialName("rbColor") val rbColor: Int? = null,
    @SerialName("colorName") val colorName: String? = null,
    @SerialName("colorHex") val colorHex: String? = null,
    @SerialName("confidence") val confidence: String? = null,
    @SerialName("condition") val condition: String? = null,
    @SerialName("maxPrice") val maxPrice: Double? = null,
    @SerialName("name") val name: String? = null,
    @SerialName("nameGuessed") val nameGuessed: Boolean = false,
    @SerialName("image") val image: String? = null,
    @SerialName("reason") val reason: String? = null,
    @SerialName("reasonCode") val reasonCode: String? = null,
)

@Serializable
data class WantedXmlResultOpenEntry(
    @SerialName("kind") val kind: String = "",
    @SerialName("blId") val blId: String = "",
    @SerialName("blColor") val blColor: Int? = null,
)

@Serializable
data class WantedXmlResultRebrickable(
    @SerialName("asked") val asked: Int = 0,
    @SerialName("found") val found: Int = 0,
    @SerialName("filterIneffective") val filterIneffective: Boolean = false,
    @SerialName("aborted") val aborted: String = "",
)

@Serializable
data class YearCount(
    @SerialName("year") val year: Int? = null,
    @SerialName("n") val n: Int = 0,
)
