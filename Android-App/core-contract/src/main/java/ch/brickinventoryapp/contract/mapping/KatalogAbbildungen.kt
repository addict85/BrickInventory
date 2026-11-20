package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.CatalogTheme
import ch.brickinventoryapp.contract.JahrAnzahl
import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.KatalogSetAnsicht
import ch.brickinventoryapp.model.domain.CatalogThemeView

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

fun CatalogSetDetail.alsAnsicht() = CatalogDetailView(
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

fun CatalogTheme.alsAnsicht() = CatalogThemeView(
    id = id,
    name = name,
    setCount = setCount,
)
