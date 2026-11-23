package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.accountOptions

/**
 * How many filters currently apply — the number on the „Filter“ button. Only what
 * really narrows the list is counted; sorting has its own menu
 * with its own item (SortMenu). A remembered
 * account that no longer belongs to the household, and a location that no longer holds
 * anything, show everything anyway (the same rule as on the sheet).
 */
object FilterCount {

    fun account(members: List<MemberView>, value: String): Int {
        val possible = accountOptions(members, labelAll = "", labelOwn = "").map { it.first }
        return if (value != ScopeFilter.ALL && value in possible) 1 else 0
    }

    fun storage(locations: List<LocationView>, value: String): Int =
        if (value.isNotBlank() && locations.any { it.location == value }) 1 else 0

    fun gallery(members: List<MemberView>, account: String, locations: List<LocationView>, storage: String,
                theme: String): Int =
        account(members, account) + storage(locations, storage) + (if (theme.isNotBlank()) 1 else 0)

    fun parts(members: List<MemberView>, account: String, locations: List<LocationView>, storage: String,
              spare: SparePartChoice, color: ColorPicker, category: CategoryChoice): Int =
        account(members, account) + storage(locations, storage) + (if (spare != SparePartChoice.ALL) 1 else 0) +
            listOf(color.value, category.value).count { it != null }
}
