package ch.brickinventoryapp.model.domain

/** State of a job; whatever the server newly introduces lands at UNBEKANNT instead of breaking. */

enum class JobStatus {
    OPEN, RUNNING, ERROR, CANCELLED, DONE, UNKNOWN;

    companion object {
        fun from(s: String) = when (s) {
            "offen" -> OPEN; "laeuft" -> RUNNING; "fehler" -> ERROR
            "abgebrochen" -> CANCELLED; "erledigt" -> DONE; else -> UNKNOWN
        }
    }
}

/**
 * A job as the list shows it: what one may do with it is already
 * decided — the same rule as the server (cancel only open/running,
 * retry only error/cancelled), so that no button surely leads into a 409.
 */
data class JobView(
    val id: String,
    val kind: String,
    val status: JobStatus,
    val attempt: Int,
    val maxAttempts: Int,
    val scheduled: Boolean,
    val dueFrom: String?,
    val progressText: String?,
    val error: String?,
    val setNumber: String?,
) {
    val cancellable: Boolean get() = status == JobStatus.OPEN || status == JobStatus.RUNNING
    val retryable: Boolean get() = status == JobStatus.ERROR || status == JobStatus.CANCELLED
}

data class JobPauseView(val kind: String, val until: String?, val reason: String)

data class BackgroundView(
    val jobs: List<JobView>,
    val pauses: List<JobPauseView>,
    val imageDemand: Int,
    /** False: no job process reports — then none of the jobs moves. */
    val jobProcessRunning: Boolean,
)
