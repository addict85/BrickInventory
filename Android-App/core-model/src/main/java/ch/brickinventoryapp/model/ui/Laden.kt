package ch.brickinventoryapp.model.ui

/**
 * Der Zustand eines Abrufs für die Oberfläche, eine Form für alle Bildschirme statt
 * je eines Paars `laedt`/`fehler`: Laden, Daten und Fehler schliessen einander aus,
 * und ein `when` darüber muss jeden Fall nennen.
 */
sealed interface Laden<out T> {
    data object Laedt : Laden<Nothing>

    /** [stand]: Zeitpunkt der Ablage, wenn die Daten offline aus ihr kommen; null heisst frisch. */
    data class Daten<out T>(val wert: T, val stand: Long? = null) : Laden<T> {
        val offline: Boolean get() = stand != null
    }

    /** Keine Daten: [art] wählt Symbol und Rat, [meldung] ist der Satz dazu. */
    data class Fehler(val art: Fehlerklasse, val meldung: Meldung) : Laden<Nothing>
}

val Laden<*>.laedt: Boolean get() = this is Laden.Laedt

val Laden<*>.fehlerMeldung: Meldung? get() = (this as? Laden.Fehler)?.meldung

val Laden<*>.fehlerArt: Fehlerklasse? get() = (this as? Laden.Fehler)?.art

/** Die Daten, solange es welche gibt; beim Laden und nach einem Fehler null. */
fun <T> Laden<T>.datenOderNull(): T? = (this as? Laden.Daten<T>)?.wert
