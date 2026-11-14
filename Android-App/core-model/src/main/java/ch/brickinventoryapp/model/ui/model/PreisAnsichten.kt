package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand

// Marktpreise und ihr Verlauf je Zustand.

data class PreisDiagrammAnsicht(
    val values: List<PreisReiheAnsicht> = emptyList(),
    val x: List<String> = emptyList(),
)

data class PreisReiheAnsicht(
    val name: String = "",
    val values: List<PreisPunktAnsicht> = emptyList(),
    val firstRealIndex: Int = 0,
)

data class PreisPunktAnsicht(
    val x: String = "",
    val y: Double = 0.0,
)

data class PreisJeZustandAnsicht(
    val new: ZustandsBewertungAnsicht? = null,
    val used: ZustandsBewertungAnsicht? = null,
) {
    /** Die Zustände, zu denen es eine Bewertung gibt, neu zuerst. */
    fun present(): List<Pair<Zustand, ZustandsBewertungAnsicht>> = buildList {
        new?.let { add(Zustand.NEU to it) }
        used?.let { add(Zustand.GEBRAUCHT to it) }
    }
}

data class ZustandsBewertungAnsicht(
    val marketPrice: Double? = null,
    val purchasePrice: Double? = null,
    val pnlPct: Double? = null,
)

data class PreisverlaufAnsicht(
    val currency: Waehrung = Waehrung.KEINE,
    val historyNew: List<PreisverlaufPunktAnsicht> = emptyList(),
    val historyUsed: List<PreisverlaufPunktAnsicht> = emptyList(),
    val byCondition: PreisJeZustandAnsicht = PreisJeZustandAnsicht(),
    val chart: PreisDiagrammAnsicht = PreisDiagrammAnsicht(),
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Double? = null,
)

data class PreisverlaufPunktAnsicht(
    val qtyAvgPrice: Double? = null,
    val avgPrice: Double? = null,
)

data class SetPreisAnsicht(
    val setNumber: String = "",
    val currency: Waehrung = Waehrung.KEINE,
    val avgPrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val noPrice: Boolean = false,
)

data class AktuellerPreisAnsicht(
    val condition: Zustand? = null,
    val avgPrice: Double? = null,
)

data class AktuellJeZustandAnsicht(
    val new: AktuellerPreisAnsicht? = null,
    val used: AktuellerPreisAnsicht? = null,
)

data class MerkpostenPreiseAnsicht(
    val currency: Waehrung = Waehrung.KEINE,
    val current: AktuellJeZustandAnsicht = AktuellJeZustandAnsicht(),
)
