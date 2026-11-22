package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.Job
import ch.brickinventoryapp.contract.JobQueueResponse
import ch.brickinventoryapp.model.domain.BackgroundView
import ch.brickinventoryapp.model.domain.JobPauseView
import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.model.domain.JobView

fun Job.asView() = JobView(
    id = id, kind = type, status = JobStatus.from(status),
    attempt = attempts, maxAttempts = maxAttempts, scheduled = scheduled, dueFrom = dueAt,
    progressText = progress?.let { f ->
        listOfNotNull(
            if (f.done != null && f.total != null) "${f.done}/${f.total}" else null,
            f.text?.takeIf { it.isNotBlank() },
        ).joinToString(" · ").ifBlank { null }
    },
    error = errorMessage?.takeIf { it.isNotBlank() }, setNumber = setNumber,
)

fun JobQueueResponse.asView() = BackgroundView(
    jobs = jobs.map { it.asView() },
    pauses = pauses.map { JobPauseView(it.type, it.untilAt, it.reason.orEmpty()) },
    imageDemand = imageDemand,
    jobProcessRunning = jobProcess.running,
)
