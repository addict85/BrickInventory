package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.Auftrag
import ch.brickinventoryapp.vertrag.AuftraegeResponse
import ch.brickinventoryapp.model.fach.AuftragAnsicht
import ch.brickinventoryapp.model.fach.AuftragStatus
import ch.brickinventoryapp.model.fach.AuftragsPauseAnsicht
import ch.brickinventoryapp.model.fach.HintergrundAnsicht

fun Auftrag.alsAnsicht() = AuftragAnsicht(
    id = id, art = type, status = AuftragStatus.aus(status),
    versuch = attempts, maxVersuche = maxAttempts, geplant = geplant, faelligAb = dueAt,
    fortschrittText = progress?.let { f ->
        listOfNotNull(
            if (f.erledigt != null && f.gesamt != null) "${f.erledigt}/${f.gesamt}" else null,
            f.text?.takeIf { it.isNotBlank() },
        ).joinToString(" · ").ifBlank { null }
    },
    fehler = errorMessage?.takeIf { it.isNotBlank() }, setNumber = setNumber,
)

fun AuftraegeResponse.alsAnsicht() = HintergrundAnsicht(
    auftraege = auftraege.map { it.alsAnsicht() },
    pausen = pausen.map { AuftragsPauseAnsicht(it.type, it.untilAt, it.reason.orEmpty()) },
    bildbedarf = bildbedarf,
    jobProzessLaeuft = jobProzess.laeuft,
)
