package ch.brickinventoryapp.teile.ui

/** Woher die Bauliste ihre Zeilen holt; im ViewModel-Test ein Double ohne Netz. */
interface TeilelistenQuelle {
    suspend fun loeseSetAuf(setNumber: String, serverUrl: String): Pair<String, List<PlPart>>
    suspend fun mitBestand(teile: List<PlPart>, nurLose: Boolean, mitUnterkonten: Boolean): List<PlPart>?
    /** Wie Webapp und PDF: nach Farbe, darin nach Teilenummer (BrickLink-Nummer, wo es sie gibt). */
    fun sortiert(teile: Collection<PlPart>): List<PlPart>
}
