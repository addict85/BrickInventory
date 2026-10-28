package ch.brickinventoryapp.ui

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Die Sitzung der App: Server, Anmeldung, Einstellungen des Kontos.
 *
 * Ein Singleton und kein Feld eines ViewModels, weil jeder Bildschirm sie liest,
 * aber jedes Bereichs-ViewModel nur so lange lebt wie sein Ziel. Geschrieben
 * wird sie vom AppViewModel (aus den Einstellungen) und von der Anmeldung.
 */
@Singleton
class Sitzung @Inject constructor() {

    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    fun aendere(aenderung: (AppUiState) -> AppUiState) = _state.update(aenderung)

    private val _abmeldungen = MutableSharedFlow<Unit>(
        extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /**
     * Jede Abmeldung einmal. Die Bereichs-ViewModels leeren darauf ihren
     * Zustand: Ein gemerkter Reiter überlebt das Abmelden, und der nächste
     * Nutzer auf demselben Gerät sähe sonst die Daten des vorigen.
     */
    val abmeldungen: SharedFlow<Unit> = _abmeldungen.asSharedFlow()

    /** Der Server bleibt eingetragen — abgemeldet heisst nicht „anderer Server“. */
    fun abgemeldet() {
        _state.update { AppUiState(serverUrl = it.serverUrl) }
        _abmeldungen.tryEmit(Unit)
    }
}

/**
 * Ein gescheiterter QR-Anlauf, während die App schon angemeldet ist, ist kein
 * Fehler: Der Scanner löste doppelt aus, der erste Anlauf hat den einmaligen
 * Token verbraucht und angemeldet. Gibt die Meldung zurück, oder null.
 */
internal fun qrFehler(bereitsAngemeldet: Boolean, meldung: String): String? =
    if (bereitsAngemeldet) null else meldung
