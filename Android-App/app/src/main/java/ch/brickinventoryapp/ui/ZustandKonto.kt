package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Das eigene Konto im Einstellungs-Bildschirm — eigener Zustand.
 *
 * Aus demselben Grund wie AnmeldeUiState darunter: AppUiState steht bei 14 von
 * 15 erlaubten Feldern (ZustandsflussBreiteTest), und Profil und
 * Passwortwechsel liest genau EIN Bildschirm.
 *
 * Was hier NICHT steht, ist ein Feld „abgemeldet". Ein erfolgreicher
 * Passwortwechsel meldet die App ab — der Server verwirft dabei alle Zugaenge
 * des Kontos, auch den dieser Anfrage. Der erste Entwurf merkte sich das hier;
 * gelesen haette es nie jemand, weil logout() im selben Zug alle Fluesse
 * zuruecksetzt und der Anmeldebildschirm erscheint. Die Erklaerung dafuer geht
 * deshalb in den Snackbar, der das ueberlebt. (Gefunden von der Regel „kein
 * Feld ohne Leser".)
 */
data class KontoUiState(
    val laedt: Boolean = false,
    val profil: ch.brickinventoryapp.data.model.Profil? = null,
    val speichert: Boolean = false,
    val meldung: String? = null,
    val fehler: String? = null,
)

/** Zweiter Faktor im Konto: Stand, laufende Einrichtung, frische Codes. */
data class ZweiterFaktorUiState(
    val laedt: Boolean = false,
    /** null = noch nicht geladen. */
    val aktiv: Boolean? = null,
    val codesUebrig: Int = 0,
    /** Gesetzt während der Einrichtung, bis der erste Code bestätigt ist. */
    val geheimnis: String? = null,
    val otpauth: String? = null,
    /** Die Wiederherstellungscodes — nur unmittelbar nach dem Erzeugen. */
    val codes: List<String> = emptyList(),
    val fehler: String? = null,
)

/**
 * Die ausgestellten Zugänge dieses Kontos — „Angemeldete Geräte".
 *
 * Eigener Fluss und nicht Teil von AppUiState: Die Liste wird nur in den
 * Einstellungen gebraucht, hat eigene Zwischenstände (lädt, Fehler) und würde
 * sonst jeden Reiter neu zeichnen lassen. Dieselbe Überlegung wie bei
 * HouseholdUiState darüber.
 */
data class GeraeteUiState(
    val laedt: Boolean = false,
    val geraete: List<ch.brickinventoryapp.data.model.AppToken> = emptyList(),
    /** Meldung des Servers oder der Verbindung; null = nichts zu sagen. */
    val fehler: String? = null,
)

/** Zustand der Haushalts-Karte in den Einstellungen. */
data class HouseholdUiState(
    val isLoading: Boolean = false,
    val status: ch.brickinventoryapp.data.model.HouseholdStatusResponse? = null,
    /** Zuletzt erzeugter Einladungscode — nur bis zum Verlassen der Ansicht. */
    val inviteCode: String? = null,
    /** Meldung des Servers (Währung weicht ab, schon verknüpft, zweite Stufe). */
    val message: String? = null,
    /** Das Passwort beim Einlösen war falsch; das Feld zeigt es an. */
    val passwortFalsch: Boolean = false,
    /** Zählt gelungene Einlösungen — daran leert die Ansicht ihre Felder. */
    val eingeloest: Int = 0,
)

/**
 * Das Server-Protokoll — eigener Zustand fuer Verwalter.
 *
 * Es liest genau EIN Bildschirm, und fuer die meisten Nutzer ist es nie
 * sichtbar. In AppUiState laege es sechzehn Dateien im Weg, die es nie lesen
 * (ZustandsflussBreiteTest).
 *
 * Hier standen zusaetzlich die Felder der Nutzerverwaltung (`kontenLaden`,
 * `konten`). Sie sind auf Marcos Entscheidung entfallen — Konten verwaltet man
 * am Rechner (Nachtrag 129). Der Name der Klasse bleibt: Sie traegt, was ein
 * Verwalter in der App sieht.
 */
data class VerwaltungUiState(
    val protokollLaden: Boolean = false,
    val protokoll: List<ch.brickinventoryapp.data.model.ProtokollZeile> = emptyList(),
    /** Zeitspanne des Protokolls in Minuten — der Server begrenzt auf 2880. */
    val protokollMinuten: Int = 15,
    val fehler: String? = null,
)

/**
 * Eine CSV-Datei hochladen — eigener Zustand.
 *
 * ── Warum die App das erst jetzt kann (Nachtrag 128) ────────────────────────
 *
 * Sie hat CSV-Importe bisher nur BEOBACHTET: Der Fortschrittsbalken
 * (CsvImportUiState) haengt an einem Ereigniskanal des Servers und zeigt, was
 * jemand anderes gestartet hat — in aller Regel die Webapp. Starten konnte die
 * App keinen, und zwar aus zwei Gruenden: Es fehlte die Dateiauswahl, und die
 * drei Adressen lagen hinter einem Waechter, der nur Browser-Sitzungen kannte
 * (Nachtrag 127).
 *
 * Das hier ist der HOCHLADE-Vorgang, nicht der Import-Fortschritt. Die beiden
 * sind bewusst getrennt: Das Hochladen dauert Sekunden und endet mit einer
 * Zahl; der Import danach laeuft auf dem Server weiter und meldet sich ueber
 * den bestehenden Kanal. Sie in ein Feld zu legen hiesse, zwei Vorgaenge mit
 * verschiedener Lebensdauer denselben Fortschritt teilen zu lassen.
 */
data class CsvHochladenUiState(
    val laeuft: Boolean = false,
    /** Welche Art gerade hochgeladen wird — fuer die Anzeige am richtigen Knopf. */
    val art: ch.brickinventoryapp.data.model.CsvArt? = null,
    val ergebnis: ch.brickinventoryapp.data.model.CsvImportErgebnis? = null,
    val fehler: String? = null,
)

/**
 * CSV-Import-Fortschritt — bewusst vom Haupt-State getrennt: Während eines
 * Imports wird dieser Zustand alle 1.5s aktualisiert. Als Teil des grossen
 * AppUiState hätte jedes Update die gesamte App rekomponiert; als eigener
 * Flow rekomponiert nur die Stelle, die ihn tatsächlich sammelt (Banner).
 */
data class CsvImportUiState(
    val running: Boolean = false,
    val done: Int = 0,
    val total: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)

/**
 * Selbstaktualisierung aus dem GitHub-Release (util/AppUpdate.kt).
 *
 * ── Warum „gefunden" und „geladen" zwei Felder sind ─────────────────────────
 * Marcos Vorgabe: beim Start still PRUEFEN, aber nie von allein LADEN. Beides
 * in ein Feld zu legen hiesse, den Unterschied zu verlieren, auf dem diese
 * Vorgabe beruht — und ein Fortschrittsbalken, der bei jedem Start von selbst
 * anspringt, waere genau das, was nicht sein soll.
 *
 * `geprueft` unterscheidet „noch nicht nachgesehen" von „nachgesehen, nichts
 * Neues". Ohne das Feld saehe der Knopf in beiden Faellen gleich aus, und wer
 * ihn drueckt, bekaeme keine Rueckmeldung, dass etwas geschehen ist.
 */
data class UpdateUiState(
    val laedtPruefung: Boolean = false,
    /** Wurde in dieser Sitzung schon nachgesehen? */
    val geprueft: Boolean = false,
    /** Die neuere Fassung, oder null: es gibt keine. */
    val neuereFassung: ch.brickinventoryapp.util.UpdateBeschreibung? = null,
    /** 0..100 waehrend des Ladens, null = es laedt nichts. */
    val fortschritt: Int? = null,
    /** Das geladene APK wartet auf die Zustimmung des Nutzers. */
    val bereitZurInstallation: Boolean = false,
    /** Fehlt die Systemerlaubnis „Apps aus unbekannten Quellen"? */
    val erlaubnisFehlt: Boolean = false,
    /**
     * Hat der Nutzer den Hinweis beim Start weggeklickt?
     *
     * Gilt fuer DIESEN App-Lauf, nicht dauerhaft. Wer „Spaeter" waehlt, soll
     * nicht beim naechsten Reiterwechsel dieselbe Frage bekommen — beim
     * naechsten START aber schon wieder, sonst waere die Meldung genauso leicht
     * zu uebersehen wie der Punkt, den sie ersetzt. Der Punkt am Konto-Symbol
     * bleibt in der Zwischenzeit stehen.
     */
    val dialogAbgelehnt: Boolean = false,
    val fehler: String? = null,
)

/**
 * Alle Preisalarme des Kontos — die Uebersicht in den Einstellungen.
 *
 * Marcos Frage vom 25.09.: „Wie finde ich alle Preisalarme?" Bis dahin: gar
 * nicht. Ein Alarm war nur im Detaildialog SEINES Sets zu sehen — man musste
 * das Set also schon gefunden haben.
 *
 * `geladen` und nicht nur eine leere Liste: „noch nicht abgerufen" und „keine
 * gesetzt" sehen sonst gleich aus, und die Rubrik behauptete beim Aufbau
 * kurz, es gebe keine Alarme.
 */
data class AlarmUebersichtUiState(
    val alarme: List<ch.brickinventoryapp.data.model.Preisalarm> = emptyList(),
    val geladen: Boolean = false,
)
