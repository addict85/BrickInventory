package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand

// Sets und Merkposten, wie Galerie, Set-Detail und Merkliste sie zeigen.

data class SetAnsicht(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val theme: String? = null,
    val pieces: Int? = null,
    val minifigs: Int? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val addedAt: String? = null,
    val condition: Zustand? = null,
    val storage: String? = null,
    val conditions: List<Zustand> = emptyList(),
    val owners: List<KontoAnsicht> = emptyList(),
    val maxPurchasePrice: Double? = null,
    val avgPurchasePrice: Double? = null,
    val usedCount: Int? = null,
    val instructions: List<AnleitungAnsicht> = emptyList(),
    val bricklink: BrickLinkAnsicht? = null,
    val preisvergleichUrl: String? = null,
) {
    /** Der angezeigte Kaufpreis, mengengewichtet — Kachel und Detail zeigen denselben. */
    val anzeigeKaufpreis: Double? get() = avgPurchasePrice
}

data class AnleitungAnsicht(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    val localPath: String? = null,
    val isManual: Boolean = false,
)

data class BrickLinkAnsicht(
    val type: String = "SET",
    val number: String = "",
    val url: String? = null,
    val exact: Boolean = true,
    val resolved: Boolean = false,
)

data class MerkpostenAnsicht(
    val setNumber: String = "",
    val condition: Zustand = Zustand.NEU,
    val createdAt: String? = null,
    val userId: Int = 0,
    val name: String? = null,
    val year: Int? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val marktpreis: Double? = null,
    val waehrung: Waehrung = Waehrung.EUR,
    val owned: Boolean = false,
    val alarm: MerkpostenAlarmAnsicht? = null,
    val preisvergleichUrl: String? = null,
)

data class MerkpostenAlarmAnsicht(
    val richtung: Alarmrichtung = Alarmrichtung.UNTER,
    val schwelle: Double = 0.0,
    val ausgeloest: Boolean = false,
)
