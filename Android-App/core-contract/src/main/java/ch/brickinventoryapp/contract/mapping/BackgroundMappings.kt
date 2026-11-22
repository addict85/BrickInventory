package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.AuftraegeResponse
import ch.brickinventoryapp.contract.Auftrag
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.JobPauseView
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.domain.JobView

fun Auftrag.asView() = JobView(
    id = id, kind = type, status = JobStatus.from(status),
    attempt = attempts, maxAttempts = maxAttempts, scheduled = geplant, dueFrom = dueAt,
    progressText = progress?.let { f ->
        listOfNotNull(
            if (f.erledigt != null && f.gesamt != null) "${f.erledigt}/${f.gesamt}" else null,
            f.text?.takeIf { it.isNotBlank() },
        ).joinToString(" · ").ifBlank { null }
    },
    error = errorMessage?.takeIf { it.isNotBlank() }, setNumber = setNumber,
)

fun AuftraegeResponse.asView() = BackgroundView(
    jobs = auftraege.map { it.asView() },
    pauses = pausen.map { JobPauseView(it.type, it.untilAt, it.reason.orEmpty()) },
    imageDemand = bildbedarf,
    jobProcessRunning = jobProzess.laeuft,
)
