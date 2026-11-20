package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.model.fach.Geld
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.LocationEntryView

/** Was die Einstellungen und ihre Unterseiten am Konto ändern; die Karten kennen nur diese Schnittstelle. */
interface EinstellungenAktionen {
    fun saveSettings(currency: Waehrung, condition: Zustand)
    fun saveUserDefaultCondition(condition: Zustand?)
    fun loadAlarmOverview()
    fun changeAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, schwelle: Geld)
    fun setAlarmThreshold(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String)
    fun deleteAlarm(setNumber: String, condition: Zustand)
    /** Einen Alarm anlegen wie in der Web-App: Setnummer, Zustand, Richtung und Schwelle (roh). */
    fun putAlarmAn(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String)
    fun loadOwnLocations()
    fun putLocationAn(name: String)
    fun nameLocationUm(id: Int, name: String)
    fun switchLocationDefault(id: Int, isDefault: Boolean)
    fun deleteLocation(id: Int)
    /** Löschen mit „Rückgängig“; ohne Seite, die es anbietet, gleich löschen. */
    fun locationDeleteReserve(ort: LocationEntryView) = deleteLocation(ort.id)
}
