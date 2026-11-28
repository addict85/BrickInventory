// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.appearance.DesignOrNothing
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class AppThemeResponse(
    @SerialName("success") val success: Boolean,
    @Serializable(with = DesignOrNothing::class) @SerialName("theme") val theme: Design?,
    @Serializable(with = DesignOrNothing::class) @SerialName("preset") val preset: Design?,
    @Serializable(with = DesignOrNothing::class) @SerialName("own") val own: Design?,
)

@Serializable
data class Backup(
    @SerialName("version") val version: String,
    @SerialName("exported_at") val exportedAt: String,
    @SerialName("exported_by") val exportedBy: String?,
    @SerialName("global") val global: Map<String, String>,
    @SerialName("user_settings") val userSettings: Map<String, String>,
)

@Serializable
data class BackupRestored(
    @SerialName("success") val success: Boolean,
    @SerialName("imported") val imported: Int,
    @SerialName("note") val note: String,
    @SerialName("smtp_skipped") val smtpSkipped: List<String>,
)

@Serializable
data class DefaultConditionResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("condition") val condition: Condition,
)

@Serializable
data class Health(
    @SerialName("status") val status: String,
    @SerialName("startup") val startup: StartupStatus? = null,
    @SerialName("db_pool") val dbPool: JsonObject = JsonObject(emptyMap()),
    @SerialName("uptime_seconds") val uptimeSeconds: Int = 0,
)

@Serializable
data class Heartbeat(
    @SerialName("status") val status: String,
)

@Serializable
data class RawSettings(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: Map<String, String>,
)

@Serializable
data class SettingsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("settings") val settings: UserSettings,
)

@Serializable
data class Setup(
    @SerialName("success") val success: Boolean,
    @SerialName("open") val open: Boolean,
    @SerialName("change_password") val changePassword: Boolean,
    @SerialName("sources") val sources: SetupSources,
)

@Serializable
data class SetupSources(
    @SerialName("rebrickable") val rebrickable: Boolean,
    @SerialName("bricklink") val bricklink: Boolean,
    @SerialName("brickset") val brickset: Boolean,
)

@Serializable
data class SetupState(
    @SerialName("success") val success: Boolean,
    @SerialName("done") val done: Boolean,
    @SerialName("configured") val configured: Boolean,
    @SerialName("steps") val steps: List<SetupStateStepsEntry>,
    @SerialName("ca") val ca: SetupStateCa,
    @SerialName("base_url") val baseUrl: String?,
    @SerialName("https") val https: Boolean,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class SetupStateCa(
    @SerialName("existing") val existing: Boolean,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
    @SerialName("valid_until") val validUntil: String = "",
    @SerialName("download") val download: String,
)

@Serializable
data class SetupStateStepsEntry(
    @SerialName("id") val id: String,
    @SerialName("ok") val ok: Boolean,
    @SerialName("required") val required: Boolean,
)

@Serializable
data class SmtpProbe(
    @SerialName("mode") val mode: String?,
    @SerialName("success") val success: Boolean,
)

@Serializable
data class StartupStatus(
    @SerialName("error") val error: String? = null,
    @SerialName("path") val path: String? = null,
    @SerialName("ready") val ready: Boolean,
    @SerialName("step") val step: String?,
    @SerialName("progress") val progress: Double,
    @SerialName("total") val total: Int,
    @SerialName("sub") val sub: String?,
)

@Serializable
data class TlsState(
    @SerialName("success") val success: Boolean,
    @SerialName("https") val https: Boolean,
    @SerialName("fp") val fp: String?,
    @SerialName("fp_hex") val fpHex: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
    @SerialName("subject") val subject: String = "",
    @SerialName("valid_until") val validUntil: String = "",
    @SerialName("download") val download: String = "",
)

@Serializable
data class UserSettings(
    @SerialName("currency") val currency: CurrencyCode,
    @SerialName("price_condition") val priceCondition: Condition,
    @SerialName("price_cache_ttl") val priceCacheTtl: String,
    @SerialName("default_price_condition") val defaultPriceCondition: Condition,
    @SerialName("user_default_condition") val userDefaultCondition: Condition?,
    @SerialName("effective_condition") val effectiveCondition: Condition,
    @Serializable(with = DesignOrNothing::class) @SerialName("app_theme") val appTheme: Design?,
    @SerialName("remove_empty_vouchers") val removeEmptyVouchers: Boolean,
)
