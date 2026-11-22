package ch.brickinventoryapp.management.ui.viewmodel

/**
 * What the management page triggers. None of it waits: the ViewModel executes,
 * writes the state and reports through the app's channel, so that an action does not
 * abort when the screen goes away.
 */
interface MonitoringActions {
    fun refresh()
    fun showQueue()
    fun chooseLog(minutes: Int)
    fun retry(setNumber: String)
    fun remove(setNumber: String)
    fun launch(job: Jobstart)
    fun setSchedule(name: String, time: String? = null, minutes: Int? = null)
    fun cancelJob(id: String)
    fun retryJob(id: String)
    fun jobKindStart(kind: String, name: String)
    fun clearJobKind(kind: String)
}

/** The job cards' start buttons; each calls exactly one endpoint. */
enum class Jobstart { CSV_RECONCILE, PRICE_RUN, STOCK_IMAGES, CATALOG_IMAGES, INSTRUCTIONS }
