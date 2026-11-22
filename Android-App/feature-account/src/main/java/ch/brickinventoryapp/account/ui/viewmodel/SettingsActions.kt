package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.LocationEntryView

/** What settings and its subpages change on the account; the cards only know this interface. */
interface SettingsActions {
    fun saveSettings(currency: CurrencyCode, condition: Condition)
    fun saveUserDefaultCondition(condition: Condition?)
    fun loadAlarmOverview()
    fun changeAlarmThreshold(setNumber: String, condition: Condition, direction: AlarmDirection, threshold: Money)
    fun setAlarmThreshold(setNumber: String, condition: Condition, direction: AlarmDirection, raw: String)
    fun deleteAlarm(setNumber: String, condition: Condition)
    /** Create an alert as in the web app: set number, condition, direction and threshold (raw). */
    fun createAlarm(setNumber: String, condition: Condition, direction: AlarmDirection, raw: String)
    fun loadOwnLocations()
    fun createLocation(name: String)
    fun renameLocation(id: Int, name: String)
    fun switchLocationDefault(id: Int, isDefault: Boolean)
    fun deleteLocation(id: Int)
    /** Delete with "Undo"; without a page that offers it, delete right away. */
    fun locationDeleteReserve(location: LocationEntryView) = deleteLocation(location.id)
}
