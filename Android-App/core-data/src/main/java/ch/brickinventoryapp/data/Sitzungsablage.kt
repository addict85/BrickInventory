package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.flow.Flow

/**
 * Was das AppViewModel von der Ablage braucht: Adresse, Token und die Werte des
 * Kontos, die es spiegelt. Im Gerät die KontoAblage; die Schnittstelle
 * lässt das AppViewModel ohne DataStore und Context laufen.
 */
interface Sitzungsablage {
    val serverUrl: Flow<String>
    val authToken: Flow<String>
    val appTheme: Flow<Design>
    val currency: Flow<Waehrung>
    val language: Flow<String>
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String

    /** Älter, als der Server eine Anmeldung gelten lässt: dann abmelden statt laden. */
    suspend fun anmeldungAbgelaufen(jetzt: Long = System.currentTimeMillis()): Boolean
    suspend fun saveAppTheme(theme: Design)
    suspend fun saveCurrency(cur: Waehrung)

    /** Server, an denen eine nachgeholte Abmeldung endgültig scheiterte. */
    fun gescheiterteEntwertungen(): Set<String>
    fun quittiereGescheiterteEntwertungen()
}
