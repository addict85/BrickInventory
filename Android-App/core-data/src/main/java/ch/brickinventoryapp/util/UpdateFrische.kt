package ch.brickinventoryapp.util

/**
 * Was die App aus früheren Prüfungen weiss: der höchste gesehene versionCode und
 * der späteste Ausstellungszeitpunkt (Sekunden seit 1970, UTC) einer aktuellen
 * Beschreibung.
 */
data class UpdateStand(val hoechsterCode: Int, val ausgestellt: Long)

/** Wo der [UpdateStand] liegt: im Gerät der DataStore (UpdateAblage), im Test eine Variable. */
interface UpdateStandAblage {
    suspend fun updateStand(): UpdateStand?
    suspend fun merkeUpdateStand(stand: UpdateStand)

    /** Beim Start still bei GitHub nachsehen? Je Gerät, Vorgabe an; GitHub sieht dabei die IP. */
    fun startpruefungAn(): Boolean = true
    fun setzeStartpruefung(an: Boolean) = Unit
}

/** Wie frisch eine signierte Beschreibung ist ([bewerteFrische]). */
enum class UpdateFrische {
    AKTUELL,
    /** Ohne Frist oder nach `gueltigBis`: Seither hat niemand neu signiert. */
    ABGELAUFEN,
    /** Älter als eine schon gesehene Beschreibung oder als die installierte Fassung. */
    ZURUECKGESETZT,
}

/** Gibt es etwas zu melden? Vor der ersten Prüfung (null) nicht. */
fun quelleVeraltet(frische: UpdateFrische?): Boolean = frische != null && frische != UpdateFrische.AKTUELL

/**
 * Angeboten wird nur eine neuere Fassung aus einer aktuellen Beschreibung. Eine ältere,
 * echt signierte hielte den Nutzer sonst auf einer bekannt verwundbaren Zwischenfassung
 * fest; statt des Angebots steht dann der Hinweis aus [quelleVeraltet] da.
 */
fun anzubietendeFassung(b: UpdateBeschreibung, frische: UpdateFrische, laufend: Int): UpdateBeschreibung? =
    b.takeIf { frische == UpdateFrische.AKTUELL && istNeuer(laufend, it.versionCode) }

/**
 * Eine echt signierte, aber alte Beschreibung hält Updates still zurück: Ihre
 * Signatur gilt, sie meldet nur nichts Neues. Darum zählt neben der Signatur die
 * Frist, und keine Beschreibung darf hinter das zurückfallen, was die App schon kennt.
 */
internal fun bewerteFrische(b: UpdateBeschreibung, gesehen: UpdateStand?, laufend: Int, jetztSek: Long): UpdateFrische = when {
    b.versionCode < laufend -> UpdateFrische.ZURUECKGESETZT
    gesehen != null && (b.versionCode < gesehen.hoechsterCode || b.ausgestellt < gesehen.ausgestellt) ->
        UpdateFrische.ZURUECKGESETZT
    b.ausgestellt <= 0 || b.gueltigBis <= b.ausgestellt || b.gueltigBis <= jetztSek -> UpdateFrische.ABGELAUFEN
    else -> UpdateFrische.AKTUELL
}

/**
 * Bewertet [b] und schreibt den Stand nur nach einer aktuellen Beschreibung fort:
 * Eine abgelaufene oder ältere darf die Messlatte nicht verschieben.
 */
suspend fun pruefeFrische(ablage: UpdateStandAblage, b: UpdateBeschreibung, laufend: Int, jetztSek: Long): UpdateFrische {
    val gesehen = ablage.updateStand()
    val frische = bewerteFrische(b, gesehen, laufend, jetztSek)
    if (frische == UpdateFrische.AKTUELL) {
        ablage.merkeUpdateStand(UpdateStand(
            maxOf(gesehen?.hoechsterCode ?: 0, b.versionCode),
            maxOf(gesehen?.ausgestellt ?: 0L, b.ausgestellt)))
    }
    return frische
}
