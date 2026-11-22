package ch.brickinventoryapp.update.util

/**
 * What the app knows from earlier checks: the highest versionCode seen and
 * the latest issue time (seconds since 1970, UTC) of a current
 * description.
 */
data class UpdateStatus(val highestCode: Int, val issued: Long)

/** Where [UpdateStatus] lives: on the device the DataStore (UpdateStore), in a test a variable. */
interface UpdateStatusStore {
    suspend fun updateStatus(): UpdateStatus?
    suspend fun rememberUpdateStatus(state: UpdateStatus)

    /** Check silently with GitHub on start? Per device, default on; GitHub sees the IP while doing so. */
    fun startCheckEnabled(): Boolean = true
    fun setStartCheck(an: Boolean) = Unit
}

/** How fresh a signed description is ([valueFresh]). */
enum class UpdateFresh {
    CURRENT,
    /** Without a deadline, or past `validUntil`: no one has signed again since. */
    EXPIRED,
    /** Older than an already-seen description or than the installed version. */
    RESET,
}

/** Is there anything to report? Not before the first check (null). */
fun sourceStale(freshness: UpdateFresh?): Boolean = freshness != null && freshness != UpdateFresh.CURRENT

/**
 * A rolled-back description offers nothing; it would hold on a vulnerable
 * intermediate version. An expired one does: it is genuinely signed and newer than
 * anything known; with no offer, the device would, after seven days, remain stuck on
 * the old version with no label. [sourceStale] gives the hint that something newer might exist.
 */
fun offerableVersion(b: UpdateDescription, freshness: UpdateFresh, running: Int): UpdateDescription? =
    b.takeIf { freshness != UpdateFresh.RESET && isNew(running, it.versionCode) }

/**
 * A genuinely signed but old description silently withholds updates: its
 * signature is valid, it just doesn't report anything new. That's why, besides the
 * signature, the deadline counts, and no description may fall behind what the app
 * already knows.
 */
internal fun valueFresh(b: UpdateDescription, seen: UpdateStatus?, running: Int, nowSec: Long): UpdateFresh = when {
    b.versionCode < running -> UpdateFresh.RESET
    seen != null && (b.versionCode < seen.highestCode || b.issued < seen.issued) ->
        UpdateFresh.RESET
    b.issued <= 0 || b.validUntil <= b.issued || b.validUntil <= nowSec -> UpdateFresh.EXPIRED
    else -> UpdateFresh.CURRENT
}

/**
 * Evaluates [b] and only advances the stored state after a current description:
 * an expired or older one must not move the benchmark.
 */
suspend fun checkFresh(store: UpdateStatusStore, b: UpdateDescription, running: Int, nowSec: Long): UpdateFresh {
    val seen = store.updateStatus()
    val freshness = valueFresh(b, seen, running, nowSec)
    if (freshness == UpdateFresh.CURRENT) {
        store.rememberUpdateStatus(UpdateStatus(
            maxOf(seen?.highestCode ?: 0, b.versionCode),
            maxOf(seen?.issued ?: 0L, b.issued)))
    }
    return freshness
}
