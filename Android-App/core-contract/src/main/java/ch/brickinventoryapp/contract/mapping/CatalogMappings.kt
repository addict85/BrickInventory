package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.CatalogSetDetail
import ch.brickinventoryapp.contract.CatalogSetItem
import ch.brickinventoryapp.contract.CatalogTheme
import ch.brickinventoryapp.contract.JahrAnzahl
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogThemeView

fun CatalogSetItem.asView() = CatalogSetView(
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

fun CatalogSetDetail.asView() = CatalogDetailView(
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
    bricklink = bricklink?.asView(),
    priceComparisonUrl = preisvergleichUrl,
)

fun JahrAnzahl.asView() = YearCountView(
    year = year,
    n = n,
)

fun CatalogTheme.asView() = CatalogThemeView(
    id = id,
    name = name,
    setCount = setCount,
)
