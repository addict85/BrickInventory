package ch.brickinventoryapp.data

import kotlinx.coroutines.flow.Flow

/**
 * Was das AppViewModel von der Ablage braucht: Adresse, Token und die Werte des
 * Kontos, die es spiegelt. Im Gerät die KontoAblage; die Schnittstelle
 * lässt das AppViewModel ohne DataStore und Context laufen.
 */
interface Sitzungsablage {
    val serverUrl: Flow<String>
    val authToken: Flow<String>
    val appTheme: Flow<String>
    val currency: Flow<String>
    val language: Flow<String>
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String

    /** Älter, als der Server eine Anmeldung gelten lässt: dann abmelden statt laden. */
    suspend fun anmeldungAbgelaufen(jetzt: Long = System.currentTimeMillis()): Boolean
    suspend fun saveAppTheme(theme: String)
    suspend fun saveCurrency(cur: String)

    /** Server, an denen eine nachgeholte Abmeldung endgültig scheiterte. */
    fun gescheiterteEntwertungen(): Set<String>
    fun quittiereGescheiterteEntwertungen()
}
