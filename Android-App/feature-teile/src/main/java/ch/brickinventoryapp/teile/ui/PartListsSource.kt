package ch.brickinventoryapp.teile.ui

/** Woher die Bauliste ihre Zeilen holt; im ViewModel-Test ein Double ohne Netz. */
interface PartListsSource {
    suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>>
    suspend fun withInventory(teile: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean): List<PlPart>?
    /** Wie Webapp und PDF: nach Farbe, darin nach Teilenummer (BrickLink-Nummer, wo es sie gibt). */
    fun sortiert(teile: Collection<PlPart>): List<PlPart>
}
