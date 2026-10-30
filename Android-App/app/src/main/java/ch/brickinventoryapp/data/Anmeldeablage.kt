package ch.brickinventoryapp.data

/**
 * Was die Anmeldung im Gerät ablegt: Serveradresse, Token, Benutzername, die
 * bestätigten Klartext-Server und die Netze, in denen eine Klartext-Anmeldung
 * eingerichtet oder bestätigt wurde. Im Gerät der [PreferencesManager]; die
 * Schnittstelle lässt die Anmeldung ohne DataStore prüfen.
 */
interface Anmeldeablage {
    suspend fun serverUrlJetzt(): String
    /** Eine Adresse mit anderer Herkunft verwirft den Token (er gehört dem alten Server). */
    suspend fun saveServerUrl(url: String)
    suspend fun saveAuthToken(token: String)
    suspend fun saveUsername(name: String)
    suspend fun bestaetigeKlartext(host: String)
    suspend fun bekannteNetze(): Set<String>
    suspend fun merkeNetz(eintrag: String)
}

/**
 * Kennung des Netzes, in dem das Gerät gerade hängt — über Verbindungen hinweg
 * gleich, anders als die Nummer des aktiven Netzes. null, wenn sie sich nicht
 * bestimmen lässt.
 */
fun interface Netzkennung {
    fun fingerabdruck(): String?
}
