package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.Auftrag
import ch.brickinventoryapp.vertrag.AuftraegeResponse
import ch.brickinventoryapp.model.ui.model.AuftragAnsicht
import ch.brickinventoryapp.model.ui.model.AuftragStatus
import ch.brickinventoryapp.model.ui.model.AuftragsPauseAnsicht
import ch.brickinventoryapp.model.ui.model.HintergrundAnsicht

fun Auftrag.alsAnsicht() = AuftragAnsicht(
    id = id, art = art, status = AuftragStatus.aus(status),
    versuch = versuche, maxVersuche = maxVersuche, geplant = geplant, faelligAb = faelligAb,
    fortschrittText = fortschritt?.let { f ->
        listOfNotNull(
            if (f.erledigt != null && f.gesamt != null) "${f.erledigt}/${f.gesamt}" else null,
            f.text?.takeIf { it.isNotBlank() },
        ).joinToString(" · ").ifBlank { null }
    },
    fehler = fehler?.takeIf { it.isNotBlank() }, setNumber = setNumber,
)

fun AuftraegeResponse.alsAnsicht() = HintergrundAnsicht(
    auftraege = auftraege.map { it.alsAnsicht() },
    pausen = pausen.map { AuftragsPauseAnsicht(it.art, it.bis, it.grund.orEmpty()) },
    bildbedarf = bildbedarf,
    jobProzessLaeuft = jobProzess.laeuft,
)
