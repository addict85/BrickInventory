package ch.brickinventoryapp.sitzung

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.StartzustandAnsicht
import ch.brickinventoryapp.model.ui.theme.Design

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
