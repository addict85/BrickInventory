package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.sicherheit.PinStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Wie die App auf diesem Gerät aussieht. Synchron, weil schon das erste Bild davon
 * abhängt; im Gerät die DevicesStore, im Test eine Fassung im Speicher.
 */
interface Darstellungsablage {
    fun rememberedDesign(): Design
    fun helligkeit(): String
    fun setzeHelligkeit(wahl: String)
    fun systemfarben(): Boolean
    fun setzeSystemfarben(an: Boolean)
    fun hidePreview(): Boolean
    fun setzeVorschauVerbergen(an: Boolean)
    fun showWidgetValues(): Boolean
    fun showSetWidgetValues(an: Boolean)
    suspend fun saveLanguage(lang: String)
}

/**
 * Die zuletzt geholten Zahlen des Startbildschirm-Widgets, verschlüsselt in der
 * Geräteablage; was im Text steht (JSON), weiss nur das Widget. Synchron, weil
 * Glance ohne Koroutine des Widgets liest.
 */
interface Widgetablage {
    fun widgetStatus(): String?
    fun setWidgetStatus(text: String)
    fun emptyWidgetStatus()
}

/** Wem die Clients des eigenen Servers vertrauen: gemerkte Pins und der Schalter für Nutzer-CAs. */
interface Vertrauensablage : PinStore {
    fun userCaAllowed(): Boolean
    fun setUserCa(an: Boolean)
}

/** Was die Server-Clients zusätzlich brauchen: Nach dem Umschalten der Nutzer-CAs gilt ein neuer TLS-Kontext. */
interface Netzvertrauen : Vertrauensablage {
    fun onUserCaSwitch(listener: () -> Unit)
}

/**
 * Adresse und Token, wie sie jetzt gelten, für Abrufe am Retrofit-Client vorbei
 * (SSE, Statusabfrage). Gleich nach dem Anmelden steht der Token noch nicht auf
 * der Platte; darum nicht der Fluss, sondern der Speicherwert.
 */
interface Credentials {
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String
}

/** Offene Verbindungen trugen das alte Vertrauen; nach jeder Änderung werden sie verworfen. */
fun interface Verbindungsabwurf {
    fun discard()
}

/** Ob jetzt ein Token gilt, als Speicherwert: für Texte und für Zustände, die beim Abmelden verfallen. */
interface Anmeldestand {
    val authTokenState: StateFlow<String?>
}

/** Das Abmelden im Gerät: Token, Herkunft und Benutzername weg, unter der Sperre der Token-Schreibungen. */
interface SessionEnd {
    suspend fun clearSession()
}

/**
 * Was der Netzweg synchron vom Token braucht: Speicherspiegel, Generation und den
 * Serverwechsel. Eine eigene Schnittstelle, damit di/ServerClient nur daran hängt.
 */
interface Tokenspiegel {
    val serverUrlState: StateFlow<String?>
    val authTokenState: StateFlow<String?>
    val tokenOriginState: StateFlow<String?>
    /** Während einer QR-Kopplung mit einem anderen Server dessen Adresse, sonst null (Anmeldeablage.kopplungsziel). */
    val kopplungszielState: StateFlow<String?>
    fun tokenGeneration(): Long
    fun waitOnStart()
    fun onServerwechsel(listener: () -> Unit)
    suspend fun tokenStatus(): TokenStatus
    suspend fun replaceSwappedToken(vorher: TokenStatus, neu: String, requestOrigin: String?): Boolean
}

/** Einmal beim Start: ein Klartext-Token älterer Fassungen entfernen, einen alten Geheimtext umschlüsseln. */
fun interface Tokenuebernahme {
    suspend fun adoptOldToken(): Boolean

    /** Nach dem Entsperren: nur das Umschlüsseln, ohne die übrigen Aufräumarbeiten des Starts. */
    suspend fun levelTokenHigh() = Unit
}

/** Was der Preisalarm-Arbeiter liest und schreibt: Schalter und Marke des letzten Abrufs. */
interface Alarmablage {
    val alarmMessagesAn: Flow<Boolean>
    val alarmBrand: Flow<String?>
    suspend fun setAlarmBrand(marke: String)
}

/** Für den Entwertungs-Arbeiter: ein Server, an dem die nachgeholte Abmeldung endgültig scheiterte. */
fun interface Entwertungsprotokoll {
    fun rememberFailedRedemption(server: String)
}

/** Die Sprache für Application.onCreate unter Android 13, synchron aus dem Spiegel. */
interface Sprachablage {
    fun rememberedLanguage(): String?
    suspend fun followUpLanguage(): String
}
