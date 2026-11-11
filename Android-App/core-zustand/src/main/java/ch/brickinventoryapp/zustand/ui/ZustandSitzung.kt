package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.data.model.*
import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.LagerortEintragAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.model.ui.model.StartzustandAnsicht
import ch.brickinventoryapp.model.data.ScopeFilter

/*
 * Die Zustandsklassen liegen je Bereich in ui/Zustand*.kt; hier die der
 * Sitzung. AppUiState ist der Haupt-Zustand; was sich oft ändert (CSV-Import,
 * Set-Detail, Meldungen), hat eigene Flüsse, damit nicht alle
 * AppUiState-Konsumenten neu zeichnen.
 */

/**
 * Was die ganze App über die Sitzung weiss — gehalten von [Sitzung], gelesen von
 * jedem Bildschirm. Anmeldeformular, Kontofilter und Haushaltskonten stehen bei
 * dem, der sie verantwortet (AnmeldeUiState, BlickfeldUiState).
 */
data class AppUiState(
    val serverUrl: String = "",
    val isLoggedIn: Boolean = false,
    val isAdmin: Boolean = false,
    // Kein Token hier: Ihn liest allein der Interceptor (TokenAblage); im
    // Zustand stünde er für jede Oberfläche offen, als zweite Wahrheit.
    val currency: Waehrung = Waehrung.EUR,
    val priceCondition: Zustand = Zustand.NEU,
    /** Vorgabe des Servers für neu Erfasstes. */
    val defaultPriceCondition: Zustand = Zustand.NEU,
    /** null: Das Konto übernimmt die Vorgabe des Servers. */
    val userDefaultCondition: Zustand? = null,
    val appTheme: Design = Design.VORGABE, // wirksames Design: eigenes des Kontos, sonst die Vorgabe
    /**
     * Startzustand des Servers, solange er nicht `ready` meldet; sonst null. Der erste
     * Start einer Neuinstallation dauert Minuten, und statt einer Netzmeldung zeigt
     * die Anmeldung dann einen Fortschrittsbalken wie die Webapp. null heisst: durch
     * oder gar nicht erreichbar.
     */
    val startupStatus: StartzustandAnsicht? = null,
    val language: String = "system",
)

/** Kontofilter und Haushaltskonten — gehalten von [Blickfeld]. */
data class BlickfeldUiState(
    /**
     * Kontofilter je Ansicht. Er reist als
     * `accounts=` mit und wird nur auf dem Server übersetzt, damit Liste, Gesamtzahl,
     * Kennzahlen und Summen zusammenpassen.
     */
    val scopeModes: Map<ScopeFilter.View, String> = emptyMap(),
    /**
     * Konten des Haushalts, eigenes zuerst. Mehr als einer heisst: Hauptkonto
     * mit Unterkonten — erst dann erscheinen Kontofilter, Kontoauswahl beim
     * Erfassen und der Verschieben-Weg.
     */
    val householdMembers: List<MitgliedAnsicht> = emptyList(),
)

/**
 * Lagerortfilter — eigener Fluss: AppUiState sammeln viele Bildschirme, und jede
 * Änderung zöge sie mit; die Lagerorte lesen nur Galerie und Teile. Der
 * Kontofilter bleibt in AppUiState, weil ihn mehr Ansichten und das Erfassen
 * brauchen.
 */
data class LagerUiState(
    /** Gewaehlter Lagerort JE ANSICHT — leer heisst „nicht gefiltert". */
    val modi: Map<ScopeFilter.View, String> = emptyMap(),
    /** Die belegten Lagerorte im Blickfeld — speist den FILTER. */
    val orte: List<LagerortAnsicht> = emptyList(),
    /**
     * Der Vorrat für das gerade offene Detail — was zur Wahl steht. Nicht [orte]
     * (belegte Orte des Blickfelds), sondern die wählbaren Orte des Besitzers; beim
     * Set des Enkels die seinen.
     */
    val vorrat: List<LagerortEintragAnsicht> = emptyList(),
    /** Die EIGENEN Orte — fuer die Verwaltung in den Einstellungen. */
    val eigene: List<LagerortEintragAnsicht> = emptyList(),
    /**
     * Der Ort, der beim Erfassen schon dasteht (der Stern); null heisst keine Vorgabe.
     * Kommt mit [eigene] aus derselben Antwort — Vorrat und Stern sind eine Auskunft.
     */
    val vorgabe: LagerortEintragAnsicht? = null,
)

