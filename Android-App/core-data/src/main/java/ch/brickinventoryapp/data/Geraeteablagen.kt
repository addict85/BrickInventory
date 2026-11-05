package ch.brickinventoryapp.data

import ch.brickinventoryapp.util.PinAblage
import kotlinx.coroutines.flow.StateFlow

/**
 * Wie die App auf diesem Gerät aussieht. Synchron, weil schon das erste Bild davon
 * abhängt; im Gerät der PreferencesManager, im Test eine Fassung im Speicher.
 */
interface Darstellungsablage {
    fun gemerktesDesign(): String
    fun helligkeit(): String
    fun setzeHelligkeit(wahl: String)
    fun systemfarben(): Boolean
    fun setzeSystemfarben(an: Boolean)
    fun vorschauVerbergen(): Boolean
    fun setzeVorschauVerbergen(an: Boolean)
    fun widgetWerteZeigen(): Boolean
    fun setzeWidgetWerteZeigen(an: Boolean)
    suspend fun saveLanguage(lang: String)
}

/** Wem die Clients des eigenen Servers vertrauen: gemerkte Pins und der Schalter für Nutzer-CAs. */
interface Vertrauensablage : PinAblage {
    fun nutzerCaErlaubt(): Boolean
    fun setzeNutzerCa(an: Boolean)
}

/**
 * Adresse und Token, wie sie jetzt gelten, für Abrufe am Retrofit-Client vorbei
 * (SSE, Statusabfrage). Gleich nach dem Anmelden steht der Token noch nicht auf
 * der Platte; darum nicht der Fluss, sondern der Speicherwert.
 */
interface Zugangsdaten {
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String
}

/** Offene Verbindungen trugen das alte Vertrauen; nach jeder Änderung werden sie verworfen. */
fun interface Verbindungsabwurf {
    fun verwirf()
}

/** Ob jetzt ein Token gilt, als Speicherwert: für Texte und für Zustände, die beim Abmelden verfallen. */
interface Anmeldestand {
    val authTokenState: StateFlow<String?>
}

/** Das Abmelden im Gerät: Token, Herkunft und Benutzername weg, unter der Sperre der Token-Schreibungen. */
interface Sitzungsende {
    suspend fun clearSession()
}
