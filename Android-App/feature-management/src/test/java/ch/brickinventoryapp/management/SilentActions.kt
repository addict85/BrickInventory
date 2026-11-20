package ch.brickinventoryapp.management

import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions

/** Aktionen, die nichts tun; ein Test überschreibt nur, was er zählt. */
open class SilentActions : MonitoringActions {
    override fun refresh() = Unit
    override fun showQueue() = Unit
    override fun chooseLog(minuten: Int) = Unit
    override fun wiederhole(setNummer: String) = Unit
    override fun entferne(setNummer: String) = Unit
    override fun starte(job: Jobstart) = Unit
    override fun setSchedule(name: String, zeit: String?, minuten: Int?) = Unit
    override fun cancelJob(id: String) = Unit
    override fun retryJob(id: String) = Unit
    override fun auftragsArtStarten(art: String, name: String) = Unit
    override fun clearJobKind(art: String) = Unit
}
