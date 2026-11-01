package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.model.Auftrag
import ch.brickinventoryapp.data.model.AuftraegeResponse

/** Zustand eines Auftrags; was der Server neu einführt, landet bei UNBEKANNT statt zu brechen. */
enum class AuftragStatus {
    OFFEN, LAEUFT, FEHLER, ABGEBROCHEN, ERLEDIGT, UNBEKANNT;

    companion object {
        fun aus(s: String) = when (s) {
            "offen" -> OFFEN; "laeuft" -> LAEUFT; "fehler" -> FEHLER
            "abgebrochen" -> ABGEBROCHEN; "erledigt" -> ERLEDIGT; else -> UNBEKANNT
        }
    }
}

/**
 * Ein Auftrag, wie die Liste ihn zeigt: Was man mit ihm tun darf, ist schon
 * entschieden — dieselbe Regel wie der Server (abbrechen nur offen/läuft,
 * wiederholen nur Fehler/abgebrochen), damit kein Knopf sicher in ein 409 führt.
 */
data class AuftragAnsicht(
    val id: String,
    val art: String,
    val status: AuftragStatus,
    val versuch: Int,
    val maxVersuche: Int,
    val geplant: Boolean,
    val faelligAb: String?,
    val fortschrittText: String?,
    val fehler: String?,
    val setNumber: String?,
) {
    val abbrechbar: Boolean get() = status == AuftragStatus.OFFEN || status == AuftragStatus.LAEUFT
    val wiederholbar: Boolean get() = status == AuftragStatus.FEHLER || status == AuftragStatus.ABGEBROCHEN
}

data class AuftragsPauseAnsicht(val art: String, val bis: String?, val grund: String)

data class HintergrundAnsicht(
    val auftraege: List<AuftragAnsicht>,
    val pausen: List<AuftragsPauseAnsicht>,
    val bildbedarf: Int,
    /** False: Kein Job-Prozess meldet sich — dann bewegt sich keiner der Aufträge. */
    val jobProzessLaeuft: Boolean,
)

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
