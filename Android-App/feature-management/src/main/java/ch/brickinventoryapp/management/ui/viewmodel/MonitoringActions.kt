package ch.brickinventoryapp.management.ui.viewmodel

/**
 * What the management page triggers. None of it waits: the ViewModel executes,
 * writes the state and reports through the app's channel, so that an action does not
 * abort when the screen goes away.
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

/** The job cards' start buttons; each calls exactly one endpoint. */
enum class Jobstart { CSV_ABGLEICH, PREISLAUF, BESTANDSBILDER, KATALOGBILDER, INSTRUCTIONS }
