package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.domain.LocationEntryView

/** What settings and its subpages change on the account; the cards only know this interface. */
interface EinstellungenAktionen {
    fun saveSettings(currency: Waehrung, condition: Zustand)
    fun saveUserDefaultCondition(condition: Zustand?)
    fun loadAlarmOverview()
    fun changeAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, schwelle: Geld)
    fun setAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String)
    fun deleteAlarm(setNumber: String, condition: Zustand)
    /** Create an alert as in the web app: set number, condition, direction and threshold (raw). */
    fun putAlarmAn(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String)
    fun loadOwnLocations()
    fun putLocationAn(name: String)
    fun nameLocationUm(id: Int, name: String)
    fun switchLocationDefault(id: Int, isDefault: Boolean)
    fun deleteLocation(id: Int)
    /** Delete with "Undo"; without a page that offers it, delete right away. */
    fun locationDeleteReserve(ort: LocationEntryView) = deleteLocation(ort.id)
}
