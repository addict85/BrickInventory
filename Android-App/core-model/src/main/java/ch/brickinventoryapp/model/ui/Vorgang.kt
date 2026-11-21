package ch.brickinventoryapp.model.ui

/**
 * An action of the user (save, send, export) in one form instead of a
 * pair `laeuft`/`fehler`: it runs, is finished or failed with a reason, never
 * two of them at once. What delivers data is carried by [Laden].
 */
sealed interface Vorgang {
    data object Fertig : Vorgang
    data object Laeuft : Vorgang
    data class Fehlgeschlagen(val meldung: Meldung) : Vorgang
}

val Vorgang.laeuft: Boolean get() = this is Vorgang.Laeuft

val Vorgang.errorMessage: Meldung? get() = (this as? Vorgang.Fehlgeschlagen)?.meldung

/** Take away the reason when nobody shall see it any more; a running operation keeps running. */
fun Vorgang.withoutError(): Vorgang = if (this is Vorgang.Fehlgeschlagen) Vorgang.Fertig else this

/** A finished operation: failed with a reason, without finished. */
fun beendet(fehler: Meldung?): Vorgang = fehler?.let(Vorgang::Fehlgeschlagen) ?: Vorgang.Fertig
