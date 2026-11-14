package ch.brickinventoryapp.model.ui.model

// Der Katalog aller Sets.

data class KatalogSetAnsicht(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val themeId: Int? = null,
    val themeName: String? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val owned: Boolean = false,
    val ownedQuantity: Int = 0,
)

data class KatalogDetailAnsicht(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val themeId: Int? = null,
    val themeName: String? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val minifigs: Int = 0,
    val owned: Boolean = false,
    val ownedQuantity: Int = 0,
    val bricklink: BrickLinkAnsicht? = null,
    val preisvergleichUrl: String? = null,
)

data class JahrAnzahlAnsicht(
    val year: Int? = null,
    val n: Int = 0,
)

data class KatalogThemaAnsicht(
    val id: Int,
    val name: String,
    val setCount: Int = 0,
)
