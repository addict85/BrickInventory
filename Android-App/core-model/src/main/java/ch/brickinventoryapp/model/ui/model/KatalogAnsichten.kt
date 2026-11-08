package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.data.model.CatalogSetDetail
import ch.brickinventoryapp.model.data.model.CatalogSetItem
import ch.brickinventoryapp.model.data.model.CatalogTheme
import ch.brickinventoryapp.model.data.model.JahrAnzahl

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

fun CatalogSetItem.alsAnsicht() = KatalogSetAnsicht(
    setNumber = setNumber,
    name = name,
    year = year,
    themeId = themeId,
    themeName = themeName,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    owned = owned,
    ownedQuantity = ownedQuantity,
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

fun CatalogSetDetail.alsAnsicht() = KatalogDetailAnsicht(
    setNumber = setNumber,
    name = name,
    year = year,
    themeId = themeId,
    themeName = themeName,
    numParts = numParts,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    minifigs = minifigs,
    owned = owned,
    ownedQuantity = ownedQuantity,
    bricklink = bricklink?.alsAnsicht(),
    preisvergleichUrl = preisvergleichUrl,
)

data class JahrAnzahlAnsicht(
    val year: Int? = null,
    val n: Int = 0,
)

fun JahrAnzahl.alsAnsicht() = JahrAnzahlAnsicht(
    year = year,
    n = n,
)

data class KatalogThemaAnsicht(
    val id: Int,
    val name: String,
    val setCount: Int = 0,
)

fun CatalogTheme.alsAnsicht() = KatalogThemaAnsicht(
    id = id,
    name = name,
    setCount = setCount,
)
