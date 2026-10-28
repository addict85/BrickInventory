package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/*
 * Die Zustandsklassen liegen je Bereich in ui/Zustand*.kt; hier die der
 * Sitzung. AppUiState ist der Haupt-Zustand; was sich oft ändert (CSV-Import,
 * Set-Detail, Meldungen), hat eigene Flüsse, damit nicht alle
 * AppUiState-Konsumenten neu zeichnen.
 */

/**
 * Was die ganze App über die Sitzung weiss — gehalten von [Sitzung], gelesen
 * von jedem Bildschirm. Anmeldeformular, Kontofilter und Haushaltskonten stehen
 * nicht mehr hier, sondern bei dem, der sie verantwortet (AnmeldeUiState,
 * BlickfeldUiState).
 */
data class AppUiState(
    val serverUrl: String = "",
    val isLoggedIn: Boolean = false,
    val isAdmin: Boolean = false,
    // `username` stand hier und wurde aus den Einstellungen gefuellt — gelesen
    // hat es niemand. Was die Oberflaeche zeigt, ist `HouseholdMember.username`
    // aus der Haushalts-Antwort, ein anderer Wert. Gefunden von der Regel
    // „kein Zustandsfeld wird geschrieben, ohne je gelesen zu werden"
    // (UiStateFieldsTest).
    val authToken: String = "",
    val currency: String = "EUR",
    val priceCondition: String = "N",
    val defaultPriceCondition: String = "N", // server-side default condition for new items (N=New, U=Used)
    val userDefaultCondition: String? = null, // null = use global default
    val appTheme: String = "classic", // global vom Admin gewähltes App-Design
    /**
     * Startzustand des Servers, solange er nicht `ready` meldet; sonst null.
     *
     * ── Warum das im Zustand steht (Nachtrag 136) ───────────────────────────
     *
     * Der erste Start einer Neuinstallation dauert viele Minuten — der Server
     * holt den Katalog. Die App zeigte in dieser Zeit ihre allgemeine
     * Netzmeldung; wer seinen Server frisch aufsetzt, haelt dann App oder
     * Server fuer kaputt. Die Webapp zeigt seit jeher einen Fortschrittsbalken
     * (public/js/01-core.js).
     *
     * `null` heisst „nichts Besonderes" — entweder ist der Server durch, oder
     * er ist gar nicht erreichbar. Nur wenn er ANTWORTET und `ready` falsch
     * meldet, steht hier etwas, und nur dann zeigt die Anmeldung den Balken
     * statt des Formulars.
     */
    val startupStatus: ch.brickinventoryapp.data.model.StartupStatus? = null,
    val language: String = "system",
)

/** Kontofilter und Haushaltskonten — gehalten von [Blickfeld]. */
data class BlickfeldUiState(
    /**
     * Kontofilter JE ANSICHT (Schlüssel aus ScopeFilter.View).
     *
     * Der Wert reist als `accounts=` mit und wird ausschliesslich auf dem
     * Server in Konto-IDs übersetzt — dadurch kennt ihn jede Zahl derselben
     * Antwort: Liste, Gesamtzahl, Kennzahlen und Summen.
     */
    val scopeModes: Map<String, String> = emptyMap(),
    /**
     * Konten des Haushalts, eigenes zuerst. Mehr als einer heisst: Hauptkonto
     * mit Unterkonten — erst dann erscheinen Kontofilter, Kontoauswahl beim
     * Erfassen und der Verschieben-Weg.
     */
    val householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList(),
)

/**
 * Lagerortfilter — eigener Fluss, nicht Teil von AppUiState.
 *
 * ── Warum nicht neben scopeModes (Nachtrag 176) ─────────────────────────────
 *
 * Der erste Entwurf legte beide Felder in AppUiState, direkt neben
 * `scopeModes`. ZustandsflussBreiteTest hat das abgelehnt, und zwar mit der
 * richtigen Frage: „Gehoert es wirklich allen — oder ist es der Anfang der
 * naechsten Domaene?"
 *
 * Die Antwort ist: der naechsten Domaene. AppUiState wird von SECHZEHN
 * Dateien gesammelt, und in Compose rekomponiert ein Sammler bei JEDER
 * Aenderung seines Flusses — egal welches Feld sich geaendert hat. Die Liste
 * der Lagerorte laedt bei jeder Anmeldung und nach jedem Eintragen neu; sie
 * wird von ZWEIEN gelesen (Galerie und Teile). Vierzehn Bildschirme
 * mitzuziehen, die den Lagerort nie anfassen, waere genau der Fehler, gegen
 * den jene Pruefung gebaut ist.
 *
 * `scopeModes` steht weiterhin in AppUiState — der Kontofilter wird von vier
 * Ansichten gelesen UND beim Erfassen gebraucht. Das ist der Unterschied.
 */
