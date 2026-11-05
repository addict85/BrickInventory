package ch.brickinventoryapp.ui.viewmodel

/** Was die Einstellungen und ihre Unterseiten am Konto ändern; die Karten kennen nur diese Schnittstelle. */
interface EinstellungenAktionen {
    fun saveSettings(currency: String, condition: String)
    fun saveUserDefaultCondition(condition: String)
    fun ladeAlarmUebersicht()
    fun aendereAlarmSchwelle(setNumber: String, condition: String, richtung: String, schwelle: Double)
    fun setzeAlarmSchwelle(setNumber: String, condition: String, richtung: String, roh: String)
    fun loescheAlarm(setNumber: String, condition: String)
    /** Einen Alarm anlegen wie in der Web-App: Setnummer, Zustand, Richtung und Schwelle (roh). */
    fun legeAlarmAn(setNumber: String, condition: String, richtung: String, roh: String)
    fun ladeEigeneLagerorte()
    fun legeLagerortAn(name: String)
    fun benenneLagerortUm(id: Int, name: String)
    fun schalteLagerortVorgabe(id: Int, istVorgabe: Boolean)
    fun loescheLagerort(id: Int)
}
