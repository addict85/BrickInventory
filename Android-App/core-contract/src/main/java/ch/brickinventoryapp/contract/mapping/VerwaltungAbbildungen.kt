package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.ApiLimits
import ch.brickinventoryapp.contract.BricksetQueueEntry
import ch.brickinventoryapp.contract.CacheStatsResponse
import ch.brickinventoryapp.contract.JobSchedule
import ch.brickinventoryapp.contract.JobStatus
import ch.brickinventoryapp.contract.RateLimit
import ch.brickinventoryapp.contract.RateLimits
import ch.brickinventoryapp.model.domain.ApiLimitsView
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.CacheMetricsView
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.QuotaView
import ch.brickinventoryapp.model.domain.QuotasView
import ch.brickinventoryapp.model.domain.ScheduleView

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
