package ch.brickinventoryapp.model.ui

/**
 * Eine Handlung des Nutzers (Speichern, Senden, Exportieren) in einer Form statt eines
 * Paars `laeuft`/`fehler`: Sie läuft, ist fertig oder mit einem Grund gescheitert, nie
 * zwei davon zugleich. Was Daten liefert, trägt [Laden].
 */
sealed interface Vorgang {
    data object Fertig : Vorgang
    data object Laeuft : Vorgang
    data class Fehlgeschlagen(val meldung: Meldung) : Vorgang
}

val Vorgang.laeuft: Boolean get() = this is Vorgang.Laeuft

val Vorgang.fehlerMeldung: Meldung? get() = (this as? Vorgang.Fehlgeschlagen)?.meldung

/** Den Grund wegnehmen, wenn ihn niemand mehr sehen soll; ein laufender Vorgang läuft weiter. */
fun Vorgang.ohneFehler(): Vorgang = if (this is Vorgang.Fehlgeschlagen) Vorgang.Fertig else this

/** Ein beendeter Vorgang: mit Grund gescheitert, ohne fertig. */
fun beendet(fehler: Meldung?): Vorgang = fehler?.let(Vorgang::Fehlgeschlagen) ?: Vorgang.Fertig
