package ch.brickinventoryapp.management

import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions

/** Actions that do nothing; a test only overrides what it counts. */
open class SilentActions : MonitoringActions {
    override fun refresh() = Unit
    override fun showQueue() = Unit
    override fun chooseLog(minutes: Int) = Unit
    override fun retry(setNumber: String) = Unit
    override fun remove(setNumber: String) = Unit
    override fun launch(job: Jobstart) = Unit
    override fun setSchedule(name: String, time: String?, minutes: Int?) = Unit
    override fun cancelJob(id: String) = Unit
    override fun retryJob(id: String) = Unit
    override fun jobKindStart(kind: String, name: String) = Unit
    override fun clearJobKind(kind: String) = Unit
}
