package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.offline.OfflineStore.Effect
import ch.brickinventoryapp.offline.OfflineStore.FollowUp

/**
 * How an edit changes the local list before the server has seen
 * it. Deliberately simple: what the server calculates for it (prices, names) comes with
 * the next sync; until then what counts is that quantity and entry are visible.
 */
internal object LocalApplication {

    fun sets(list: List<SetView>, b: Effect): List<SetView> = when (b) {
        is Editing.SetQuantity -> list.mapNotNull {
            if (it.setNumber != b.setNumber) it
            else (it.quantity + b.step).takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is Editing.RecordSet -> recorded(list, b)
        is FollowUp.WantedItemAdopted -> sets(list, Editing.RecordSet(b.wish))
        is FollowUp.SetQuantitySet -> list.mapNotNull {
            if (it.setNumber != b.setNumber) it else b.quantity.takeIf { m -> m > 0 }?.let { m -> it.copy(quantity = m) }
        }
        is FollowUp.SetLocation -> list.map { if (it.setNumber == b.setNumber) it.copy(storage = b.location?.ifBlank { null }) else it }
        is FollowUp.SetRemoved -> list.filterNot { it.setNumber == b.setNumber }
        is FollowUp.SetMoved -> list.map { if (it.setNumber == b.setNumber) moved(it, b) else it }
        is FollowUp.SetSummary -> list.map { if (it.setNumber == b.agg.setNumber) summarized(it, b) else it }
        is FollowUp.LocationRenamed -> list.map { if (b.old.isNotBlank() && it.storage == b.old) it.copy(storage = b.newValue.name) else it }
        is Editing.CreateWantedItem, is Editing.DeleteWantedItem, is Editing.RecordPart,
        is Editing.EditPart, is Editing.DeletePart, is Editing.RecordFigure, is Editing.EditFigure,
        is Editing.DeleteFigure, is FollowUp.WantedItemMoved, is FollowUp.PartLocation, is FollowUp.PartColor,
        is FollowUp.MinifigLocation, is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault,
        is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> list
    }

    private fun recorded(list: List<SetView>, b: Editing.RecordSet): List<SetView> {
        val a = b.wish
        if (list.none { it.setNumber == a.setNumber })
            return listOf(SetView(setNumber = a.setNumber, quantity = a.quantity, condition = a.condition, storage = a.storageLocation)) + list
        return list.map { if (it.setNumber == a.setNumber) it.copy(quantity = it.quantity + a.quantity) else it }
    }

    /** The summary is complete: a price null means „none recorded“, not „unknown“;
     * otherwise the stored one would still apply after deleting the last purchase. */
    private fun summarized(s: SetView, b: FollowUp.SetSummary): SetView {
        val agg = b.agg
        return s.copy(condition = agg.condition, conditions = agg.states, usedCount = agg.used,
            maxPurchasePrice = agg.highestPurchasePrice, avgPurchasePrice = agg.purchasePriceCut)
    }

    /** The name of the new owner is known only to the next sync; until then the number without a name. */
    private fun moved(s: SetView, b: FollowUp.SetMoved): SetView {
        if (s.owners.isEmpty()) return s
        val without = if (b.all) s.owners.filterNot { it.id == b.of } else s.owners
        return s.copy(owners = if (without.any { it.id == b.too }) without else without + AccountView(id = b.too))
    }

    fun wantedList(list: List<WantedItemView>, b: Effect): List<WantedItemView> = when (b) {
        is Editing.CreateWantedItem -> {
            val a = b.wish
            val newValue = WantedItemView(setNumber = a.setNumber, condition = a.condition, userId = a.owner ?: 0)
            if (list.any { rememberKey(it) == rememberKey(newValue) }) list else listOf(newValue) + list
        }
        is Editing.DeleteWantedItem -> list.filterNot {
            it.setNumber == b.setNumber && it.condition == b.condition && (b.owner == null || it.userId == b.owner)
        }
        is FollowUp.WantedItemAdopted -> wantedList(list, Editing.DeleteWantedItem(b.setNumber, b.condition, b.owner))
        is FollowUp.WantedItemMoved -> {
            val target = rememberKey(WantedItemView(setNumber = b.setNumber, condition = b.condition, userId = b.too))
            // If the target already had the item, the server merges: one remains.
            val present = list.any { rememberKey(it) == target }
            list.mapNotNull {
                if (it.setNumber != b.setNumber || it.condition != b.condition || it.userId != b.of) it
                else if (present) null else it.copy(userId = b.too)
            }
        }
        is Editing.SetQuantity, is Editing.RecordSet, is Editing.RecordPart, is Editing.EditPart,
        is Editing.DeletePart, is Editing.RecordFigure, is Editing.EditFigure, is Editing.DeleteFigure,
        is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation,
        is FollowUp.LocationRenamed, is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault,
        is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> list
    }

    fun manualParts(list: List<ManualPartView>, b: Effect): List<ManualPartView> = when (b) {
        is Editing.RecordPart -> partRecorded(list, b)
        is Editing.EditPart -> list.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId && (b.owner == null || it.userId == b.owner))
                it.copy(quantity = newQuantity(it.quantity, b.change), unitPrice = b.change.unitPrice ?: it.unitPrice)
            else it
        }
        is Editing.DeletePart -> list.filterNot {
            it.partNumber == b.partNumber && it.colorId == b.colorId && (b.owner == null || it.userId == b.owner)
        }
        is FollowUp.PartLocation -> list.map {
            if (it.partNumber == b.partNumber && it.colorId == b.colorId) it.copy(storage = b.location?.ifBlank { null }) else it
        }
        is FollowUp.PartColor -> recolored(list, b)
        is FollowUp.LocationRenamed -> list.map { if (b.old.isNotBlank() && it.storage == b.old) it.copy(storage = b.newValue.name) else it }
        is Editing.SetQuantity, is Editing.RecordSet, is Editing.CreateWantedItem,
        is Editing.DeleteWantedItem, is Editing.RecordFigure, is Editing.EditFigure,
        is Editing.DeleteFigure, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved,
        is FollowUp.SetMoved, is FollowUp.SetSummary, is FollowUp.WantedItemMoved,
        is FollowUp.WantedItemAdopted, is FollowUp.MinifigLocation, is FollowUp.LocationCreated,
        is FollowUp.LocationDeleted, is FollowUp.LocationDefault, is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> list
    }

    private fun partRecorded(list: List<ManualPartView>, b: Editing.RecordPart): List<ManualPartView> {
        val a = b.entry
        fun equal(p: ManualPartView) = p.partNumber == a.number && p.colorId == a.colorId
        if (list.none(::equal))
            return listOf(ManualPartView(partNumber = a.number, colorId = a.colorId, colorName = a.colorName,
                colorHex = a.colorHex, quantity = a.quantity, unitPrice = a.unitPrice, condition = a.condition,
                userId = a.owner, storage = a.storageLocation)) + list
        return list.map { if (equal(it)) it.copy(quantity = it.quantity + a.quantity) else it }
    }

    private fun recolored(list: List<ManualPartView>, b: FollowUp.PartColor): List<ManualPartView> {
        fun meant(p: ManualPartView, color: Int) =
            p.partNumber == b.partNumber && p.colorId == color && (b.owner == null || p.userId == b.owner)
        val old = list.firstOrNull { meant(it, b.colorId) } ?: return list
        val target = list.firstOrNull { meant(it, b.newColor) }
        if (target != null) return list.filterNot { it === old }.map { if (it === target) it.copy(quantity = it.quantity + old.quantity) else it }
        return list.map { if (it === old) it.copy(colorId = b.newColor, colorName = b.colorName, colorHex = b.colorHex) else it }
    }

    fun manualMinifigs(list: List<ManualMinifigView>, b: Effect): List<ManualMinifigView> = when (b) {
        is Editing.RecordFigure -> {
            val a = b.entry
            if (list.any { it.figNumber == a.number })
                list.map { if (it.figNumber == a.number) it.copy(quantity = it.quantity + a.quantity) else it }
            else listOf(ManualMinifigView(figNumber = a.number, blFigNumber = a.blNumber, quantity = a.quantity,
                unitPrice = a.unitPrice, condition = a.condition, userId = a.owner, storage = a.storageLocation)) + list
        }
        is Editing.EditFigure -> list.map {
            if (it.figNumber == b.figNumber && (b.owner == null || it.userId == b.owner))
                it.copy(quantity = newQuantity(it.quantity, b.change), unitPrice = b.change.unitPrice ?: it.unitPrice)
            else it
        }
        is Editing.DeleteFigure -> list.filterNot {
            it.figNumber == b.figNumber && (b.owner == null || it.userId == b.owner)
        }
        is FollowUp.MinifigLocation -> list.map { if (it.figNumber == b.figNumber) it.copy(storage = b.location?.ifBlank { null }) else it }
        is FollowUp.LocationRenamed -> list.map { if (b.old.isNotBlank() && it.storage == b.old) it.copy(storage = b.newValue.name) else it }
        is Editing.SetQuantity, is Editing.RecordSet, is Editing.CreateWantedItem,
        is Editing.DeleteWantedItem, is Editing.RecordPart, is Editing.EditPart,
        is Editing.DeletePart, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved,
        is FollowUp.SetMoved, is FollowUp.SetSummary, is FollowUp.WantedItemMoved,
        is FollowUp.WantedItemAdopted, is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.LocationCreated,
        is FollowUp.LocationDeleted, is FollowUp.LocationDefault, is FollowUp.AlarmSet, is FollowUp.AlarmRemoved -> list
    }

    /** A set alert replaces that of the set in the same condition; new ones stand in front as at the server. */
    fun priceAlarms(list: List<PriceAlertView>, b: Effect): List<PriceAlertView> = when (b) {
        is FollowUp.AlarmSet -> {
            val old = list.firstOrNull { it.setNumber == b.alarm.setNumber && it.condition == b.alarm.condition }
            // The single route sends neither name nor image; those of the overview stay.
            val newValue = if (old == null) b.alarm else b.alarm.copy(name = b.alarm.name ?: old.name,
                imageLocal = b.alarm.imageLocal ?: old.imageLocal, imageUrl = b.alarm.imageUrl ?: old.imageUrl,
                setImgUrl = b.alarm.setImgUrl ?: old.setImgUrl)
            if (old == null) listOf(newValue) + list else list.map { if (it === old) newValue else it }
        }
        is FollowUp.AlarmRemoved -> list.filterNot { it.setNumber == b.setNumber && it.condition == b.condition }
        is Editing, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.WantedItemMoved, is FollowUp.WantedItemAdopted,
        is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation, is FollowUp.LocationRenamed,
        is FollowUp.LocationCreated, is FollowUp.LocationDeleted, is FollowUp.LocationDefault -> list
    }

    /** The supply follows creating, renaming, deleting and the star; at most one place carries it. */
    fun storageLocations(list: List<StockLocationView>, b: Effect): List<StockLocationView> = when (b) {
        is FollowUp.LocationCreated ->
            if (list.any { it.location.id == b.location.id }) list else list + StockLocationView(location = b.location, default = false)
        is FollowUp.LocationRenamed -> list.map { if (it.location.id == b.newValue.id) it.copy(location = b.newValue) else it }
        is FollowUp.LocationDeleted -> list.filterNot { it.location.id == b.id }
        is FollowUp.LocationDefault -> list.map { it.copy(default = it.location.id == b.id) }
        is Editing, is FollowUp.SetQuantitySet, is FollowUp.SetLocation, is FollowUp.SetRemoved, is FollowUp.SetMoved,
        is FollowUp.SetSummary, is FollowUp.WantedItemMoved, is FollowUp.WantedItemAdopted,
        is FollowUp.PartLocation, is FollowUp.PartColor, is FollowUp.MinifigLocation, is FollowUp.AlarmSet,
        is FollowUp.AlarmRemoved -> list
    }

    /**
     * With a step the change counts on top of what the list shows now — even
     * if a newer server response lies underneath. Without a step the quantity applies.
     */
    private fun newQuantity(previous: Int, a: QuantityChange) =
        a.step?.let { previous + it } ?: a.quantity

    fun rememberKey(m: WantedItemView) = "${m.setNumber}|${m.condition.identifier}|${m.userId}"
}
