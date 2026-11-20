package ch.brickinventoryapp.verwaltung.ui.viewmodel

/**
 * Was die Verwaltungsseite auslöst. Nichts davon wartet: Das ViewModel führt aus,
 * schreibt den Zustand und meldet über den Kanal der App, damit eine Aktion nicht
 * abbricht, wenn der Bildschirm geht.
 */
interface MonitoringActions {
    fun refresh()
    fun showQueue()
    fun chooseLog(minuten: Int)
    fun wiederhole(setNummer: String)
    fun entferne(setNummer: String)
    fun starte(job: Jobstart)
    fun setSchedule(name: String, zeit: String? = null, minuten: Int? = null)
    fun cancelJob(id: String)
    fun retryJob(id: String)
    fun auftragsArtStarten(art: String, name: String)
    fun clearJobKind(art: String)
}

/** Die Startknöpfe der Job-Karten; jeder ruft genau einen Endpunkt. */
enum class Jobstart { CSV_ABGLEICH, PREISLAUF, BESTANDSBILDER, KATALOGBILDER, INSTRUCTIONS }
