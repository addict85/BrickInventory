package ch.brickinventoryapp.model.domain

// Jobs, Brickset-Warteschlange, Zwischenspeicher und Kontingente im Monitoring.

data class JobStateView(
    val label: String = "",
    val status: Laufstatus = Laufstatus.RUHT,
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null,
)

/** Die Jobs des Servers und ihr Zeitplan, aus einer Antwort. */
data class JobsView(
    val jobs: Map<String, JobStateView> = emptyMap(),
    val schedules: Map<String, ScheduleView> = emptyMap(),
)

data class ScheduleView(
    val type: String = "daily",
    val time: String? = null,
    val minutes: Int? = null,
)

data class BricksetEntryView(
    val setNumber: String,
    val name: String? = null,
    val attempts: Int = 0,
    val retryAfter: String? = null,
    val lastError: String? = null,
)

data class CacheMetricsView(
    val prices: Int = 0,
    val subsets: Int = 0,
    val catalog: Int = 0,
    val priceStale: Int = 0,
    val rateLimits: QuotasView? = null,
)

data class QuotasView(
    val bricklink: QuotaView = QuotaView(),
    val rebrickable: QuotaView = QuotaView(),
    val brickset: QuotaView = QuotaView(),
)

data class QuotaView(
    val count: Int = 0,
    val limit: Int = 0,
    val remaining: Int = 0,
)

data class ApiLimitsView(
    val rebrickable: Int = 0,
    val bricklink: Int = 0,
    val brickset: Int = 0,
)
