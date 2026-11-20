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
 * Einstellungen dieses Geräts, nicht des Kontos: Darstellung, Vertrauen, Pins, Widget,
 * Vorwärmen und Alarm. Getrennt von der TokenAblage; was schon das erste
 * Bild bestimmt, liegt zusätzlich im synchron lesbaren Spiegel.
 */
@Singleton
class DevicesStore @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
    private val vertrauenschiffre: Vertrauenschiffre,
) : DevicesSettings, Darstellungsablage, Netzvertrauen, Alarmablage, Entwertungsprotokoll, Sprachablage, Widgetablage {
    companion object {
        /**
         * Der synchron lesbare Spiegel des Designs — eigene Datei, damit er
         * nichts anderes beruehrt. Warum es ihn gibt, steht bei
         * rememberedDesign() weiter unten.
         */
        const val DESIGN_MIRROR_FILE = "design_spiegel"
        const val DARK_AFTER_SYSTEM = "dunkel_nach_system"
        const val BRIGHTNESS = "helligkeit"
        const val APP_THEME_MIRROR = "app_theme"
        const val LANGUAGE_MIRROR = "sprache"
        /** Klartext älterer Fassungen; gelesen nur noch zur einmaligen Übernahme. */
        const val NUTZER_CA = "nutzer_ca"
        const val USER_CA_SECRET = "nutzer_ca_geheim"
        /** Gesetzt, sobald die Vorgabe „Nutzer-CAs aus“ einmal angewandt wurde. */
        const val USER_CA_FROM_APPLIED = "nutzer_ca_aus_angewandt"
        /** Klartext älterer Fassungen, wie [NUTZER_CA]; zugleich die Bindung des Geheimtexts. */
        const val PIN_PREFIX = "pin:"
        /** Ältere Fassungen: Host und Port im Namen. Gelesen nur bis zur Übernahme ([PIN_NAME_PREFIX]). */
        const val PIN_SECRET_PREFIX = "pin_geheim:"
        /** Der Name aus Vertrauenschiffre.name(): Wer die Datei liest, erfährt den Server nicht. */
        const val PIN_NAME_PREFIX = "pin_n:"
        /** Gesetzt nach der Übernahme: Klartext, der danach auftaucht, wird nur noch gelöscht. */
        const val TRUST_ADOPTED = "vertrauen_uebernommen"
        private const val AN = "an"
        private const val ANGABE = "angabe:"
        const val SYSTEMFARBEN = "systemfarben"
        const val PREVIEW_HIDE = "vorschau_verbergen"
        /** Klartext älterer Fassungen; gelesen und beim nächsten Schreiben übernommen. */
        const val REDEMPTION_FAILED = "entwertung_gescheitert"
        const val REDEMPTION_FAILED_SECRET = "entwertung_gescheitert_geheim"
        const val WIDGET_VALUES = "widget_werte"
        const val WIDGET_STATUS = "widget_stand"

        /**
         * In welchen Netzen darf das Vorwärmen der Vorschaubilder holen? Auf dem Gerät,
         * nicht beim Konto: Am Telefon mit knappem Tarif will man es anders als am Tablet.
         * Die drei Schalter sind unabhängig, je einer für eine Lage; eine versteckte
         * Kopplung sähe aus wie ein kaputter Schalter.
         */
        val WARM_UP_WIFI    = booleanPreferencesKey("vorwaermen_wlan")
        val WARM_UP_MOBILE   = booleanPreferencesKey("vorwaermen_mobil")
        val WARM_UP_ROAMING = booleanPreferencesKey("vorwaermen_roaming")

        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (folgt der OS-Sprache), "en" oder "de"
        val LANGUAGE     = stringPreferencesKey("language")
        /**
         * Das zuletzt bekannte Design des Servers. Gemerkt, weil /settings erst nach der
         * Anmeldung kommt und Anmelde- und Einrichtungsbildschirm sonst im Standard-Design
         * erschienen und umsprangen — Stufe eins wie in public/js/theme-boot.js.
         * Global, deshalb überlebt es das Abmelden.
         */
        val APP_THEME    = stringPreferencesKey("app_theme")

        /**
         * Sollen ausgelöste Preisalarme als Benachrichtigung erscheinen? Je Gerät: Mit
         * Telefon und Tablet will man die Meldung meist nur an einem. Vorgabe aus —
         * ungefragte Benachrichtigungen wären eine Überraschung, und ab Android 13 braucht
         * es ohnehin die Erlaubnis.
         */
        val ALARM_MESSAGES = booleanPreferencesKey("alarm_meldungen")

        /**
         * Der Zeitpunkt des letzten erfolgreichen Abrufs, als ISO-Text vom Server — nicht
         * die Uhr des Telefons, deren Abweichung über doppelte oder fehlende Meldungen
         * entschiede (siehe Alarmabholung). Text, weil nur weitergereicht wird und eine
         * Umrechnung die Zeitzone verlöre.
         */
        val ALARM_BRAND = stringPreferencesKey("alarm_marke")
    }

    val currency:  Flow<Waehrung> = dataStore.data.map { p -> p[CURRENCY]?.let { Waehrung(it) } ?: Waehrung.EUR }
    val language:  Flow<String> = dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Vorgabe: nur WLAN. Begruendung an den Schluesseln oben. `?: true` bzw.
    // `?: false` ist hier die ganze Vorgabe — ein noch nie gesetzter Wert ist
    // in DataStore schlicht nicht da.
    val warmUpWifi:    Flow<Boolean> = dataStore.data.map { it[WARM_UP_WIFI]    ?: true }
    val warmUpMobile:   Flow<Boolean> = dataStore.data.map { it[WARM_UP_MOBILE]   ?: false }
    val warmUpRoaming: Flow<Boolean> = dataStore.data.map { it[WARM_UP_ROAMING] ?: false }
    val appTheme:  Flow<Design> = dataStore.data.map { p -> Design.aus(p[APP_THEME]) ?: Design.DEFAULT }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    override val alarmMessagesAn: Flow<Boolean> = dataStore.data.map { it[ALARM_MESSAGES] ?: false }
    /**
     * null = noch nie abgerufen: Beim allerersten Durchgang markiert Alarmabholung nur
     * und meldet nichts. Ein leerer Text brächte alles Alte auf einmal.
     */
    override val alarmBrand: Flow<String?> = dataStore.data.map { it[ALARM_BRAND] }

    // Synchron lesbarer Spiegel des Designs (SharedPreferences): setContent() läuft
    // vor dem ersten DataStore-Wert, und das erste Bild entstünde sonst im
    // Standard-Design. Der DataStore bleibt führend.
    private val designMirror by lazy {
        context.getSharedPreferences(DESIGN_MIRROR_FILE, Context.MODE_PRIVATE)
    }

    /** Einmalig vor dem ersten Verbindungsaufbau (TokenAblage wartet darauf). */
    fun prepareBefore() {
        adoptOldCaStatus()
        trustAdoptPlaintext()
        adoptPinNames()
        designMirror.edit { PlaintextRemainder.MIRROR.forEach { remove(it) } }
    }

    private val userCaListener = CopyOnWriteArrayList<() -> Unit>()

    /** Nach dem Umschalten der Nutzer-CAs und vor einem Pin aus dem Code: neuer TLS-Kontext, offene Verbindungen weg (di/ServerClient). */
    override fun onUserCaSwitch(listener: () -> Unit) { userCaListener += listener }

    suspend fun saveCurrency(cur: Waehrung) {
        dataStore.edit { it[CURRENCY] = cur.code }
    }
    /**
     * Eine der drei Netzerlaubnisse setzen — eine Funktion mit dem Schlüssel als
     * Argument statt dreier fast gleicher, die auseinanderlaufen könnten.
     */
    suspend fun saveWarmUpNetwork(schluessel: Preferences.Key<Boolean>, erlaubt: Boolean) {
        dataStore.edit { it[schluessel] = erlaubt }
    }

    /**
     * Die Marke fortschreiben. Leere Werte werden nicht geschrieben, sonst ginge die
     * Unterscheidung „noch nie abgerufen“ verloren.
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
     * Die Sprache synchron für Application.onCreate (unter Android 13), ohne den
     * DataStore zu blockieren. null = vor dem Spiegel gespeichert; dann liest
     * [followUpLanguage] sie einmal nach.
     */
    override fun rememberedLanguage(): String? = designMirror.getString(LANGUAGE_MIRROR, null)

    override suspend fun followUpLanguage(): String {
        val lang = language.first()
        designMirror.edit { putString(LANGUAGE_MIRROR, lang) }
        return lang
    }
    suspend fun saveAppTheme(theme: Design) {
        dataStore.edit { it[APP_THEME] = theme.kennung }
        // Und in den synchron lesbaren Spiegel, siehe rememberedDesign(). Beides an
        // EINER Stelle, damit die zwei Ablagen nicht auseinanderlaufen können.
        designMirror.edit { putString(APP_THEME_MIRROR, theme.kennung) }
    }

    /**
     * Das zuletzt bekannte Design — synchron, für den allerersten Bildaufbau. Ohne
     * Eintrag (Neuinstallation) gilt der Standard.
     */
    override fun rememberedDesign(): Design =
        Design.aus(designMirror.getString(APP_THEME_MIRROR, null)) ?: Design.DEFAULT

    /**
     * System, Hell oder Dunkel — je Gerät. Im Spiegel, weil es wie das Design schon
     * das erste Bild bestimmt; ohne neue Wahl gilt die frühere „dunkel nach System“.
     */
    override fun helligkeit(): String = brightnessApplies(
        designMirror.getString(BRIGHTNESS, null),
        if (designMirror.contains(DARK_AFTER_SYSTEM)) designMirror.getBoolean(DARK_AFTER_SYSTEM, true) else null)
    override fun setzeHelligkeit(wahl: String) {
        designMirror.edit { putString(BRIGHTNESS, wahl) }
    }
    /**
     * Vertrauen die Clients des eigenen Servers auch nutzerinstallierten CAs
     * (util/ServerVertrauen.kt)? Je Gerät und synchron: Gefragt wird bei jedem
     * Verbindungsaufbau.
     */
    override fun userCaAllowed(): Boolean {
        trustAdoptPlaintext()
        val geheim = designMirror.getString(USER_CA_SECRET, null) ?: return false
        return vertrauenschiffre.entschluessle(geheim, NUTZER_CA) == AN
    }

    // Lässt sich „an“ nicht verschlüsseln, bleibt der Schalter aus: lieber erneut
    // fragen als eine Erlaubnis ablegen, die niemand prüfen kann.
    override fun setUserCa(an: Boolean) {
        trustAdoptPlaintext()
        val geheim = if (an) vertrauenschiffre.verschluessle(AN, NUTZER_CA) else null
        designMirror.edit { if (geheim != null) putString(USER_CA_SECRET, geheim) else remove(USER_CA_SECRET) }
        userCaListener.forEach { it() }
    }

    /**
     * Einmalig vor dem ersten Verbindungsaufbau (der Latch wartet darauf): Nutzer-CAs
     * aus, auch wenn sie vorher an waren. Wer sie braucht, wird beim ersten
     * TLS-Fehler gefragt (CertificateQuestion) — eine stille Erlaubnis aus einer
     * älteren Fassung soll nicht weiter gelten.
     */
    fun adoptOldCaStatus() {
        if (designMirror.getBoolean(USER_CA_FROM_APPLIED, false)) return
        designMirror.edit { remove(NUTZER_CA); remove(USER_CA_SECRET); putBoolean(USER_CA_FROM_APPLIED, true) }
    }

    @Volatile private var trustChecked = false

    /**
     * Klartext-Pins und -Schalter älterer Fassungen einmal verschlüsselt übernehmen und
     * löschen. Danach zeigt die Marke: Klartext, der später auftaucht, hat nicht die App
     * geschrieben und wird verworfen, nicht übernommen. Scheitert das Verschlüsseln, bleibt
     * der Klartext liegen und gilt nicht — der nächste Lesezugriff versucht es erneut.
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

    /** Die neuen Einträge zum Klartext; null, sobald einer sich nicht verschlüsseln lässt. */
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
     * Adresse, Name und Herkunft der TokenAblage und Abmeldeaufträge: unter dem Schlüssel, der
     * nur entsperrt arbeitet und das Abmelden überlebt. null bzw. Gesperrt heisst „jetzt
     * nicht“; nie ein Rückfall auf Klartext oder auf den Schlüssel der Pins.
     */
    internal fun verschluessleDetail(wert: String, name: String): String? = vertrauenschiffre.verschluessleDetail(wert, name)
    internal fun openDetail(geheim: String, name: String): Tresorbefund = vertrauenschiffre.openDetail(geheim, name)

    /** Nur zur Übernahme: So lagen Adresse und Name in früheren Fassungen (unter dem Schlüssel der Pins). */
    internal fun entschluessleOldDetail(geheim: String, name: String): String? = vertrauenschiffre.entschluessle(geheim, ANGABE + name)

    /** Wo der Pin zu [schluessel] liegt; null, wenn der Schlüssel der Pins gerade nicht arbeitet. */
    internal fun pinEntry(schluessel: String): String? =
        vertrauenschiffre.name(PIN_PREFIX + schluessel)?.let { PIN_NAME_PREFIX + it }

    /**
     * Pins älterer Fassungen tragen Host und Port im Namen. Derselbe Geheimtext (seine Bindung
     * ist der Host, nicht der Name) kommt unter den abgeleiteten Namen; was sich nicht benennen
     * lässt, bleibt bis zum nächsten Start liegen und gilt bis dahin weiter (rememberedPin).
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

    // Pins je Host und Port (util/ServerVertrauen.kt); der vorgehaltene (holdBefore) geht vor.
    // Ein unlesbarer Geheimtext ist kein Pin: Die Verbindung gilt als Erstkontakt, der
    // Nutzer bestätigt neu. Ein nicht verschlüsselbarer Pin gilt nur bis zum Prozessende
    // ([unsecured]), nie im Klartext auf der Platte.
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
    // Neuer TLS-Kontext, leerer Verbindungsvorrat: Eine wiederverwendete oder
    // wiederaufgenommene Verbindung prüfte den Pin aus dem Code nie.
    fun holdBefore(schluessel: String, fingerabdruck: String) {
        retained[schluessel] = fingerabdruck
        userCaListener.forEach { it() }
    }
    override fun fromCode(schluessel: String): Boolean = retained.containsKey(schluessel)
    fun forgetRetained(schluessel: String) { retained.remove(schluessel) }
    private val retained = ConcurrentHashMap<String, String>()
    private val unsecured = ConcurrentHashMap<String, String>()

    /**
     * Geldwerte im Startbildschirm-Widget zeigen? Je Gerät, Vorgabe aus: Das Widget
     * ist ohne Entsperren für jeden lesbar, der das Telefon sieht.
     */
    override fun showWidgetValues(): Boolean = designMirror.getBoolean(WIDGET_VALUES, false)
    override fun showSetWidgetValues(an: Boolean) {
        designMirror.edit { putBoolean(WIDGET_VALUES, an) }
    }

    // Unter dem Schlüssel der Angaben: Gesperrt liest niemand die Zahlen aus der Datei. Das Widget
    // zeigt dann „leer“ und zeichnet nach dem Entsperren neu (BrickInventoryApp). Ein Stand unter
    // dem früheren Schlüssel gilt als leer; der nächste Abruf ersetzt ihn.
    override fun widgetStatus(): String? =
        designMirror.getString(WIDGET_STATUS, null)?.let { (openDetail(it, WIDGET_STATUS) as? Tresorbefund.Readable)?.klartext }

    override fun setWidgetStatus(text: String) {
        val geheim = verschluessleDetail(text, WIDGET_STATUS) ?: return
        designMirror.edit { putString(WIDGET_STATUS, geheim) }
    }

    override fun emptyWidgetStatus() {
        designMirror.edit { remove(WIDGET_STATUS) }
    }

    /** Material You statt der Farben des Designs; je Gerät, wirkt ab Android 12. */
    override fun systemfarben(): Boolean = designMirror.getBoolean(SYSTEMFARBEN, false)
    override fun setzeSystemfarben(an: Boolean) {
        designMirror.edit { putBoolean(SYSTEMFARBEN, an) }
    }

    /**
     * Kein Vorschaubild in der App-Übersicht, keine Bildschirmfotos; je Gerät. Vorgabe
     * an: Die Übersicht zeigt Bestand, Preise und Konto jedem, der das Telefon kurz
     * in der Hand hat. Wer Bildschirmfotos braucht, schaltet es aus.
     */
    override fun hidePreview(): Boolean = designMirror.getBoolean(PREVIEW_HIDE, true)
    override fun setzeVorschauVerbergen(an: Boolean) {
        designMirror.edit { putBoolean(PREVIEW_HIDE, an) }
    }

    /**
     * Server, an denen eine nachgeholte Abmeldung endgültig scheiterte. Die Meldung
     * des Arbeiters kann abgeschaltet sein; die App sagt es darum beim nächsten Start
     * noch einmal (AppViewModel), danach ist die Liste leer.
     */
    // Die Adressen verschlüsselt wie die Angaben; eine Liste früherer Fassungen kommt dabei mit.
    // Gesperrt geht der Eintrag verloren, die Meldung des Arbeiters steht trotzdem da.
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
