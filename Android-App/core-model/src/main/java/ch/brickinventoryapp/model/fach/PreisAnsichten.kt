package ch.brickinventoryapp.model.fach

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
    val preis: Geld = Geld.NULL,
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
    val marketPrice: Geld? = null,
    val purchasePrice: Geld? = null,
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
    val purchasePrice: Geld? = null,
)

data class PreisverlaufPunktAnsicht(
    val qtyAvgPrice: Geld? = null,
    val avgPrice: Geld? = null,
)

data class SetPreisAnsicht(
    val setNumber: String = "",
    val currency: Waehrung = Waehrung.KEINE,
    val avgPrice: Geld? = null,
    val qtyAvgPrice: Geld? = null,
    val noPrice: Boolean = false,
)

data class AktuellerPreisAnsicht(
    val condition: Zustand? = null,
    val avgPrice: Geld? = null,
)

data class AktuellJeZustandAnsicht(
    val new: AktuellerPreisAnsicht? = null,
    val used: AktuellerPreisAnsicht? = null,
)

data class MerkpostenPreiseAnsicht(
    val currency: Waehrung = Waehrung.KEINE,
    val current: AktuellJeZustandAnsicht = AktuellJeZustandAnsicht(),
)
