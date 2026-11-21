package ch.brickinventoryapp.update.util

/**
 * What the app knows from earlier checks: the highest versionCode seen and
 * the latest issue time (seconds since 1970, UTC) of a current
 * description.
 */
data class UpdateStatus(val highestCode: Int, val ausgestellt: Long)

/** Where [UpdateStatus] lives: on the device the DataStore (UpdateStore), in a test a variable. */
interface UpdateStatusStore {
    suspend fun updateStatus(): UpdateStatus?
    suspend fun rememberUpdateStatus(stand: UpdateStatus)

    /** Check silently with GitHub on start? Per device, default on; GitHub sees the IP while doing so. */
    fun startpruefungAn(): Boolean = true
    fun setStartpruefung(an: Boolean) = Unit
}

/** How fresh a signed description is ([valueFresh]). */
enum class UpdateFresh {
    AKTUELL,
    /** Without a deadline, or past `gueltigBis`: no one has signed again since. */
    ABGELAUFEN,
    /** Older than an already-seen description or than the installed version. */
    ZURUECKGESETZT,
}

/** Is there anything to report? Not before the first check (null). */
fun sourceStale(frische: UpdateFresh?): Boolean = frische != null && frische != UpdateFresh.AKTUELL

/**
 * A rolled-back description offers nothing; it would hold on a vulnerable
 * intermediate version. An expired one does: it is genuinely signed and newer than
 * anything known; with no offer, the device would, after seven days, remain stuck on
 * the old version with no label. [sourceStale] gives the hint that something newer might exist.
 */
fun offerableVersion(b: UpdateBeschreibung, frische: UpdateFresh, laufend: Int): UpdateBeschreibung? =
    b.takeIf { frische != UpdateFresh.ZURUECKGESETZT && isNew(laufend, it.versionCode) }

/**
 * A genuinely signed but old description silently withholds updates: its
 * signature is valid, it just doesn't report anything new. That's why, besides the
 * signature, the deadline counts, and no description may fall behind what the app
 * already knows.
 */
internal fun valueFresh(b: UpdateBeschreibung, gesehen: UpdateStatus?, laufend: Int, nowSec: Long): UpdateFresh = when {
    b.versionCode < laufend -> UpdateFresh.ZURUECKGESETZT
    gesehen != null && (b.versionCode < gesehen.highestCode || b.ausgestellt < gesehen.ausgestellt) ->
        UpdateFresh.ZURUECKGESETZT
    b.ausgestellt <= 0 || b.gueltigBis <= b.ausgestellt || b.gueltigBis <= nowSec -> UpdateFresh.ABGELAUFEN
    else -> UpdateFresh.AKTUELL
}

/**
 * Evaluates [b] and only advances the stored state after a current description:
 * an expired or older one must not move the benchmark.
 */
suspend fun checkFresh(ablage: UpdateStatusStore, b: UpdateBeschreibung, laufend: Int, nowSec: Long): UpdateFresh {
    val gesehen = ablage.updateStatus()
    val frische = valueFresh(b, gesehen, laufend, nowSec)
    if (frische == UpdateFresh.AKTUELL) {
        ablage.rememberUpdateStatus(UpdateStatus(
            maxOf(gesehen?.highestCode ?: 0, b.versionCode),
            maxOf(gesehen?.ausgestellt ?: 0L, b.ausgestellt)))
    }
    return frische
}
