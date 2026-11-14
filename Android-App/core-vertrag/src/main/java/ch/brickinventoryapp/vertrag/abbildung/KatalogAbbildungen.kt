package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.CatalogSetDetail
import ch.brickinventoryapp.vertrag.CatalogSetItem
import ch.brickinventoryapp.vertrag.CatalogTheme
import ch.brickinventoryapp.vertrag.JahrAnzahl
import ch.brickinventoryapp.model.ui.model.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogSetAnsicht
import ch.brickinventoryapp.model.ui.model.KatalogThemaAnsicht

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

fun JahrAnzahl.alsAnsicht() = JahrAnzahlAnsicht(
    year = year,
    n = n,
)

fun CatalogTheme.alsAnsicht() = KatalogThemaAnsicht(
    id = id,
    name = name,
    setCount = setCount,
)
