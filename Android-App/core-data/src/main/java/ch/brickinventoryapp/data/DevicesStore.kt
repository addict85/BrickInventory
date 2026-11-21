package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.security.Tresorbefund
import ch.brickinventoryapp.security.Vertrauenschiffre
import ch.brickinventoryapp.network.util.Protokoll
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
 * warming and alert. Separate from the TokenAblage; what already determines the first
 * frame additionally lies in the synchronously readable mirror.
 */
@Singleton
class DevicesStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
    private val vertrauenschiffre: Vertrauenschiffre,
) : DevicesSettings, Darstellungsablage, Netzvertrauen, Alarmablage, Entwertungsprotokoll, Sprachablage, Widgetablage {
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
        const val NUTZER_CA = "nutzer_ca"
        const val USER_CA_SECRET = "nutzer_ca_geheim"
        /** Set as soon as the default „user CAs off“ has been applied once. */
        const val USER_CA_FROM_APPLIED = "nutzer_ca_aus_angewandt"
        /** Plaintext of older versions, like [NUTZER_CA]; at the same time the binding of the ciphertext. */
        const val PIN_PREFIX = "pin:"
        /** Older versions: host and port in the name. Read only until the takeover ([PIN_NAME_PREFIX]). */
        const val PIN_SECRET_PREFIX = "pin_geheim:"
        /** The name from Vertrauenschiffre.name(): whoever reads the file does not learn the server. */
        const val PIN_NAME_PREFIX = "pin_n:"
        /** Set after the takeover: plaintext that appears afterwards is only deleted. */
        const val TRUST_ADOPTED = "vertrauen_uebernommen"
        private const val AN = "an"
        private const val ANGABE = "angabe:"
        const val SYSTEMFARBEN = "systemfarben"
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

    val currency:  Flow<Waehrung> = dataStore.data.map { p -> p[CURRENCY]?.let { Waehrung(it) } ?: Waehrung.EUR }
    val language:  Flow<String> = dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Default: only Wi-Fi. Reasoning at the keys above. `?: true` or
    // `?: false` is the whole default here — a value never set is
    // simply not present in DataStore.
    val warmUpWifi:    Flow<Boolean> = dataStore.data.map { it[WARM_UP_WIFI]    ?: true }
    val warmUpMobile:   Flow<Boolean> = dataStore.data.map { it[WARM_UP_MOBILE]   ?: false }
    val warmUpRoaming: Flow<Boolean> = dataStore.data.map { it[WARM_UP_ROAMING] ?: false }
    val appTheme:  Flow<Design> = dataStore.data.map { p -> Design.aus(p[APP_THEME]) ?: Design.DEFAULT }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    override val alarmMessagesAn: Flow<Boolean> = dataStore.data.map { it[ALARM_MESSAGES] ?: false }
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

    /** Once before the first connection setup (TokenAblage waits for it). */
    fun prepareBefore() {
        adoptOldCaStatus()
        trustAdoptPlaintext()
        adoptPinNames()
        designMirror.edit { PlaintextRemainder.MIRROR.forEach { remove(it) } }
    }

    private val userCaListener = CopyOnWriteArrayList<() -> Unit>()

    /** After switching the user CAs and before a pin from the code: new TLS context, open connections gone (di/ServerClient). */
    override fun onUserCaSwitch(listener: () -> Unit) { userCaListener += listener }

    suspend fun saveCurrency(cur: Waehrung) {
        dataStore.edit { it[CURRENCY] = cur.code }
    }
    /**
     * Set one of the three network permissions — one function with the key as
     * argument instead of three almost identical ones that could drift apart.
     */
    suspend fun saveWarmUpNetwork(schluessel: Preferences.Key<Boolean>, erlaubt: Boolean) {
        dataStore.edit { it[schluessel] = erlaubt }
    }

    /**
     * Advance the mark. Empty values are not written, otherwise the
     * distinction „never fetched“ would be lost.
     */
    override suspend fun setAlarmBrand(marke: String) {
        if (marke.isBlank()) return
        dataStore.edit { it[ALARM_BRAND] = marke }
    }

    override suspend fun setAlarmMessages(an: Boolean) {
        dataStore.edit { it[ALARM_MESSAGES] = an }
    }

    override fun warmUpAllowed(netz: VorwaermNetwork): Flow<Boolean> = when (netz) {
        VorwaermNetwork.WLAN -> warmUpWifi
        VorwaermNetwork.MOBILE -> warmUpMobile
        VorwaermNetwork.ROAMING -> warmUpRoaming
    }

    override suspend fun warmUpSet(netz: VorwaermNetwork, erlaubt: Boolean) = saveWarmUpNetwork(
        when (netz) {
            VorwaermNetwork.WLAN -> WARM_UP_WIFI
            VorwaermNetwork.MOBILE -> WARM_UP_MOBILE
            VorwaermNetwork.ROAMING -> WARM_UP_ROAMING
        },
        erlaubt,
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
        dataStore.edit { it[APP_THEME] = theme.kennung }
        // And into the synchronously readable mirror, see rememberedDesign(). Both in
        // ONE place so that the two stores cannot drift apart.
        designMirror.edit { putString(APP_THEME_MIRROR, theme.kennung) }
    }

    /**
     * The most recently known design — synchronous, for the very first frame. Without
     * an entry (new installation) the default applies.
     */
    override fun rememberedDesign(): Design =
        Design.aus(designMirror.getString(APP_THEME_MIRROR, null)) ?: Design.DEFAULT

    /**
     * System, light or dark — per device. In the mirror because, like the design, it already
     * determines the first frame; without a new choice the earlier „dark per system“ applies.
     */
    override fun helligkeit(): String = brightnessApplies(
        designMirror.getString(BRIGHTNESS, null),
        if (designMirror.contains(DARK_AFTER_SYSTEM)) designMirror.getBoolean(DARK_AFTER_SYSTEM, true) else null)
    override fun setzeHelligkeit(wahl: String) {
        designMirror.edit { putString(BRIGHTNESS, wahl) }
    }
    /**
     * Do the clients of the own server also trust user-installed CAs
     * (util/ServerVertrauen.kt)? Per device and synchronous: asked on every
     * connection setup.
     */
    override fun userCaAllowed(): Boolean {
        trustAdoptPlaintext()
        val geheim = designMirror.getString(USER_CA_SECRET, null) ?: return false
        return vertrauenschiffre.entschluessle(geheim, NUTZER_CA) == AN
    }

    // If „on“ cannot be encrypted, the switch stays off: better to ask again
    // than to store a permission nobody can check.
    override fun setUserCa(an: Boolean) {
        trustAdoptPlaintext()
        val geheim = if (an) vertrauenschiffre.verschluessle(AN, NUTZER_CA) else null
        designMirror.edit { if (geheim != null) putString(USER_CA_SECRET, geheim) else remove(USER_CA_SECRET) }
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
        designMirror.edit { remove(NUTZER_CA); remove(USER_CA_SECRET); putBoolean(USER_CA_FROM_APPLIED, true) }
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
        val alt = designMirror.all.filterKeys { it == NUTZER_CA || it.startsWith(PIN_PREFIX) }
        val neu: Map<String, String> = if (designMirror.getBoolean(TRUST_ADOPTED, false)) emptyMap()
            else encryptedLegacyStock(alt) ?: return
        designMirror.edit {
            neu.forEach { (k, v) -> putString(k, v) }
            alt.keys.forEach { remove(it) }
            putBoolean(TRUST_ADOPTED, true)
        }
        trustChecked = true
    }

    /** The new entries for the plaintext; null as soon as one cannot be encrypted. */
    private fun encryptedLegacyStock(alt: Map<String, *>): Map<String, String>? {
        val neu = mutableMapOf<String, String>()
        for ((k, v) in alt) {
            when {
                k == NUTZER_CA && v == true -> neu[USER_CA_SECRET] = vertrauenschiffre.verschluessle(AN, NUTZER_CA) ?: return null
                k.startsWith(PIN_PREFIX) && v is String ->
                    neu[pinEntry(k.removePrefix(PIN_PREFIX)) ?: return null] = vertrauenschiffre.verschluessle(v, k) ?: return null
            }
        }
        return neu
    }

    /**
     * Address, name and origin of the TokenAblage and sign-out jobs: under the key that
     * only works unlocked and survives sign-out. null or Gesperrt means „not
     * now“; never a fallback to plaintext or to the pins' key.
     */
    internal fun verschluessleDetail(wert: String, name: String): String? = vertrauenschiffre.verschluessleDetail(wert, name)
    internal fun openDetail(geheim: String, name: String): Tresorbefund = vertrauenschiffre.openDetail(geheim, name)

    /** Only for the takeover: this is how address and name lay in earlier versions (under the pins' key). */
    internal fun entschluessleOldDetail(geheim: String, name: String): String? = vertrauenschiffre.entschluessle(geheim, ANGABE + name)

    /** Where the pin for [schluessel] lies; null if the pins' key is not working right now. */
    internal fun pinEntry(schluessel: String): String? =
        vertrauenschiffre.name(PIN_PREFIX + schluessel)?.let { PIN_NAME_PREFIX + it }

    /**
     * Pins of older versions carry host and port in the name. The same ciphertext (its binding
     * is the host, not the name) goes under the derived name; what cannot be named
     * stays until the next start and keeps applying until then (rememberedPin).
     */
    @Synchronized
    private fun adoptPinNames() {
        val alt = designMirror.all.filterKeys { it.startsWith(PIN_SECRET_PREFIX) }
        if (alt.isEmpty()) return
        designMirror.edit {
            for ((k, v) in alt) {
                val entry = pinEntry(k.removePrefix(PIN_SECRET_PREFIX)) ?: continue
                if (v is String && !designMirror.contains(entry)) putString(entry, v)
                remove(k)
            }
        }
    }

    // Pins per host and port (util/ServerVertrauen.kt); the held one (holdBefore) goes first.
    // An unreadable ciphertext is no pin: the connection counts as first contact, the
    // user confirms anew. A pin that cannot be encrypted applies only until the process ends
    // ([unsecured]), never in plaintext on disk.
    override fun pin(schluessel: String): String? = retained[schluessel] ?: rememberedPin(schluessel)
    fun rememberedPin(schluessel: String): String? {
        trustAdoptPlaintext()
        unsecured[schluessel]?.let { return it }
        val geheim = pinEntry(schluessel)?.let { designMirror.getString(it, null) }
            ?: designMirror.getString(PIN_SECRET_PREFIX + schluessel, null) ?: return null
        return vertrauenschiffre.entschluessle(geheim, PIN_PREFIX + schluessel)
    }
    override fun rememberPin(schluessel: String, fingerabdruck: String) {
        trustAdoptPlaintext()
        val entry = pinEntry(schluessel)
        val geheim = vertrauenschiffre.verschluessle(fingerabdruck, PIN_PREFIX + schluessel)
        if (entry != null && geheim != null) {
            designMirror.edit { putString(entry, geheim); remove(PIN_SECRET_PREFIX + schluessel) }
            unsecured.remove(schluessel)
        } else {
            unsecured[schluessel] = fingerabdruck
        }
        retained.remove(schluessel)
    }
    // New TLS context, empty connection pool: a reused or
    // resumed connection never checked the pin from the code.
    fun holdBefore(schluessel: String, fingerabdruck: String) {
        retained[schluessel] = fingerabdruck
        userCaListener.forEach { it() }
    }
    override fun fromCode(schluessel: String): Boolean = retained.containsKey(schluessel)
    fun forgetRetained(schluessel: String) { retained.remove(schluessel) }
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
        designMirror.getString(WIDGET_STATUS, null)?.let { (openDetail(it, WIDGET_STATUS) as? Tresorbefund.Readable)?.klartext }

    override fun setWidgetStatus(text: String) {
        val geheim = verschluessleDetail(text, WIDGET_STATUS) ?: return
        designMirror.edit { putString(WIDGET_STATUS, geheim) }
    }

    override fun emptyWidgetStatus() {
        designMirror.edit { remove(WIDGET_STATUS) }
    }

    /** Material You instead of the design's colors; per device, effective from Android 12. */
    override fun systemfarben(): Boolean = designMirror.getBoolean(SYSTEMFARBEN, false)
    override fun setzeSystemfarben(an: Boolean) {
        designMirror.edit { putBoolean(SYSTEMFARBEN, an) }
    }

    /**
     * No thumbnail in the app overview, no screenshots; per device. Default
     * on: the overview shows stock, prices and account to anyone who briefly
     * holds the phone. Whoever needs screenshots turns it off.
     */
    override fun hidePreview(): Boolean = designMirror.getBoolean(PREVIEW_HIDE, true)
    override fun setzeVorschauVerbergen(an: Boolean) {
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
        val alle = (failedRedemptions() + server).joinToString("\n")
        val geheim = verschluessleDetail(alle, REDEMPTION_FAILED_SECRET)
            ?: return Protokoll.warnung("Abmelden", "Gescheiterte Entwertung bei gesperrtem Gerät nicht gemerkt")
        designMirror.edit { putString(REDEMPTION_FAILED_SECRET, geheim); remove(REDEMPTION_FAILED) }
    }
    fun failedRedemptions(): Set<String> {
        val alt = designMirror.getStringSet(REDEMPTION_FAILED, null).orEmpty()
        val neu = designMirror.getString(REDEMPTION_FAILED_SECRET, null)
            ?.let { (openDetail(it, REDEMPTION_FAILED_SECRET) as? Tresorbefund.Readable)?.klartext }
            ?.split('\n')?.filter { it.isNotBlank() }.orEmpty()
        return alt + neu
    }
    fun acknowledgeFailedRedemptions() {
        designMirror.edit { remove(REDEMPTION_FAILED); remove(REDEMPTION_FAILED_SECRET) }
    }
}
