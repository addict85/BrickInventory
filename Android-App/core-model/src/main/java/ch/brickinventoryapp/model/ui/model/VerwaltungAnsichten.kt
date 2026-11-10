package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.data.model.ApiLimits
import ch.brickinventoryapp.model.data.model.BricksetQueueEntry
import ch.brickinventoryapp.model.data.model.CacheStatsResponse
import ch.brickinventoryapp.model.data.model.JobSchedule
import ch.brickinventoryapp.model.data.model.JobStatus
import ch.brickinventoryapp.model.data.model.RateLimit
import ch.brickinventoryapp.model.data.model.RateLimits

// Jobs, Brickset-Warteschlange, Zwischenspeicher und Kontingente im Monitoring.

data class JobZustandAnsicht(
    val label: String = "",
    val status: Laufstatus = Laufstatus.RUHT,
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null,
)

fun JobStatus.alsAnsicht() = JobZustandAnsicht(
    label = label,
    status = status,
    progress = progress,
    total = total,
    sub = sub,
)

data class ZeitplanAnsicht(
    val type: String = "daily",
    val time: String? = null,
    val minutes: Int? = null,
)

fun JobSchedule.alsAnsicht() = ZeitplanAnsicht(
    type = type,
    time = time,
    minutes = minutes,
)

data class BricksetEintragAnsicht(
    val setNumber: String,
    val name: String? = null,
    val attempts: Int = 0,
    val retryAfter: String? = null,
    val lastError: String? = null,
)

fun BricksetQueueEntry.alsAnsicht() = BricksetEintragAnsicht(
    setNumber = setNumber,
    name = name,
    attempts = attempts,
    retryAfter = retryAfter,
    lastError = lastError,
)

data class CacheKennzahlenAnsicht(
    val prices: Int = 0,
    val subsets: Int = 0,
    val catalog: Int = 0,
    val priceStale: Int = 0,
    val rateLimits: KontingenteAnsicht? = null,
)

fun CacheStatsResponse.alsAnsicht() = CacheKennzahlenAnsicht(
    prices = prices,
    subsets = subsets,
    catalog = catalog,
    priceStale = priceStale,
    rateLimits = rateLimits?.alsAnsicht(),
)

data class KontingenteAnsicht(
    val bricklink: KontingentAnsicht = KontingentAnsicht(),
    val rebrickable: KontingentAnsicht = KontingentAnsicht(),
    val brickset: KontingentAnsicht = KontingentAnsicht(),
)

fun RateLimits.alsAnsicht() = KontingenteAnsicht(
    bricklink = bricklink.alsAnsicht(),
    rebrickable = rebrickable.alsAnsicht(),
    brickset = brickset.alsAnsicht(),
)

data class KontingentAnsicht(
    val count: Int = 0,
    val limit: Int = 0,
    val remaining: Int = 0,
)

fun RateLimit.alsAnsicht() = KontingentAnsicht(
    count = count,
    limit = limit,
    remaining = remaining,
)

data class ApiGrenzenAnsicht(
    val rebrickable: Int = 0,
    val bricklink: Int = 0,
    val brickset: Int = 0,
)

fun ApiLimits.alsAnsicht() = ApiGrenzenAnsicht(
    rebrickable = rebrickable,
    bricklink = bricklink,
    brickset = brickset,
)
