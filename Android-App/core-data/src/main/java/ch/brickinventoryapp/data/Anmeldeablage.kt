package ch.brickinventoryapp.data

/**
 * Was die Anmeldung im Gerät ablegt: Serveradresse, Token, Benutzername und den
 * Pin aus dem QR-Code. Im Gerät die [KontoAblage]; die Schnittstelle lässt
 * die Anmeldung ohne DataStore prüfen.
 */
interface Anmeldeablage {
    suspend fun serverUrlJetzt(): String
    /** Eine Adresse mit anderer Herkunft verwirft den Token (er gehört dem alten Server). */
    suspend fun saveServerUrl(url: String)
    suspend fun saveAuthToken(token: String)
    suspend fun saveUsername(name: String)
    /** Dauerhaft (util/ServerVertrauen.kt); ersetzt einen vorgehaltenen. */
    fun merkePin(schluessel: String, fingerabdruck: String)
    /** Der dauerhaft gemerkte Pin, ohne einen gerade vorgehaltenen. */
    fun gemerkterPin(schluessel: String): String?
    /**
     * Pin aus einem QR-Code nur für den laufenden Verbindungsaufbau: Erst eine
     * gelungene Anmeldung zeigt, dass Code und Server zusammengehören.
     */
    fun halteVor(schluessel: String, fingerabdruck: String)
    fun vergissVorgehaltenen(schluessel: String)
}
