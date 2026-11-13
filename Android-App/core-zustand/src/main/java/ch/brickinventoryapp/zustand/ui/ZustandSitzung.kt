package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.LagerortEintragAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.model.data.ScopeFilter

/*
 * Die Zustandsklassen liegen je Bereich in ui/Zustand*.kt; hier, was neben der
 * Sitzung (core-sitzung, AppUiState) gilt: Filter, Lagerorte, das Meldungsziel.
 * Was sich oft ändert, hat eigene Flüsse, damit nicht alle AppUiState-Konsumenten
 * neu zeichnen.
 */

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
