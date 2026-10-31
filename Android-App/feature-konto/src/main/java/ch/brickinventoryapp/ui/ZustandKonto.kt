package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.*

/**
 * Das eigene Konto in den Einstellungen — eigener Zustand, weil nur ein Bildschirm
 * Profil und Passwortwechsel liest. Kein Feld „abgemeldet“: Ein Passwortwechsel
 * meldet ab, logout() setzt alle Flüsse zurück; die Erklärung geht in die
 * Snackbar, die das überlebt.
 */
data class KontoUiState(
    val laedt: Boolean = false,
    val profil: ch.brickinventoryapp.ui.model.ProfilAnsicht? = null,
    val speichert: Boolean = false,
    val meldung: String? = null,
    val fehler: String? = null,
    /** Null, solange nicht geladen oder der Server kein Design je Konto kennt. */
    val design: DesignWahl? = null,
)

/** Das Design des Kontos: wirksam, die Vorgabe des Verwalters und die eigene Wahl (null = Vorgabe). */
data class DesignWahl(val wirksam: String, val vorgabe: String, val eigenes: String?)

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
 * Die ausgestellten Zugänge dieses Kontos („Angemeldete Geräte“) — eigener Fluss:
 * nur in den Einstellungen gebraucht, mit eigenen Zwischenständen, die sonst jeden
 * Reiter neu zeichnen liessen.
 */
data class GeraeteUiState(
    val laedt: Boolean = false,
    val geraete: List<ch.brickinventoryapp.ui.model.GeraetAnsicht> = emptyList(),
    /** Meldung des Servers oder der Verbindung; null = nichts zu sagen. */
    val fehler: String? = null,
)

/** Zustand der Haushalts-Karte in den Einstellungen. */
data class HouseholdUiState(
    val isLoading: Boolean = false,
    val status: ch.brickinventoryapp.ui.model.HaushaltStatusAnsicht? = null,
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
 * Eine CSV-Datei hochladen — getrennt vom Import-Fortschritt (CsvImportUiState):
 * Das Hochladen dauert Sekunden und endet mit einer Zahl, der Import läuft danach
 * auf dem Server weiter und meldet sich über seinen Kanal. Zwei Vorgänge mit
 * verschiedener Lebensdauer teilen keinen Fortschritt.
 */
data class CsvHochladenUiState(
    val laeuft: Boolean = false,
    /** Welche Art gerade hochgeladen wird — fuer die Anzeige am richtigen Knopf. */
    val art: ch.brickinventoryapp.ui.model.CsvImportArt? = null,
    val ergebnis: ch.brickinventoryapp.ui.model.CsvErgebnisAnsicht? = null,
    val fehler: String? = null,
)

/**
 * Selbstaktualisierung aus dem GitHub-Release (util/AppUpdate.kt). „Gefunden“ und
 * „geladen“ sind zwei Felder, weil beim Start nur geprüft und nie von allein
 * geladen wird. `geprueft` unterscheidet „noch nicht nachgesehen“ von „nichts
 * Neues“, damit der Knopf eine Rückmeldung gibt.
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
     * Hat der Nutzer den Hinweis beim Start weggeklickt? Gilt für diesen App-Lauf:
     * nicht bei jedem Reiterwechsel wieder fragen, beim nächsten Start aber schon. Der
     * Punkt am Konto-Symbol bleibt stehen.
     */
    val dialogAbgelehnt: Boolean = false,
    val fehler: String? = null,
)

/**
 * Alle Preisalarme des Kontos — die Übersicht in den Einstellungen. `geladen`
 * statt nur einer leeren Liste: Sonst behauptete die Rubrik beim Aufbau kurz, es
 * gebe keine Alarme.
 */
data class AlarmUebersichtUiState(
    val alarme: List<ch.brickinventoryapp.ui.model.PreisalarmAnsicht> = emptyList(),
    val geladen: Boolean = false,
)
