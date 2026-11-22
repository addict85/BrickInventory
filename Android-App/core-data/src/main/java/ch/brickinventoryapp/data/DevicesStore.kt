package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.security.VaultFinding
import ch.brickinventoryapp.security.TrustCipher
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.model.ui.theme.brightnessApplies
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Settings of this device, not of the account: display, trust, pins, widget,
 * warming and alert. Separate from the TokenStore; what already determines the first
 * frame additionally lies in the synchronously readable mirror.
 */
@Singleton
class DevicesStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
    private val trustCipher: TrustCipher,
) : DevicesSettings, AppearanceStore, NetworkTrust, AlarmStore, RedemptionLog, LanguageStore, WidgetStatusStore {
    companion object {
        /**
         * The synchronously readable mirror of the design — its own file so that it
         * touches nothing else. Why it exists stands at
         * rememberedDesign() further below.
         */
        const val DESIGN_MIRROR_FILE = "design_spiegel"
        const val DARK_AFTER_SYSTEM = "dunkel_nach_system"
        const val BRIGHTNESS = "helligkeit"
        const val APP_THEME_MIRROR = "app_theme"
        const val LANGUAGE_MIRROR = "sprache"
        /** Plaintext of older versions; read only for the one-time takeover. */
        const val USER_CA = "nutzer_ca"
        const val USER_CA_SECRET = "nutzer_ca_geheim"
        /** Set as soon as the default „user CAs off“ has been applied once. */
        const val USER_CA_FROM_APPLIED = "nutzer_ca_aus_angewandt"
        /** Plaintext of older versions, like [USER_CA]; at the same time the binding of the ciphertext. */
        const val PIN_PREFIX = "pin:"
        /** Older versions: host and port in the name. Read only until the takeover ([PIN_NAME_PREFIX]). */
        const val PIN_SECRET_PREFIX = "pin_geheim:"
        /** The name from Vertrauenschiffre.name(): whoever reads the file does not learn the server. */
        const val PIN_NAME_PREFIX = "pin_n:"
        /** Set after the takeover: plaintext that appears afterwards is only deleted. */
        const val TRUST_ADOPTED = "vertrauen_uebernommen"
        private const val AN = "an"
        private const val INFO = "angabe:"
        const val SYSTEM_COLORS = "systemfarben"
        const val PREVIEW_HIDE = "vorschau_verbergen"
        /** Plaintext of older versions; read and taken over on the next write. */
        const val REDEMPTION_FAILED = "entwertung_gescheitert"
        const val REDEMPTION_FAILED_SECRET = "entwertung_gescheitert_geheim"
        const val WIDGET_VALUES = "widget_werte"
        const val WIDGET_STATUS = "widget_stand"

        /**
         * On which networks may the thumbnail warming fetch? On the device,
         * not with the account: on a phone with a tight plan one wants it differently than on a tablet.
         * The three switches are independent, one per situation; a hidden
         * coupling would look like a broken switch.
         */
        val WARM_UP_WIFI    = booleanPreferencesKey("vorwaermen_wlan")
        val WARM_UP_MOBILE   = booleanPreferencesKey("vorwaermen_mobil")
        val WARM_UP_ROAMING = booleanPreferencesKey("vorwaermen_roaming")

        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (follows the OS language), "en" or "de"
        val LANGUAGE     = stringPreferencesKey("language")
        /**
         * The most recently known design of the server. Remembered because /settings only comes after
         * sign-in and the sign-in and setup screens would otherwise appear in the default design
         * and switch — stage one as in public/js/theme-boot.js.
         * Global, therefore it survives sign-out.
         */
        val APP_THEME    = stringPreferencesKey("app_theme")

        /**
         * Should triggered price alerts appear as notifications? Per device: with
         * phone and tablet one usually wants the notification on only one. Default off —
         * unrequested notifications would be a surprise, and from Android 13 it needs
         * the permission anyway.
         */
        val ALARM_MESSAGES = booleanPreferencesKey("alarm_meldungen")

        /**
         * The point in time of the last successful fetch, as ISO text from the server — not
         * the phone's clock, whose deviation would decide about duplicate or missing notifications
         * (see Alarmabholung). Text, because it is only passed on and a
         * conversion would lose the time zone.
         */
        val ALARM_BRAND = stringPreferencesKey("alarm_marke")
    }

    val currency:  Flow<CurrencyCode> = dataStore.data.map { p -> p[CURRENCY]?.let { CurrencyCode(it) } ?: CurrencyCode.EUR }
    val language:  Flow<String> = dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Default: only Wi-Fi. Reasoning at the keys above. `?: true` or
    // `?: false` is the whole default here — a value never set is
    // simply not present in DataStore.
    val warmUpWifi:    Flow<Boolean> = dataStore.data.map { it[WARM_UP_WIFI]    ?: true }
    val warmUpMobile:   Flow<Boolean> = dataStore.data.map { it[WARM_UP_MOBILE]   ?: false }
    val warmUpRoaming: Flow<Boolean> = dataStore.data.map { it[WARM_UP_ROAMING] ?: false }
    val appTheme:  Flow<Design> = dataStore.data.map { p -> Design.from(p[APP_THEME]) ?: Design.DEFAULT }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    override val alarmMessagesEnabled: Flow<Boolean> = dataStore.data.map { it[ALARM_MESSAGES] ?: false }
    /**
     * null = never fetched: on the very first pass Alarmabholung only marks
     * and reports nothing. An empty text would bring everything old at once.
     */
    override val alarmBrand: Flow<String?> = dataStore.data.map { it[ALARM_BRAND] }

    // Synchronously readable mirror of the design (SharedPreferences): setContent() runs
    // before the first DataStore value, and the first frame would otherwise arise in the
    // default design. The DataStore stays leading.
    private val designMirror by lazy {
        context.getSharedPreferences(DESIGN_MIRROR_FILE, Context.MODE_PRIVATE)
    }

    /** Once before the first connection setup (TokenStore waits for it). */
    fun prepareBefore() {
        adoptOldCaStatus()
        trustAdoptPlaintext()
        adoptPinNames()
        designMirror.edit { PlaintextRemainder.MIRROR.forEach { remove(it) } }
    }

    private val userCaListener = CopyOnWriteArrayList<() -> Unit>()

    /** After switching the user CAs and before a pin from the code: new TLS context, open connections gone (di/ServerClient). */
    override fun onUserCaSwitch(listener: () -> Unit) { userCaListener += listener }

    suspend fun saveCurrency(cur: CurrencyCode) {
        dataStore.edit { it[CURRENCY] = cur.code }
    }
    /**
     * Set one of the three network permissions — one function with the key as
     * argument instead of three almost identical ones that could drift apart.
     */
    suspend fun saveWarmUpNetwork(key: Preferences.Key<Boolean>, allowed: Boolean) {
        dataStore.edit { it[key] = allowed }
    }

    /**
     * Advance the mark. Empty values are not written, otherwise the
     * distinction „never fetched“ would be lost.
     */
    override suspend fun setAlarmBrand(brand: String) {
        if (brand.isBlank()) return
        dataStore.edit { it[ALARM_BRAND] = brand }
    }

    override suspend fun setAlarmMessages(an: Boolean) {
        dataStore.edit { it[ALARM_MESSAGES] = an }
    }

    override fun warmUpAllowed(network: PrewarmNetwork): Flow<Boolean> = when (network) {
        PrewarmNetwork.WIFI -> warmUpWifi
        PrewarmNetwork.MOBILE -> warmUpMobile
        PrewarmNetwork.ROAMING -> warmUpRoaming
    }

    override suspend fun warmUpSet(network: PrewarmNetwork, allowed: Boolean) = saveWarmUpNetwork(
        when (network) {
            PrewarmNetwork.WIFI -> WARM_UP_WIFI
            PrewarmNetwork.MOBILE -> WARM_UP_MOBILE
            PrewarmNetwork.ROAMING -> WARM_UP_ROAMING
        },
        allowed,
    )

    override suspend fun saveLanguage(lang: String) {
        dataStore.edit { it[LANGUAGE] = lang }
        designMirror.edit { putString(LANGUAGE_MIRROR, lang) }
    }

    /**
     * The language synchronously for Application.onCreate (below Android 13), without
     * blocking the DataStore. null = saved before the mirror; then
     * [followUpLanguage] reads it once afterwards.
     */
    override fun rememberedLanguage(): String? = designMirror.getString(LANGUAGE_MIRROR, null)

    override suspend fun followUpLanguage(): String {
        val lang = language.first()
        designMirror.edit { putString(LANGUAGE_MIRROR, lang) }
        return lang
    }
    suspend fun saveAppTheme(theme: Design) {
        dataStore.edit { it[APP_THEME] = theme.identifier }
        // And into the synchronously readable mirror, see rememberedDesign(). Both in
        // ONE place so that the two stores cannot drift apart.
        designMirror.edit { putString(APP_THEME_MIRROR, theme.identifier) }
    }

    /**
     * The most recently known design — synchronous, for the very first frame. Without
     * an entry (new installation) the default applies.
     */
    override fun rememberedDesign(): Design =
        Design.from(designMirror.getString(APP_THEME_MIRROR, null)) ?: Design.DEFAULT

    /**
     * System, light or dark — per device. In the mirror because, like the design, it already
     * determines the first frame; without a new choice the earlier „dark per system“ applies.
     */
    override fun brightness(): String = brightnessApplies(
        designMirror.getString(BRIGHTNESS, null),
        if (designMirror.contains(DARK_AFTER_SYSTEM)) designMirror.getBoolean(DARK_AFTER_SYSTEM, true) else null)
    override fun applyBrightness(choice: String) {
        designMirror.edit { putString(BRIGHTNESS, choice) }
    }
    /**
     * Do the clients of the own server also trust user-installed CAs
     * (util/ServerTrust.kt)? Per device and synchronous: asked on every
     * connection setup.
     */
    override fun userCaAllowed(): Boolean {
        trustAdoptPlaintext()
        val secret = designMirror.getString(USER_CA_SECRET, null) ?: return false
        return trustCipher.decrypt(secret, USER_CA) == AN
    }

    // If „on“ cannot be encrypted, the switch stays off: better to ask again
    // than to store a permission nobody can check.
    override fun setUserCa(an: Boolean) {
        trustAdoptPlaintext()
        val secret = if (an) trustCipher.encrypt(AN, USER_CA) else null
        designMirror.edit { if (secret != null) putString(USER_CA_SECRET, secret) else remove(USER_CA_SECRET) }
        userCaListener.forEach { it() }
    }

    /**
     * Once before the first connection setup (the latch waits for it): user CAs
     * off, even if they were on before. Whoever needs them is asked on the first
     * TLS error (CertificateQuestion) — a silent permission from an
     * older version should not keep applying.
     */
    fun adoptOldCaStatus() {
        if (designMirror.getBoolean(USER_CA_FROM_APPLIED, false)) return
        designMirror.edit { remove(USER_CA); remove(USER_CA_SECRET); putBoolean(USER_CA_FROM_APPLIED, true) }
    }

    @Volatile private var trustChecked = false

    /**
     * Take over plaintext pins and switches of older versions once, encrypted, and
     * delete them. Afterwards the mark shows: plaintext that appears later was not written by the app
     * and is discarded, not taken over. If encrypting fails, the plaintext
     * stays and does not count — the next read attempts it again.
     */
    @Synchronized
    private fun trustAdoptPlaintext() {
        if (trustChecked) return
        val old = designMirror.all.filterKeys { it == USER_CA || it.startsWith(PIN_PREFIX) }
        val newValue: Map<String, String> = if (designMirror.getBoolean(TRUST_ADOPTED, false)) emptyMap()
            else encryptedLegacyStock(old) ?: return
        designMirror.edit {
            newValue.forEach { (k, v) -> putString(k, v) }
            old.keys.forEach { remove(it) }
            putBoolean(TRUST_ADOPTED, true)
        }
        trustChecked = true
    }

    /** The new entries for the plaintext; null as soon as one cannot be encrypted. */
    private fun encryptedLegacyStock(old: Map<String, *>): Map<String, String>? {
        val newValue = mutableMapOf<String, String>()
        for ((k, v) in old) {
            when {
                k == USER_CA && v == true -> newValue[USER_CA_SECRET] = trustCipher.encrypt(AN, USER_CA) ?: return null
                k.startsWith(PIN_PREFIX) && v is String ->
                    newValue[pinEntry(k.removePrefix(PIN_PREFIX)) ?: return null] = trustCipher.encrypt(v, k) ?: return null
            }
        }
        return newValue
    }

    /**
     * Address, name and origin of the TokenStore and sign-out jobs: under the key that
     * only works unlocked and survives sign-out. null or Gesperrt means „not
     * now“; never a fallback to plaintext or to the pins' key.
     */
    internal fun encryptDetail(value: String, name: String): String? = trustCipher.encryptDetail(value, name)
    internal fun openDetail(secret: String, name: String): VaultFinding = trustCipher.openDetail(secret, name)

    /** Only for the takeover: this is how address and name lay in earlier versions (under the pins' key). */
    internal fun decryptOldDetail(secret: String, name: String): String? = trustCipher.decrypt(secret, INFO + name)

    /** Where the pin for [key] lies; null if the pins' key is not working right now. */
    internal fun pinEntry(key: String): String? =
        trustCipher.name(PIN_PREFIX + key)?.let { PIN_NAME_PREFIX + it }

    /**
     * Pins of older versions carry host and port in the name. The same ciphertext (its binding
     * is the host, not the name) goes under the derived name; what cannot be named
     * stays until the next start and keeps applying until then (rememberedPin).
     */
    @Synchronized
    private fun adoptPinNames() {
        val old = designMirror.all.filterKeys { it.startsWith(PIN_SECRET_PREFIX) }
        if (old.isEmpty()) return
        designMirror.edit {
            for ((k, v) in old) {
                val entry = pinEntry(k.removePrefix(PIN_SECRET_PREFIX)) ?: continue
                if (v is String && !designMirror.contains(entry)) putString(entry, v)
                remove(k)
            }
        }
    }

    // Pins per host and port (util/ServerTrust.kt); the held one (holdBefore) goes first.
    // An unreadable ciphertext is no pin: the connection counts as first contact, the
    // user confirms anew. A pin that cannot be encrypted applies only until the process ends
    // ([unsecured]), never in plaintext on disk.
    override fun pin(key: String): String? = retained[key] ?: rememberedPin(key)
    fun rememberedPin(key: String): String? {
        trustAdoptPlaintext()
        unsecured[key]?.let { return it }
        val secret = pinEntry(key)?.let { designMirror.getString(it, null) }
            ?: designMirror.getString(PIN_SECRET_PREFIX + key, null) ?: return null
        return trustCipher.decrypt(secret, PIN_PREFIX + key)
    }
    override fun rememberPin(key: String, fingerprint: String) {
        trustAdoptPlaintext()
        val entry = pinEntry(key)
        val secret = trustCipher.encrypt(fingerprint, PIN_PREFIX + key)
        if (entry != null && secret != null) {
            designMirror.edit { putString(entry, secret); remove(PIN_SECRET_PREFIX + key) }
            unsecured.remove(key)
        } else {
            unsecured[key] = fingerprint
        }
        retained.remove(key)
    }
    // New TLS context, empty connection pool: a reused or
    // resumed connection never checked the pin from the code.
    fun holdBefore(key: String, fingerprint: String) {
        retained[key] = fingerprint
        userCaListener.forEach { it() }
    }
    override fun fromCode(key: String): Boolean = retained.containsKey(key)
    fun forgetRetained(key: String) { retained.remove(key) }
    private val retained = ConcurrentHashMap<String, String>()
    private val unsecured = ConcurrentHashMap<String, String>()

    /**
     * Show money values in the home screen widget? Per device, default off: the widget
     * is readable without unlocking for anyone who sees the phone.
     */
    override fun showWidgetValues(): Boolean = designMirror.getBoolean(WIDGET_VALUES, false)
    override fun showSetWidgetValues(an: Boolean) {
        designMirror.edit { putBoolean(WIDGET_VALUES, an) }
    }

    // Under the key of the details: locked nobody reads the numbers from the file. The widget
    // then shows „empty“ and redraws after unlocking (BrickInventoryApp). A state under
    // the former key counts as empty; the next fetch replaces it.
    override fun widgetStatus(): String? =
        designMirror.getString(WIDGET_STATUS, null)?.let { (openDetail(it, WIDGET_STATUS) as? VaultFinding.Readable)?.plaintext }

    override fun setWidgetStatus(text: String) {
        val secret = encryptDetail(text, WIDGET_STATUS) ?: return
        designMirror.edit { putString(WIDGET_STATUS, secret) }
    }

    override fun emptyWidgetStatus() {
        designMirror.edit { remove(WIDGET_STATUS) }
    }

    /** Material You instead of the design's colors; per device, effective from Android 12. */
    override fun systemColors(): Boolean = designMirror.getBoolean(SYSTEM_COLORS, false)
    override fun applySystemColors(an: Boolean) {
        designMirror.edit { putBoolean(SYSTEM_COLORS, an) }
    }

    /**
     * No thumbnail in the app overview, no screenshots; per device. Default
     * on: the overview shows stock, prices and account to anyone who briefly
     * holds the phone. Whoever needs screenshots turns it off.
     */
    override fun hidePreview(): Boolean = designMirror.getBoolean(PREVIEW_HIDE, true)
    override fun applyPreviewHidden(an: Boolean) {
        designMirror.edit { putBoolean(PREVIEW_HIDE, an) }
    }

    /**
     * Servers at which a deferred sign-out finally failed. The worker's
     * notification may be switched off; the app therefore says it once more on the next start
     * (AppViewModel), afterwards the list is empty.
     */
    // The addresses encrypted like the details; a list of earlier versions comes along.
    // Locked, the entry gets lost, the worker's notification is there anyway.
    override fun rememberFailedRedemption(server: String) {
        val all = (failedRedemptions() + server).joinToString("\n")
        val secret = encryptDetail(all, REDEMPTION_FAILED_SECRET)
            ?: return AppLog.warning("Abmelden", "Gescheiterte Entwertung bei gesperrtem Gerät nicht gemerkt")
        designMirror.edit { putString(REDEMPTION_FAILED_SECRET, secret); remove(REDEMPTION_FAILED) }
    }
    fun failedRedemptions(): Set<String> {
        val old = designMirror.getStringSet(REDEMPTION_FAILED, null).orEmpty()
        val newValue = designMirror.getString(REDEMPTION_FAILED_SECRET, null)
            ?.let { (openDetail(it, REDEMPTION_FAILED_SECRET) as? VaultFinding.Readable)?.plaintext }
            ?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
        return old + newValue
    }
    fun acknowledgeFailedRedemptions() {
        designMirror.edit { remove(REDEMPTION_FAILED); remove(REDEMPTION_FAILED_SECRET) }
    }
}