data class LagerUiState(
    /** Gewaehlter Lagerort JE ANSICHT — leer heisst „nicht gefiltert". */
    val modi: Map<String, String> = emptyMap(),
    /** Die belegten Lagerorte im Blickfeld — speist den FILTER. */
    val orte: List<ch.brickinventoryapp.data.model.Lagerort> = emptyList(),
    /**
     * Der VORRAT fuer das gerade offene Detail — was zur WAHL steht.
     *
     * Nicht dasselbe wie [orte]: Dort stehen die belegten Orte des Blickfelds,
     * hier die waehlbaren Orte des BESITZERS. Ein frisch angelegter Ort ist
     * waehlbar und leer, und beim Set des Enkels gehoeren die Regale des
     * Enkels zur Wahl (Marcos Festlegung).
     */
    val vorrat: List<ch.brickinventoryapp.data.model.LagerortEintrag> = emptyList(),
    /** Die EIGENEN Orte — fuer die Verwaltung in den Einstellungen. */
    val eigene: List<ch.brickinventoryapp.data.model.LagerortEintrag> = emptyList(),
    /**
     * Der Ort, der beim Erfassen schon dasteht — Marcos Stern.
     *
     * „Weiter moechte ich ein Lagerort in den Einstellungen als Default setzen
     *  koennen. Der soll dann bei einer Neuerfassung bereits vorausgewaehlt
     *  sein."
     *
     * `null` heisst: keine Vorgabe, die Erfassungsfelder bleiben leer wie
     * bisher. Er kommt mit [eigene] aus derselben Antwort — der Vorrat und
     * sein Stern sind eine Auskunft, nicht zwei.
     */
    val vorgabe: ch.brickinventoryapp.data.model.LagerortEintrag? = null,
)

/**
 * Welches Set eine angetippte Preisalarm-Meldung oeffnen soll.
 *
 * Eigener Fluss und nicht ein Feld in AppUiState: Er wird genau zweimal
 * angefasst — von der Activity beim Eintreffen des Intents und vom NavHost
 * beim Quittieren. Ein Feld im Haupt-Zustand rekomponierte dafuer den ganzen
 * Baum, und zwar bei JEDER anderen Aenderung gleich mit.
 *
 * `null` heisst „nichts offen". Quittiert wird SOFORT nach dem Navigieren,
 * sonst spraenge die App bei der naechsten Rekomposition erneut ins Detail —
 * dieselbe Regel wie bei manuelleErfassungAnfordern (BarcodeFeature).
 */
data class MeldungsZielUiState(
    val setNummer: String? = null,
)

/**
 * Welches der drei Formulare der Anmeldebildschirm gerade zeigt.
 *
 * Dieselben drei wie in der Webapp (`showPanel` in public/js/01-core.js):
 * anmelden, ein Konto anlegen, einen Link zum Zuruecksetzen anfordern.
 */
enum class AnmeldeFormular { ANMELDEN, REGISTRIEREN, PASSWORT_VERGESSEN }

/**
 * Konto anlegen und „Passwort vergessen" — ein eigener Zustand.
 *
 * ── Warum nicht in AppUiState (Nachtrag 126) ────────────────────────────────
 *
 * Dort standen diese fuenf Felder zuerst, und ZustandsflussBreiteTest hat es
 * gemeldet: „AppUiState hat 20 Felder (erlaubt: 15). Gehoert es wirklich allen
 * — oder ist es der Anfang der naechsten Domaene?" Es ist der Anfang der
 * naechsten Domaene. Sechzehn Dateien sammeln AppUiState ein; keine davon
 * ausser dem Anmeldebildschirm liest je, welches Formular gerade offen ist.
 *
 * Die Anmeldung SELBST bleibt drueben (`loginLaeuft`, `loginError`,
 * `isLoggedIn`): An ihr haengt, ob die App ueberhaupt etwas zeigt. Was hier
 * steht, sind die beiden Wege DANEBEN — ein Konto anlegen und einen Link
 * anfordern. Beide enden nicht in einer Anmeldung, sondern in einem Satz des
 * Servers.
 */
data class AnmeldeUiState(
    /**
     * Welches der drei Formulare der Anmeldebildschirm gerade zeigt.
     *
     * Genau wie in der Webapp, wo `showPanel('login'|'register'|'forgot')`
     * zwischen denselben drei umschaltet. Ein eigener Navigationseintrag waere
     * die zweite Wahrheit: Der Zurueck-Knopf des Geraets muesste dann etwas
     * anderes bedeuten als das „Zurueck zur Anmeldung" im Formular.
     */
    val formular: AnmeldeFormular = AnmeldeFormular.ANMELDEN,
    /**
     * Steht die Registrierung offen? `null` = noch nicht gefragt.
     *
     * Der Unterschied traegt: Bei `null` zeigt der Bildschirm den Link NICHT —
     * und bei `false` auch nicht. Ein Knopf, der erst erscheint und beim
     * Antippen an einem 403 scheitert, ist schlechter als keiner. Der Server
     * kann Registrierungen global abschalten (registration_enabled), und die
     * Webapp blendet den Link genau so aus.
     */
    val registrierungOffen: Boolean? = null,
    /**
     * Die Antwort auf Registrieren oder „Passwort vergessen" — der SATZ DES
     * SERVERS, nicht ein eigener.
     *
     * Bei „Passwort vergessen" ist das wesentlich: Der Server antwortet
     * absichtlich immer gleich („Falls die E-Mail existiert …"), damit das
     * Formular nicht verraet, wer hier ein Konto hat. Wuerde die App daraus
     * eine eigene Erfolgsmeldung machen, waere die Vorsicht des Servers
     * umsonst.
     */
    val meldung: String? = null,
    val fehler: String? = null,
    val laeuft: Boolean = false,
    /** Der Server verlangt beim Anmelden den Code des zweiten Faktors. */
    val codeNoetig: Boolean = false,
    /** Läuft die ANMELDUNG (nicht Registrieren oder „Passwort vergessen")? */
    val loginLaeuft: Boolean = false,
    /**
     * Fehler des Anmeldeformulars. Bleibt stehen, solange man das Passwort
     * korrigiert — flüchtige Meldungen gehen in den Meldungskanal.
     */
    val loginError: String? = null,
)
