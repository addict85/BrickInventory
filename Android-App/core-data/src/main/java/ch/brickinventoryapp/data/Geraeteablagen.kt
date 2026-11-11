package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.sicherheit.PinAblage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Wie die App auf diesem Gerät aussieht. Synchron, weil schon das erste Bild davon
 * abhängt; im Gerät die GeraeteAblage, im Test eine Fassung im Speicher.
 */
interface Darstellungsablage {
    fun gemerktesDesign(): Design
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

/** Was die Server-Clients zusätzlich brauchen: Nach dem Umschalten der Nutzer-CAs gilt ein neuer TLS-Kontext. */
interface Netzvertrauen : Vertrauensablage {
    fun beimNutzerCaWechsel(hoerer: () -> Unit)
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

/**
 * Was der Netzweg synchron vom Token braucht: Speicherspiegel, Generation und den
 * Serverwechsel. Eine eigene Schnittstelle, damit di/ServerClient nur daran hängt.
 */
interface Tokenspiegel {
    val serverUrlState: StateFlow<String?>
    val authTokenState: StateFlow<String?>
    val tokenHerkunftState: StateFlow<String?>
    fun tokenGeneration(): Long
    fun warteAufStart()
    fun beimServerwechsel(hoerer: () -> Unit)
    suspend fun tokenStand(): TokenStand
    suspend fun ersetzeGetauschtenToken(vorher: TokenStand, neu: String, anfrageHerkunft: String?): Boolean
}

/** Einmal beim Start: ein Klartext-Token älterer Fassungen verschlüsselt ablegen. */
fun interface Tokenuebernahme {
    suspend fun uebernehmeAltesToken(): Boolean
}

/** Was der Preisalarm-Arbeiter liest und schreibt: Schalter und Marke des letzten Abrufs. */
interface Alarmablage {
    val alarmMeldungenAn: Flow<Boolean>
    val alarmMarke: Flow<String?>
    suspend fun setzeAlarmMarke(marke: String)
}

/** Für den Entwertungs-Arbeiter: ein Server, an dem die nachgeholte Abmeldung endgültig scheiterte. */
fun interface Entwertungsprotokoll {
    fun merkeGescheiterteEntwertung(server: String)
}

/** Die Sprache für Application.onCreate unter Android 13, synchron aus dem Spiegel. */
interface Sprachablage {
    fun gemerkteSprache(): String?
    suspend fun spracheNachziehen(): String
}
