// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.RunStatus
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class ApiLimits(
    @SerialName("rebrickable") val rebrickable: Int,
    @SerialName("bricklink") val bricklink: Int,
    @SerialName("brickset") val brickset: Int,
)

@Serializable
data class ApiLimitsResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("limits") val limits: ApiLimits,
)

@Serializable
data class BricksetQueueEntry(
    @SerialName("created_at") val createdAt: String?,
    @SerialName("set_number") val setNumber: String,
    @SerialName("name") val name: String?,
    @SerialName("attempts") val attempts: Int,
    @SerialName("retry_after") val retryAfter: String?,
    @SerialName("last_error") val lastError: String?,
)

@Serializable
data class BricksetQueueResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("total") val total: Int,
    @SerialName("page") val page: Int,
    @SerialName("page_size") val pageSize: Int,
    @SerialName("count") val count: Int,
    @SerialName("entries") val entries: List<BricksetQueueEntry>,
)

@Serializable
data class CacheStatsResponse(
    @SerialName("db_pool") val dbPool: JsonObject,
    @SerialName("success") val success: Boolean,
    @SerialName("prices") val prices: Int,
    @SerialName("subsets") val subsets: Int,
    @SerialName("catalog") val catalog: Int,
    @SerialName("price_stale") val priceStale: Int,
    @SerialName("rate_limits") val rateLimits: RateLimits?,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
)

@Serializable
data class CacheTtlResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("ttl") val ttl: String,
)

@Serializable
data class CsvImportStatus(
    @SerialName("code") val code: String? = null,
    @SerialName("results") val results: List<CsvImportRow> = emptyList(),
    @SerialName("success") val success: Boolean,
    @SerialName("status") val status: RunStatus = RunStatus.UNKNOWN,
    @SerialName("total") val total: Int = 0,
    @SerialName("done") val done: Int = 0,
    @SerialName("current") val current: String? = null,
    @SerialName("ok") val ok: Int = 0,
    @SerialName("warn") val warn: Int = 0,
    @SerialName("err") val err: Int = 0,
    @SerialName("error") val error: String?,
    @SerialName("finished_at") val finishedAt: String = "",
)

@Serializable
class Diagnosis

@Serializable
data class Endpoints(
    @SerialName("auth") val auth: JsonObject = JsonObject(emptyMap()),
    @SerialName("api") val api: String,
    @SerialName("version") val version: String,
    @SerialName("endpoints") val endpoints: JsonObject,
)

@Serializable
data class ImageDiagnosis(
    @SerialName("success") val success: Boolean,
    @SerialName("set_number") val setNumber: String,
    @SerialName("hints") val hints: List<String>,
    @SerialName("database") val database: ImageDiagnosisDatabase,
    @SerialName("local") val local: ImageDiagnosisLocal,
    @SerialName("proxy") val proxy: ImageDiagnosisProxy,
    @SerialName("marker") val marker: ImageDiagnosisMarker?,
)

@Serializable
data class ImageDiagnosisDatabase(
    @SerialName("account_count") val accountCount: Int,
    @SerialName("image_local") val imageLocal: String?,
    @SerialName("image_url") val imageUrl: String?,
    @SerialName("catalog_image") val catalogImage: String?,
)

@Serializable
data class ImageDiagnosisLocal(
    @SerialName("original") val original: ImageDiagnosisLocalOriginal,
    @SerialName("preview") val preview: ImageDiagnosisLocalPreview,
)

@Serializable
data class ImageDiagnosisLocalOriginal(
    @SerialName("existing") val existing: Boolean,
    @SerialName("bytes") val bytes: Int,
    @SerialName("changed") val changed: String? = null,
)

@Serializable
data class ImageDiagnosisLocalPreview(
    @SerialName("existing") val existing: Boolean,
    @SerialName("bytes") val bytes: Int,
    @SerialName("changed") val changed: String? = null,
)

@Serializable
data class ImageDiagnosisMarker(
    @SerialName("since") val since: String?,
    @SerialName("reason") val reason: String?,
)

@Serializable
data class ImageDiagnosisProxy(
    @SerialName("cached") val cached: Boolean,
    @SerialName("address") val address: String? = null,
)

