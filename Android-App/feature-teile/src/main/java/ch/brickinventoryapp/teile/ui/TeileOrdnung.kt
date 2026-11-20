package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.fach.TeilAnsicht
import java.text.Collator
import java.util.Locale

/**
 * Dieselben Schlüssel wie der Server (teileListe.ts, ordnungSql), damit die Ablage ohne Netz
 * gleich sortiert wie die Webapp. Der letzte Schlüssel macht die Reihenfolge eindeutig.
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
