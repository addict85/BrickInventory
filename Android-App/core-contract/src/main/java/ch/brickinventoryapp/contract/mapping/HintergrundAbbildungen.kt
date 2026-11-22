package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.Auftrag
import ch.brickinventoryapp.contract.AuftraegeResponse
import ch.brickinventoryapp.model.domain.JobView
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.domain.JobPauseView
import ch.brickinventoryapp.model.domain.BackgroundView

fun Auftrag.alsAnsicht() = JobView(
    id = id, art = type, status = JobStatus.aus(status),
    attempt = attempts, maxVersuche = maxAttempts, geplant = geplant, dueAb = dueAt,
    progressText = progress?.let { f ->
        listOfNotNull(
            if (f.erledigt != null && f.gesamt != null) "${f.erledigt}/${f.gesamt}" else null,
            f.text?.takeIf { it.isNotBlank() },
        ).joinToString(" · ").ifBlank { null }
    },
    fehler = errorMessage?.takeIf { it.isNotBlank() }, setNumber = setNumber,
)

fun AuftraegeResponse.alsAnsicht() = BackgroundView(
    auftraege = auftraege.map { it.alsAnsicht() },
    pausen = pausen.map { JobPauseView(it.type, it.untilAt, it.reason.orEmpty()) },
    bildbedarf = bildbedarf,
    jobProcessRunning = jobProzess.laeuft,
)
