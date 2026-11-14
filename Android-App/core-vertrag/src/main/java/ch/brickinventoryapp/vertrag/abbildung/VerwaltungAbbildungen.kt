package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.ApiLimits
import ch.brickinventoryapp.vertrag.BricksetQueueEntry
import ch.brickinventoryapp.vertrag.CacheStatsResponse
import ch.brickinventoryapp.vertrag.JobSchedule
import ch.brickinventoryapp.vertrag.JobStatus
import ch.brickinventoryapp.vertrag.RateLimit
import ch.brickinventoryapp.vertrag.RateLimits
import ch.brickinventoryapp.model.ui.model.ApiGrenzenAnsicht
import ch.brickinventoryapp.model.ui.model.BricksetEintragAnsicht
import ch.brickinventoryapp.model.ui.model.CacheKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.JobZustandAnsicht
import ch.brickinventoryapp.model.ui.model.KontingentAnsicht
import ch.brickinventoryapp.model.ui.model.KontingenteAnsicht
import ch.brickinventoryapp.model.ui.model.ZeitplanAnsicht

fun JobStatus.alsAnsicht() = JobZustandAnsicht(
    label = label,
    status = status,
    progress = progress,
    total = total,
    sub = sub,
)

fun JobSchedule.alsAnsicht() = ZeitplanAnsicht(
    type = type,
    time = time,
    minutes = minutes,
)

fun BricksetQueueEntry.alsAnsicht() = BricksetEintragAnsicht(
    setNumber = setNumber,
    name = name,
    attempts = attempts,
    retryAfter = retryAfter,
    lastError = lastError,
)

fun CacheStatsResponse.alsAnsicht() = CacheKennzahlenAnsicht(
    prices = prices,
    subsets = subsets,
    catalog = catalog,
    priceStale = priceStale,
    rateLimits = rateLimits?.alsAnsicht(),
)

fun RateLimits.alsAnsicht() = KontingenteAnsicht(
    bricklink = bricklink.alsAnsicht(),
    rebrickable = rebrickable.alsAnsicht(),
    brickset = brickset.alsAnsicht(),
)

fun RateLimit.alsAnsicht() = KontingentAnsicht(
    count = count,
    limit = limit,
    remaining = remaining,
)

fun ApiLimits.alsAnsicht() = ApiGrenzenAnsicht(
    rebrickable = rebrickable,
    bricklink = bricklink,
    brickset = brickset,
)
