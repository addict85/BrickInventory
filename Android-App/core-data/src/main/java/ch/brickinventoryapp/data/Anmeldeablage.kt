package ch.brickinventoryapp.data

/**
 * Was die Anmeldung im Gerät ablegt: Serveradresse, Token, Benutzername und den
 * Pin aus dem QR-Code. Im Gerät der [PreferencesManager]; die Schnittstelle lässt
 * die Anmeldung ohne DataStore prüfen.
 */
interface Anmeldeablage {
    suspend fun serverUrlJetzt(): String
    /** Eine Adresse mit anderer Herkunft verwirft den Token (er gehört dem alten Server). */
    suspend fun saveServerUrl(url: String)
    suspend fun saveAuthToken(token: String)
    suspend fun saveUsername(name: String)
    /** Pin aus dem QR-Code (util/ServerVertrauen.kt), vor dem ersten Kontakt. */
    fun merkePin(schluessel: String, fingerabdruck: String)
}
