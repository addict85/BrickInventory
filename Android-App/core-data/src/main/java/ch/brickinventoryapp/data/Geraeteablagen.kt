package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.security.PinStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * How the app looks on this device. Synchronous because already the first frame
 * depends on it; on the device the DevicesStore, in the test an in-memory version.
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
 * The most recently fetched numbers of the home screen widget, encrypted in the
 * device store; only the widget knows what stands in the text (JSON). Synchronous because
 * Glance reads without the widget's coroutine.
 */
interface Widgetablage {
    fun widgetStatus(): String?
    fun setWidgetStatus(text: String)
    fun emptyWidgetStatus()
}

/** Whom the clients of the own server trust: remembered pins and the switch for user CAs. */
interface Vertrauensablage : PinStore {
    fun userCaAllowed(): Boolean
    fun setUserCa(an: Boolean)
}

/** What the server clients additionally need: after switching the user CAs a new TLS context applies. */
interface Netzvertrauen : Vertrauensablage {
    fun onUserCaSwitch(listener: () -> Unit)
}

/**
 * Address and token as they apply now, for fetches bypassing the Retrofit client
 * (SSE, status query). Right after signing in the token is not yet on
 * disk; hence not the flow but the in-memory value.
 */
interface Credentials {
    suspend fun serverUrlJetzt(): String
    suspend fun tokenJetzt(): String
}

/** Open connections carried the old trust; after every change they are discarded. */
fun interface Verbindungsabwurf {
    fun discard()
}

/** Whether a token applies now, as an in-memory value: for texts and for states that expire on sign-out. */
interface Anmeldestand {
    val authTokenState: StateFlow<String?>
}

/** Sign-out on the device: token, origin and username gone, under the lock of the token writes. */
interface SessionEnd {
    suspend fun clearSession()
}

/**
 * What the network path needs synchronously from the token: in-memory mirror, generation and the
 * server switch. An interface of its own so that di/ServerClient depends only on it.
 */
interface Tokenspiegel {
    val serverUrlState: StateFlow<String?>
    val authTokenState: StateFlow<String?>
    val tokenOriginState: StateFlow<String?>
    /** During a QR pairing with another server its address, otherwise null (Anmeldeablage.kopplungsziel). */
    val kopplungszielState: StateFlow<String?>
    fun tokenGeneration(): Long
    fun waitOnStart()
    fun onServerwechsel(listener: () -> Unit)
    suspend fun tokenStatus(): TokenStatus
    suspend fun replaceSwappedToken(vorher: TokenStatus, neu: String, requestOrigin: String?): Boolean

    /** After the device lock wiped the token from memory: read it again (TokenAblage, LockWipe). */
    fun restoreAfterLock() = Unit
}

/** Once at start: remove a plaintext token of older versions, rekey an old ciphertext. */
fun interface Tokenuebernahme {
    suspend fun adoptOldToken(): Boolean

    /** After unlocking: only the rekeying, without the other cleanup tasks of the start. */
    suspend fun levelTokenHigh() = Unit
}

/** What the price alert worker reads and writes: switch and mark of the last fetch. */
interface Alarmablage {
    val alarmMessagesAn: Flow<Boolean>
    val alarmBrand: Flow<String?>
    suspend fun setAlarmBrand(marke: String)
}

/** For the invalidation worker: a server at which the deferred sign-out finally failed. */
fun interface Entwertungsprotokoll {
    fun rememberFailedRedemption(server: String)
}

/** The language for Application.onCreate below Android 13, synchronously from the mirror. */
interface Sprachablage {
    fun rememberedLanguage(): String?
    suspend fun followUpLanguage(): String
}