/**
 * Welches Set eine angetippte Preisalarm-Meldung öffnen soll. Eigener Fluss, weil
 * ihn nur Activity und NavHost anfassen. null heisst „nichts offen“; quittiert
 * wird sofort nach dem Navigieren, sonst spränge die App bei der nächsten
 * Rekomposition erneut ins Detail.
 */
data class MeldungsZielUiState(
    val setNummer: String? = null,
)

/**
 * Welches der drei Formulare der Anmeldebildschirm zeigt — dieselben wie in der
 * Webapp (`showPanel`).
 */
enum class AnmeldeFormular { ANMELDEN, REGISTRIEREN, PASSWORT_VERGESSEN }

/**
 * Anmelden, Konto anlegen und „Passwort vergessen“ — eigener Zustand, weil nur der
 * Anmeldebildschirm ihn liest. Ob man angemeldet ist (`isLoggedIn`), bleibt in
 * AppUiState: Daran hängt, ob die App überhaupt etwas zeigt.
 */
data class AnmeldeUiState(
    /**
     * Welches Formular offen ist — wie `showPanel` in der Webapp. Kein eigener
     * Navigationseintrag: Sonst bedeutete der Zurück-Knopf des Geräts etwas anderes
     * als „Zurück zur Anmeldung“.
     */
    val formular: AnmeldeFormular = AnmeldeFormular.ANMELDEN,
    /**
     * Steht die Registrierung offen? `null` = noch nicht gefragt; bei `null` und bei
     * `false` fehlt der Link — ein Knopf, der an einem 403 scheitert, ist schlechter
     * als keiner.
     */
    val registrierungOffen: Boolean? = null,
    /**
     * Die Antwort auf Registrieren oder „Passwort vergessen“ — der Satz des Servers.
     * Er antwortet absichtlich immer gleich, damit niemand erfährt, wer ein Konto hat;
     * eine eigene Erfolgsmeldung verriete es.
     */
    val meldung: String? = null,
    val fehler: String? = null,
    val laeuft: Boolean = false,
    /** Der Server verlangt beim Anmelden den Code des zweiten Faktors. */
    val codeNoetig: Boolean = false,
    /** Er nimmt statt des Codes auch einen Passkey (`passkey: true` in der Antwort). */
    val passkeyStattCode: Boolean = false,
    /**
     * Mit Verwalterrechten anmelden (Token-Scope "voll"). Aus, bis man es
     * ankreuzt: Ein Telefon geht leichter verloren als ein Rechner, und die
     * Verwaltung braucht man dort selten.
     */
    val vollerZugriff: Boolean = false,
    /** Läuft die ANMELDUNG (nicht Registrieren oder „Passwort vergessen")? */
    val loginLaeuft: Boolean = false,
    /**
     * Fehler des Anmeldeformulars. Bleibt stehen, solange man das Passwort
     * korrigiert — flüchtige Meldungen gehen in den Meldungskanal.
     */
    val loginError: String? = null,
    /** Der Code, den man nach einem QR-Scan im Browser eintippt; null ohne laufende Kopplung. */
    val qrBestaetigung: String? = null,
    /** Nach der Bestätigung im Browser: welches Konto auf welchem Server; der Token erst nach dem Ja. */
    val qrKonto: QrKonto? = null,
)

/** Was die App vor der Übernahme eines QR-Zugangs zeigt: Ein untergeschobener Code meldete sonst still ein fremdes Konto an. */
data class QrKonto(val benutzer: String, val server: String)
