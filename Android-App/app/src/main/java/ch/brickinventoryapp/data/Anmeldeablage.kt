package ch.brickinventoryapp.data

/**
 * Was die Anmeldung im Gerät ablegt: Serveradresse, Token, Benutzername und
 * die bestätigten Klartext-Server. Im Gerät der [PreferencesManager]; die
 * Schnittstelle lässt die Anmeldung ohne DataStore prüfen.
 */
interface Anmeldeablage {
    suspend fun serverUrlJetzt(): String
    suspend fun saveServerUrl(url: String)
    suspend fun saveAuthToken(token: String)
    suspend fun saveUsername(name: String)
    suspend fun bestaetigeKlartext(host: String)
}
