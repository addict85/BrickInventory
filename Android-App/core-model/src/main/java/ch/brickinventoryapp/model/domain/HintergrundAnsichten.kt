package ch.brickinventoryapp.model.domain

/** State of a job; whatever the server newly introduces lands at UNBEKANNT instead of breaking. */

enum class JobStatus {
    OFFEN, LAEUFT, FEHLER, ABGEBROCHEN, DONE, UNBEKANNT;

    companion object {
        fun aus(s: String) = when (s) {
            "offen" -> OFFEN; "laeuft" -> LAEUFT; "fehler" -> FEHLER
            "abgebrochen" -> ABGEBROCHEN; "erledigt" -> DONE; else -> UNBEKANNT
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
    val art: String,
    val status: JobStatus,
    val attempt: Int,
    val maxVersuche: Int,
    val geplant: Boolean,
    val dueAb: String?,
    val progressText: String?,
    val fehler: String?,
    val setNumber: String?,
) {
    val abbrechbar: Boolean get() = status == JobStatus.OFFEN || status == JobStatus.LAEUFT
    val retryable: Boolean get() = status == JobStatus.FEHLER || status == JobStatus.ABGEBROCHEN
}

data class JobPauseView(val art: String, val bis: String?, val grund: String)

data class BackgroundView(
    val auftraege: List<JobView>,
    val pausen: List<JobPauseView>,
    val bildbedarf: Int,
    /** False: no job process reports — then none of the jobs moves. */
    val jobProcessRunning: Boolean,
)
