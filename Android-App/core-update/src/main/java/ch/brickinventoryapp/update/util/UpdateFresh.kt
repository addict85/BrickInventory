package ch.brickinventoryapp.update.util

/**
 * Was die App aus früheren Prüfungen weiss: der höchste gesehene versionCode und
 * der späteste Ausstellungszeitpunkt (Sekunden seit 1970, UTC) einer aktuellen
 * Beschreibung.
 */
data class UpdateStatus(val highestCode: Int, val ausgestellt: Long)

/** Wo der [UpdateStatus] liegt: im Gerät der DataStore (UpdateStore), im Test eine Variable. */
interface UpdateStatusStore {
    suspend fun updateStatus(): UpdateStatus?
    suspend fun rememberUpdateStatus(stand: UpdateStatus)

    /** Beim Start still bei GitHub nachsehen? Je Gerät, Vorgabe an; GitHub sieht dabei die IP. */
    fun startpruefungAn(): Boolean = true
    fun setStartpruefung(an: Boolean) = Unit
}

/** Wie frisch eine signierte Beschreibung ist ([valueFresh]). */
enum class UpdateFresh {
    AKTUELL,
    /** Ohne Frist oder nach `gueltigBis`: Seither hat niemand neu signiert. */
    ABGELAUFEN,
    /** Älter als eine schon gesehene Beschreibung oder als die installierte Fassung. */
    ZURUECKGESETZT,
}

/** Gibt es etwas zu melden? Vor der ersten Prüfung (null) nicht. */
fun sourceStale(frische: UpdateFresh?): Boolean = frische != null && frische != UpdateFresh.AKTUELL

/**
 * Eine zurückgesetzte Beschreibung bietet nichts an, sie hielte auf einer verwundbaren
 * Zwischenfassung fest. Eine abgelaufene schon: Sie ist echt signiert und neuer als alles
 * Bekannte; ohne Angebot bliebe das Gerät nach sieben Tagen ohne Etikett auf der alten
 * Fassung stehen. Den Hinweis, dass es Neueres geben könnte, gibt [sourceStale].
 */
fun offerableVersion(b: UpdateBeschreibung, frische: UpdateFresh, laufend: Int): UpdateBeschreibung? =
    b.takeIf { frische != UpdateFresh.ZURUECKGESETZT && isNew(laufend, it.versionCode) }

/**
 * Eine echt signierte, aber alte Beschreibung hält Updates still zurück: Ihre
 * Signatur gilt, sie meldet nur nichts Neues. Darum zählt neben der Signatur die
 * Frist, und keine Beschreibung darf hinter das zurückfallen, was die App schon kennt.
 */
internal fun valueFresh(b: UpdateBeschreibung, gesehen: UpdateStatus?, laufend: Int, nowSec: Long): UpdateFresh = when {
    b.versionCode < laufend -> UpdateFresh.ZURUECKGESETZT
    gesehen != null && (b.versionCode < gesehen.highestCode || b.ausgestellt < gesehen.ausgestellt) ->
        UpdateFresh.ZURUECKGESETZT
    b.ausgestellt <= 0 || b.gueltigBis <= b.ausgestellt || b.gueltigBis <= nowSec -> UpdateFresh.ABGELAUFEN
    else -> UpdateFresh.AKTUELL
}

/**
 * Bewertet [b] und schreibt den Stand nur nach einer aktuellen Beschreibung fort:
 * Eine abgelaufene oder ältere darf die Messlatte nicht verschieben.
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
