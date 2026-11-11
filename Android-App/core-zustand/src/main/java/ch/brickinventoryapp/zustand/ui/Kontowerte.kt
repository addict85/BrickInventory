package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Währung und Design des Kontos an EINER Stelle, der Ablage. Die [Sitzung] leitet
 * sie daraus ab und spiegelt nichts zurück: Zwei Wege in beide Richtungen liessen
 * einen alten Wert den neuen überschreiben.
 */
interface Kontowerte {
    val waehrung: StateFlow<Waehrung>
    val design: StateFlow<Design>
    fun setzeWaehrung(w: Waehrung)
    fun setzeDesign(d: Design)
}

/** Im Speicher: für Tests und Vorschauen ohne Ablage. */
class SpeicherKontowerte(waehrung: Waehrung = Waehrung.EUR, design: Design = Design.VORGABE) : Kontowerte {
    private val _waehrung = MutableStateFlow(waehrung)
    private val _design = MutableStateFlow(design)
    override val waehrung: StateFlow<Waehrung> = _waehrung.asStateFlow()
    override val design: StateFlow<Design> = _design.asStateFlow()
    override fun setzeWaehrung(w: Waehrung) { _waehrung.value = w }
    override fun setzeDesign(d: Design) { _design.value = d }
}

/**
 * Aus der Ablage (DataStore). Der erste Wert des Designs kommt aus dem synchronen
 * Spiegel, weil das erste Bild vor dem ersten DataStore-Wert entsteht.
 */
@Singleton
class AblageKontowerte @Inject constructor(
    private val ablage: Sitzungsablage,
    darstellung: Darstellungsablage,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : Kontowerte {
    override val waehrung: StateFlow<Waehrung> = ablage.currency.stateIn(bereich, SharingStarted.Eagerly, Waehrung.EUR)
    override val design: StateFlow<Design> =
        ablage.appTheme.stateIn(bereich, SharingStarted.Eagerly, darstellung.gemerktesDesign())

    override fun setzeWaehrung(w: Waehrung) { bereich.launch { ablage.saveCurrency(w) } }
    override fun setzeDesign(d: Design) { bereich.launch { ablage.saveAppTheme(d) } }
}
