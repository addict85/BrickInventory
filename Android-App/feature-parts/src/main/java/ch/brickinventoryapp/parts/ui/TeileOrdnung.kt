package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.TeilAnsicht
import java.text.Collator
import java.util.Locale

/**
 * The same keys as the server (teileListe.ts, ordnungSql), so that the store sorts the same
 * way as the web app without network. The last key makes the order unambiguous.
 */
internal fun sortiert(teile: List<TeilAnsicht>, order: Teilefilter.Order): List<TeilAnsicht> {
    val text = nullsLast<String>(Collator.getInstance(Locale.GERMAN))
    val farbe = compareBy<TeilAnsicht, String?>(text) { it.colorName }
    val name = compareBy<TeilAnsicht, String?>(text) { it.partName }
    val nummer = compareBy<TeilAnsicht> { it.partNumber }.thenBy { it.colorId }
    return teile.sortedWith(when (order) {
        Teilefilter.Order.FARBE -> farbe.then(name).then(nummer)
        Teilefilter.Order.NAME -> name.then(farbe).then(nummer)
        Teilefilter.Order.QUANTITY -> compareByDescending<TeilAnsicht> { it.totalQuantity }.then(name).then(nummer)
    })
}