@Serializable
data class ImageMarkerForgotten(
    @SerialName("success") val success: Boolean,
    @SerialName("removed") val removed: Int,
    @SerialName("hint") val hint: String,
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
    @SerialName("waiting") val waiting: Boolean,
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
    @SerialName("type") val type: String,
    @SerialName("time") val time: String? = null,
    @SerialName("minutes") val minutes: Int? = null,
)

@Serializable
data class JobStatus(
    @SerialName("lastRun") val lastRun: JsonElement? = null,
    @SerialName("canRedownload") val canRedownload: Boolean = false,
    @SerialName("queue") val queue: Int? = null,
    @SerialName("queueLastRun") val queueLastRun: JsonElement? = null,
    @SerialName("label") val label: String,
    @SerialName("status") val status: RunStatus,
    @SerialName("progress") val progress: Int,
    @SerialName("total") val total: Int,
    @SerialName("sub") val sub: String? = null,
    @SerialName("sub_parts") val subParts: List<JobStatusSubPartsEntry> = emptyList(),
)

@Serializable
data class JobStatusSubPartsEntry(
    @SerialName("code") val code: String,
    @SerialName("values") val values: JsonObject = JsonObject(emptyMap()),
    @SerialName("ago") val ago: String = "",
)

@Serializable
data class JobsResponse(
    @SerialName("db") val db: JsonObject,
    @SerialName("success") val success: Boolean,
    @SerialName("jobs") val jobs: Map<String, JobStatus>,
    @SerialName("schedules") val schedules: Map<String, JobSchedule>,
    @SerialName("degraded") val degraded: List<String> = emptyList(),
    @SerialName("proxy_hint") val proxyHint: JobsResponseProxyHint? = null,
)

@Serializable
data class JobsResponseProxyHint(
    @SerialName("kind") val kind: String,
    @SerialName("vars") val vars: JobsResponseProxyHintVars,
)

@Serializable
data class JobsResponseProxyHintVars(
    @SerialName("ip") val ip: String,
    @SerialName("minutes") val minutes: Int = 0,
    @SerialName("count") val count: Int = 0,
)

@Serializable
data class LogEntries(
    @SerialName("success") val success: Boolean,
    @SerialName("entries") val entries: List<JsonObject>,
)

@Serializable
data class LogResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("minutes") val minutes: Int,
    @SerialName("count") val count: Int,
    @SerialName("logs") val logs: List<LogRow>,
)

@Serializable
data class LogRow(
    @SerialName("id") val id: Int? = null,
    @SerialName("level") val level: String? = null,
    @SerialName("message") val message: String? = null,
    @SerialName("logged_at") val loggedAt: String? = null,
)

@Serializable
data class PriceJobState(
    @SerialName("success") val success: Boolean,
    @SerialName("job") val job: PriceJobStateJob,
    @SerialName("rate_limit") val rateLimit: PriceJobStateRateLimit,
)

@Serializable
data class PriceJobStateJob(
    @SerialName("running") val running: Boolean,
    @SerialName("lastRun") val lastRun: String?,
    @SerialName("nextRun") val nextRun: String?,
    @SerialName("lastErrors") val lastErrors: Int,
    @SerialName("log") val log: List<JsonElement?>,
    @SerialName("lastDuration") val lastDuration: Double? = null,
    @SerialName("lastUpdated") val lastUpdated: Double? = null,
    @SerialName("progress") val progress: PriceJobStateJobProgress? = null,
)

@Serializable
data class PriceJobStateJobProgress(
    @SerialName("current") val current: JsonElement?,
    @SerialName("total") val total: JsonElement?,
    @SerialName("set") val set: JsonElement?,
)

@Serializable
data class PriceJobStateRateLimit(
    @SerialName("count") val count: Int,
    @SerialName("limit") val limit: Int,
    @SerialName("remaining") val remaining: Int,
    @SerialName("date") val date: String? = null,
)

@Serializable
data class RateLimit(
    @SerialName("date") val date: String? = null,
    @SerialName("count") val count: Int,
    @SerialName("limit") val limit: Int,
    @SerialName("remaining") val remaining: Int,
)

@Serializable
data class RateLimits(
    @SerialName("bricklink") val bricklink: RateLimit,
    @SerialName("rebrickable") val rebrickable: RateLimit,
    @SerialName("brickset") val brickset: RateLimit,
)
