package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand

/** Was die Einstellungen und ihre Unterseiten am Konto ändern; die Karten kennen nur diese Schnittstelle. */
interface EinstellungenAktionen {
    fun saveSettings(currency: Waehrung, condition: Zustand)
    fun saveUserDefaultCondition(condition: Zustand?)
    fun ladeAlarmUebersicht()
    fun aendereAlarmSchwelle(setNumber: String, condition: Zustand, richtung: String, schwelle: Double)
    fun setzeAlarmSchwelle(setNumber: String, condition: Zustand, richtung: String, roh: String)
    fun loescheAlarm(setNumber: String, condition: Zustand)
    /** Einen Alarm anlegen wie in der Web-App: Setnummer, Zustand, Richtung und Schwelle (roh). */
    fun legeAlarmAn(setNumber: String, condition: Zustand, richtung: String, roh: String)
    fun ladeEigeneLagerorte()
    fun legeLagerortAn(name: String)
    fun benenneLagerortUm(id: Int, name: String)
    fun schalteLagerortVorgabe(id: Int, istVorgabe: Boolean)
    fun loescheLagerort(id: Int)
}
