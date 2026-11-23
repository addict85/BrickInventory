package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.PartView
import java.text.Collator
import java.util.Locale

/**
 * The same keys as the server (`teileListe.ts`, ordnungSql), so that the store sorts the same
 * way as the web app without network. The last key makes the order unambiguous.
 */
internal fun sorted(parts: List<PartView>, order: PartsFilter.Order): List<PartView> {
    val text = nullsLast<String>(Collator.getInstance(Locale.GERMAN))
    val color = compareBy<PartView, String?>(text) { it.colorName }
    val name = compareBy<PartView, String?>(text) { it.partName }
    val number = compareBy<PartView> { it.partNumber }.thenBy { it.colorId }
    return parts.sortedWith(when (order) {
        PartsFilter.Order.COLOR -> color.then(name).then(number)
        PartsFilter.Order.NAME -> name.then(color).then(number)
        PartsFilter.Order.QUANTITY -> compareByDescending<PartView> { it.totalQuantity }.then(name).then(number)
    })
}
