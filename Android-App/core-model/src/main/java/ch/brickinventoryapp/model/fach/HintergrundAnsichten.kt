package ch.brickinventoryapp.model.fach

/** Zustand eines Auftrags; was der Server neu einführt, landet bei UNBEKANNT statt zu brechen. */

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
 * Ein Auftrag, wie die Liste ihn zeigt: Was man mit ihm tun darf, ist schon
 * entschieden — dieselbe Regel wie der Server (abbrechen nur offen/läuft,
 * wiederholen nur Fehler/abgebrochen), damit kein Knopf sicher in ein 409 führt.
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
    /** False: Kein Job-Prozess meldet sich — dann bewegt sich keiner der Aufträge. */
    val jobProcessRunning: Boolean,
)
