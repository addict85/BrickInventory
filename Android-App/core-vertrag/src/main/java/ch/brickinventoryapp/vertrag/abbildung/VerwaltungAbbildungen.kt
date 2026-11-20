package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.ApiLimits
import ch.brickinventoryapp.vertrag.BricksetQueueEntry
import ch.brickinventoryapp.vertrag.CacheStatsResponse
import ch.brickinventoryapp.vertrag.JobSchedule
import ch.brickinventoryapp.vertrag.JobStatus
import ch.brickinventoryapp.vertrag.RateLimit
import ch.brickinventoryapp.vertrag.RateLimits
import ch.brickinventoryapp.model.fach.ApiLimitsView
import ch.brickinventoryapp.model.fach.BricksetEntryView
import ch.brickinventoryapp.model.fach.CacheMetricsView
import ch.brickinventoryapp.model.fach.JobStateView
import ch.brickinventoryapp.model.fach.QuotaView
import ch.brickinventoryapp.model.fach.QuotasView
import ch.brickinventoryapp.model.fach.ScheduleView

fun JobStatus.alsAnsicht() = JobStateView(
    label = label,
    status = status,
    progress = progress,
    total = total,
    sub = sub,
)

fun JobSchedule.alsAnsicht() = ScheduleView(
    type = type,
    time = time,
    minutes = minutes,
)

fun BricksetQueueEntry.alsAnsicht() = BricksetEntryView(
    setNumber = setNumber,
    name = name,
    attempts = attempts,
    retryAfter = retryAfter,
    lastError = lastError,
)

fun CacheStatsResponse.alsAnsicht() = CacheMetricsView(
    prices = prices,
    subsets = subsets,
    catalog = catalog,
    priceStale = priceStale,
    rateLimits = rateLimits?.alsAnsicht(),
)

fun RateLimits.alsAnsicht() = QuotasView(
    bricklink = bricklink.alsAnsicht(),
    rebrickable = rebrickable.alsAnsicht(),
    brickset = brickset.alsAnsicht(),
)

fun RateLimit.alsAnsicht() = QuotaView(
    count = count,
    limit = limit,
    remaining = remaining,
)

fun ApiLimits.alsAnsicht() = ApiLimitsView(
    rebrickable = rebrickable,
    bricklink = bricklink,
    brickset = brickset,
)
