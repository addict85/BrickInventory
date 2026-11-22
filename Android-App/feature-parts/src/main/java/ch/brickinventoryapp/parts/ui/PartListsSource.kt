package ch.brickinventoryapp.parts.ui

/** Where the parts list gets its rows from; a double without network in the ViewModel test. */
interface PartListsSource {
    suspend fun resolveSetOn(setNumber: String, serverUrl: String): Pair<String, List<PlPart>>
    suspend fun withInventory(parts: List<PlPart>, onlyLose: Boolean, withSubAccounts: Boolean): List<PlPart>?
    /** As in the web app and PDF: by color, then by part number (BrickLink number, where there is one). */
    fun sorted(parts: Collection<PlPart>): List<PlPart>
}
