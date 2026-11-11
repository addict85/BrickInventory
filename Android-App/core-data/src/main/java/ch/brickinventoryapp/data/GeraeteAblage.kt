package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import android.content.Context
import androidx.core.content.edit
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import ch.brickinventoryapp.sicherheit.Vertrauenschiffre
import ch.brickinventoryapp.model.ui.theme.helligkeitGilt
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
class GeraeteAblage @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
    private val vertrauenschiffre: Vertrauenschiffre,
) : GeraeteEinstellungen, Darstellungsablage, Netzvertrauen, Alarmablage, Entwertungsprotokoll, Sprachablage {
    companion object {
        /**
         * Der synchron lesbare Spiegel des Designs — eigene Datei, damit er
         * nichts anderes beruehrt. Warum es ihn gibt, steht bei
         * gemerktesDesign() weiter unten.
         */
        const val DESIGN_SPIEGEL_DATEI = "design_spiegel"
        const val DUNKEL_NACH_SYSTEM = "dunkel_nach_system"
        const val HELLIGKEIT = "helligkeit"
        const val APP_THEME_SPIEGEL = "app_theme"
        const val SPRACHE_SPIEGEL = "sprache"
        /** Klartext älterer Fassungen; gelesen nur noch zur einmaligen Übernahme. */
        const val NUTZER_CA = "nutzer_ca"
        const val NUTZER_CA_GEHEIM = "nutzer_ca_geheim"
        /** Gesetzt, sobald die Vorgabe „Nutzer-CAs aus“ einmal angewandt wurde. */
        const val NUTZER_CA_AUS_ANGEWANDT = "nutzer_ca_aus_angewandt"
        /** Klartext älterer Fassungen, wie [NUTZER_CA]; zugleich die Bindung des Geheimtexts. */
        const val PIN_PRAEFIX = "pin:"
        const val PIN_GEHEIM_PRAEFIX = "pin_geheim:"
        /** Gesetzt nach der Übernahme: Klartext, der danach auftaucht, wird nur noch gelöscht. */
        const val VERTRAUEN_UEBERNOMMEN = "vertrauen_uebernommen"
        private const val AN = "an"
        const val SYSTEMFARBEN = "systemfarben"
        const val VORSCHAU_VERBERGEN = "vorschau_verbergen"
        const val ENTWERTUNG_GESCHEITERT = "entwertung_gescheitert"
        const val WIDGET_WERTE = "widget_werte"

        /**
         * In welchen Netzen darf das Vorwärmen der Vorschaubilder holen? Auf dem Gerät,
         * nicht beim Konto: Am Telefon mit knappem Tarif will man es anders als am Tablet.
         * Die drei Schalter sind unabhängig, je einer für eine Lage; eine versteckte
         * Kopplung sähe aus wie ein kaputter Schalter.
         */
        val VORWAERMEN_WLAN    = booleanPreferencesKey("vorwaermen_wlan")
        val VORWAERMEN_MOBIL   = booleanPreferencesKey("vorwaermen_mobil")
        val VORWAERMEN_ROAMING = booleanPreferencesKey("vorwaermen_roaming")

        val CURRENCY     = stringPreferencesKey("currency")
        // "system" (folgt der OS-Sprache), "en" oder "de"
        val LANGUAGE     = stringPreferencesKey("language")
        /**
         * Das zuletzt bekannte Design des Servers. Gemerkt, weil /settings erst nach der
         * Anmeldung kommt und Anmelde- und Einrichtungsbildschirm sonst im Standard-Design
         * erschienen und umsprangen — Stufe eins wie in public/js/00-theme-boot.js.
         * Global, deshalb überlebt es das Abmelden.
         */
        val APP_THEME    = stringPreferencesKey("app_theme")

        /**
         * Sollen ausgelöste Preisalarme als Benachrichtigung erscheinen? Je Gerät: Mit
         * Telefon und Tablet will man die Meldung meist nur an einem. Vorgabe aus —
         * ungefragte Benachrichtigungen wären eine Überraschung, und ab Android 13 braucht
         * es ohnehin die Erlaubnis.
         */
        val ALARM_MELDUNGEN = booleanPreferencesKey("alarm_meldungen")

        /**
         * Der Zeitpunkt des letzten erfolgreichen Abrufs, als ISO-Text vom Server — nicht
         * die Uhr des Telefons, deren Abweichung über doppelte oder fehlende Meldungen
         * entschiede (siehe Alarmabholung). Text, weil nur weitergereicht wird und eine
         * Umrechnung die Zeitzone verlöre.
         */
        val ALARM_MARKE = stringPreferencesKey("alarm_marke")
    }

    val currency:  Flow<Waehrung> = dataStore.data.map { p -> p[CURRENCY]?.let { Waehrung(it) } ?: Waehrung.EUR }
    val language:  Flow<String> = dataStore.data.map { it[LANGUAGE]   ?: "system" }

    // Vorgabe: nur WLAN. Begruendung an den Schluesseln oben. `?: true` bzw.
    // `?: false` ist hier die ganze Vorgabe — ein noch nie gesetzter Wert ist
    // in DataStore schlicht nicht da.
    val vorwaermenWlan:    Flow<Boolean> = dataStore.data.map { it[VORWAERMEN_WLAN]    ?: true }
    val vorwaermenMobil:   Flow<Boolean> = dataStore.data.map { it[VORWAERMEN_MOBIL]   ?: false }
    val vorwaermenRoaming: Flow<Boolean> = dataStore.data.map { it[VORWAERMEN_ROAMING] ?: false }
    val appTheme:  Flow<Design> = dataStore.data.map { p -> Design.aus(p[APP_THEME]) ?: Design.VORGABE }

    // Vorgabe AUS — Begruendung am Schluessel oben.
    override val alarmMeldungenAn: Flow<Boolean> = dataStore.data.map { it[ALARM_MELDUNGEN] ?: false }
    /**
     * null = noch nie abgerufen: Beim allerersten Durchgang markiert Alarmabholung nur
     * und meldet nichts. Ein leerer Text brächte alles Alte auf einmal.
     */
    override val alarmMarke: Flow<String?> = dataStore.data.map { it[ALARM_MARKE] }

    // Synchron lesbarer Spiegel des Designs (SharedPreferences): setContent() läuft
    // vor dem ersten DataStore-Wert, und das erste Bild entstünde sonst im
    // Standard-Design. Der DataStore bleibt führend.
    private val designSpiegel by lazy {
        context.getSharedPreferences(DESIGN_SPIEGEL_DATEI, Context.MODE_PRIVATE)
    }

    /** Einmalig vor dem ersten Verbindungsaufbau (TokenAblage wartet darauf). */
    fun bereiteVor() {
        uebernimmAltenCaStand()
        uebernimmKlartextVertrauen()
        designSpiegel.edit { KlartextReste.SPIEGEL.forEach { remove(it) } }
    }

    private val nutzerCaHoerer = CopyOnWriteArrayList<() -> Unit>()

    /** Nach dem Umschalten der Nutzer-CAs und vor einem Pin aus dem Code: neuer TLS-Kontext, offene Verbindungen weg (di/ServerClient). */
    override fun beimNutzerCaWechsel(hoerer: () -> Unit) { nutzerCaHoerer += hoerer }

    suspend fun saveCurrency(cur: Waehrung) {
        dataStore.edit { it[CURRENCY] = cur.code }
    }
    /**
     * Eine der drei Netzerlaubnisse setzen — eine Funktion mit dem Schlüssel als
     * Argument statt dreier fast gleicher, die auseinanderlaufen könnten.
     */
    suspend fun saveVorwaermenNetz(schluessel: Preferences.Key<Boolean>, erlaubt: Boolean) {
        dataStore.edit { it[schluessel] = erlaubt }
    }

    /**
     * Die Marke fortschreiben. Leere Werte werden nicht geschrieben, sonst ginge die
     * Unterscheidung „noch nie abgerufen“ verloren.
     */
    override suspend fun setzeAlarmMarke(marke: String) {
        if (marke.isBlank()) return
        dataStore.edit { it[ALARM_MARKE] = marke }
    }

    override suspend fun setzeAlarmMeldungen(an: Boolean) {
        dataStore.edit { it[ALARM_MELDUNGEN] = an }
    }

    override fun vorwaermenErlaubt(netz: VorwaermNetz): Flow<Boolean> = when (netz) {
        VorwaermNetz.WLAN -> vorwaermenWlan
        VorwaermNetz.MOBIL -> vorwaermenMobil
        VorwaermNetz.ROAMING -> vorwaermenRoaming
    }

    override suspend fun setzeVorwaermen(netz: VorwaermNetz, erlaubt: Boolean) = saveVorwaermenNetz(
        when (netz) {
            VorwaermNetz.WLAN -> VORWAERMEN_WLAN
            VorwaermNetz.MOBIL -> VORWAERMEN_MOBIL
            VorwaermNetz.ROAMING -> VORWAERMEN_ROAMING
        },
        erlaubt,
    )

    override suspend fun saveLanguage(lang: String) {
        dataStore.edit { it[LANGUAGE] = lang }
        designSpiegel.edit { putString(SPRACHE_SPIEGEL, lang) }
    }

    /**
     * Die Sprache synchron für Application.onCreate (unter Android 13), ohne den
     * DataStore zu blockieren. null = vor dem Spiegel gespeichert; dann liest
     * [spracheNachziehen] sie einmal nach.
     */
    override fun gemerkteSprache(): String? = designSpiegel.getString(SPRACHE_SPIEGEL, null)

    override suspend fun spracheNachziehen(): String {
        val lang = language.first()
        designSpiegel.edit { putString(SPRACHE_SPIEGEL, lang) }
        return lang
    }
    suspend fun saveAppTheme(theme: Design) {
        dataStore.edit { it[APP_THEME] = theme.kennung }
        // Und in den synchron lesbaren Spiegel, siehe gemerktesDesign(). Beides an
        // EINER Stelle, damit die zwei Ablagen nicht auseinanderlaufen können.
        designSpiegel.edit { putString(APP_THEME_SPIEGEL, theme.kennung) }
    }

    /**
     * Das zuletzt bekannte Design — synchron, für den allerersten Bildaufbau. Ohne
     * Eintrag (Neuinstallation) gilt der Standard.
     */
    override fun gemerktesDesign(): Design =
        Design.aus(designSpiegel.getString(APP_THEME_SPIEGEL, null)) ?: Design.VORGABE

    /**
     * System, Hell oder Dunkel — je Gerät. Im Spiegel, weil es wie das Design schon
     * das erste Bild bestimmt; ohne neue Wahl gilt die frühere „dunkel nach System“.
     */
    override fun helligkeit(): String = helligkeitGilt(
        designSpiegel.getString(HELLIGKEIT, null),
        if (designSpiegel.contains(DUNKEL_NACH_SYSTEM)) designSpiegel.getBoolean(DUNKEL_NACH_SYSTEM, true) else null)
    override fun setzeHelligkeit(wahl: String) {
        designSpiegel.edit { putString(HELLIGKEIT, wahl) }
    }
    /**
     * Vertrauen die Clients des eigenen Servers auch nutzerinstallierten CAs
     * (util/ServerVertrauen.kt)? Je Gerät und synchron: Gefragt wird bei jedem
     * Verbindungsaufbau.
     */
    override fun nutzerCaErlaubt(): Boolean {
        uebernimmKlartextVertrauen()
        val geheim = designSpiegel.getString(NUTZER_CA_GEHEIM, null) ?: return false
        return vertrauenschiffre.entschluessle(geheim, NUTZER_CA) == AN
    }

    // Lässt sich „an“ nicht verschlüsseln, bleibt der Schalter aus: lieber erneut
    // fragen als eine Erlaubnis ablegen, die niemand prüfen kann.
    override fun setzeNutzerCa(an: Boolean) {
        uebernimmKlartextVertrauen()
        val geheim = if (an) vertrauenschiffre.verschluessle(AN, NUTZER_CA) else null
        designSpiegel.edit { if (geheim != null) putString(NUTZER_CA_GEHEIM, geheim) else remove(NUTZER_CA_GEHEIM) }
        nutzerCaHoerer.forEach { it() }
    }

    /**
     * Einmalig vor dem ersten Verbindungsaufbau (der Latch wartet darauf): Nutzer-CAs
     * aus, auch wenn sie vorher an waren. Wer sie braucht, wird beim ersten
     * TLS-Fehler gefragt (ZertifikatsFrage) — eine stille Erlaubnis aus einer
     * älteren Fassung soll nicht weiter gelten.
     */
    fun uebernimmAltenCaStand() {
        if (designSpiegel.getBoolean(NUTZER_CA_AUS_ANGEWANDT, false)) return
        designSpiegel.edit { remove(NUTZER_CA); remove(NUTZER_CA_GEHEIM); putBoolean(NUTZER_CA_AUS_ANGEWANDT, true) }
    }

    @Volatile private var vertrauenGeprueft = false

    /**
     * Klartext-Pins und -Schalter älterer Fassungen einmal verschlüsselt übernehmen und
     * löschen. Danach zeigt die Marke: Klartext, der später auftaucht, hat nicht die App
     * geschrieben und wird verworfen, nicht übernommen. Scheitert das Verschlüsseln, bleibt
     * der Klartext liegen und gilt nicht — der nächste Lesezugriff versucht es erneut.
     */
    @Synchronized
    private fun uebernimmKlartextVertrauen() {
        if (vertrauenGeprueft) return
        val alt = designSpiegel.all.filterKeys { it == NUTZER_CA || it.startsWith(PIN_PRAEFIX) }
        val neu: Map<String, String> = if (designSpiegel.getBoolean(VERTRAUEN_UEBERNOMMEN, false)) emptyMap()
            else verschluesselterAltbestand(alt) ?: return
        designSpiegel.edit {
            neu.forEach { (k, v) -> putString(k, v) }
            alt.keys.forEach { remove(it) }
            putBoolean(VERTRAUEN_UEBERNOMMEN, true)
        }
        vertrauenGeprueft = true
    }

    /** Die neuen Einträge zum Klartext; null, sobald einer sich nicht verschlüsseln lässt. */
    private fun verschluesselterAltbestand(alt: Map<String, *>): Map<String, String>? {
        val neu = mutableMapOf<String, String>()
        for ((k, v) in alt) {
            when {
                k == NUTZER_CA && v == true -> neu[NUTZER_CA_GEHEIM] = vertrauenschiffre.verschluessle(AN, NUTZER_CA) ?: return null
                k.startsWith(PIN_PRAEFIX) && v is String ->
                    neu[PIN_GEHEIM_PRAEFIX + k.removePrefix(PIN_PRAEFIX)] = vertrauenschiffre.verschluessle(v, k) ?: return null
            }
        }
        return neu
    }

    // Pins je Host und Port (util/ServerVertrauen.kt); der vorgehaltene (halteVor) geht vor.
    // Ein unlesbarer Geheimtext ist kein Pin: Die Verbindung gilt als Erstkontakt, der
    // Nutzer bestätigt neu. Ein nicht verschlüsselbarer Pin gilt nur bis zum Prozessende
    // ([ungesichert]), nie im Klartext auf der Platte.
    override fun pin(schluessel: String): String? = vorgehalten[schluessel] ?: gemerkterPin(schluessel)
    fun gemerkterPin(schluessel: String): String? {
        uebernimmKlartextVertrauen()
        ungesichert[schluessel]?.let { return it }
        val geheim = designSpiegel.getString(PIN_GEHEIM_PRAEFIX + schluessel, null) ?: return null
        return vertrauenschiffre.entschluessle(geheim, PIN_PRAEFIX + schluessel)
    }
    override fun merkePin(schluessel: String, fingerabdruck: String) {
        uebernimmKlartextVertrauen()
        val geheim = vertrauenschiffre.verschluessle(fingerabdruck, PIN_PRAEFIX + schluessel)
        if (geheim != null) {
            designSpiegel.edit { putString(PIN_GEHEIM_PRAEFIX + schluessel, geheim) }
            ungesichert.remove(schluessel)
        } else {
            ungesichert[schluessel] = fingerabdruck
        }
        vorgehalten.remove(schluessel)
    }
    // Neuer TLS-Kontext, leerer Verbindungsvorrat: Eine wiederverwendete oder
    // wiederaufgenommene Verbindung prüfte den Pin aus dem Code nie.
    fun halteVor(schluessel: String, fingerabdruck: String) {
        vorgehalten[schluessel] = fingerabdruck
        nutzerCaHoerer.forEach { it() }
    }
    override fun ausCode(schluessel: String): Boolean = vorgehalten.containsKey(schluessel)
    fun vergissVorgehaltenen(schluessel: String) { vorgehalten.remove(schluessel) }
    private val vorgehalten = ConcurrentHashMap<String, String>()
    private val ungesichert = ConcurrentHashMap<String, String>()

    /**
     * Geldwerte im Startbildschirm-Widget zeigen? Je Gerät, Vorgabe aus: Das Widget
     * ist ohne Entsperren für jeden lesbar, der das Telefon sieht.
     */
    override fun widgetWerteZeigen(): Boolean = designSpiegel.getBoolean(WIDGET_WERTE, false)
    override fun setzeWidgetWerteZeigen(an: Boolean) {
        designSpiegel.edit { putBoolean(WIDGET_WERTE, an) }
    }

    /** Material You statt der Farben des Designs; je Gerät, wirkt ab Android 12. */
    override fun systemfarben(): Boolean = designSpiegel.getBoolean(SYSTEMFARBEN, false)
    override fun setzeSystemfarben(an: Boolean) {
        designSpiegel.edit { putBoolean(SYSTEMFARBEN, an) }
    }

    /**
     * Kein Vorschaubild in der App-Übersicht, keine Bildschirmfotos; je Gerät. Vorgabe
     * an: Die Übersicht zeigt Bestand, Preise und Konto jedem, der das Telefon kurz
     * in der Hand hat. Wer Bildschirmfotos braucht, schaltet es aus.
     */
    override fun vorschauVerbergen(): Boolean = designSpiegel.getBoolean(VORSCHAU_VERBERGEN, true)
    override fun setzeVorschauVerbergen(an: Boolean) {
        designSpiegel.edit { putBoolean(VORSCHAU_VERBERGEN, an) }
    }

    /**
     * Server, an denen eine nachgeholte Abmeldung endgültig scheiterte. Die Meldung
     * des Arbeiters kann abgeschaltet sein; die App sagt es darum beim nächsten Start
     * noch einmal (AppViewModel), danach ist die Liste leer.
     */
    override fun merkeGescheiterteEntwertung(server: String) {
        designSpiegel.edit { putStringSet(ENTWERTUNG_GESCHEITERT, gescheiterteEntwertungen() + server) }
    }
    fun gescheiterteEntwertungen(): Set<String> = designSpiegel.getStringSet(ENTWERTUNG_GESCHEITERT, null).orEmpty().toSet()
    fun quittiereGescheiterteEntwertungen() {
        designSpiegel.edit { remove(ENTWERTUNG_GESCHEITERT) }
    }
}
