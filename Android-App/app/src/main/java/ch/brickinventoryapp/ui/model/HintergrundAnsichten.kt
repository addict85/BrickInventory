package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Auftrag
import ch.brickinventoryapp.data.model.AuftraegeResponse

/** Zustand eines Auftrags; was der Server neu einführt, landet bei UNBEKANNT statt zu brechen. */
enum class AuftragStatus(val text: Int?) {
    OFFEN(R.string.hintergrund_offen), LAEUFT(R.string.hintergrund_laeuft), FEHLER(R.string.hintergrund_fehler),
    ABGEBROCHEN(R.string.hintergrund_abgebrochen), ERLEDIGT(null), UNBEKANNT(null);

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
    val artText: Int?,
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

data class AuftragsPauseAnsicht(val art: String, val artText: Int?, val bis: String?, val grund: String)

data class HintergrundAnsicht(
    val auftraege: List<AuftragAnsicht>,
    val pausen: List<AuftragsPauseAnsicht>,
    val bildbedarf: Int,
    /** False: Kein Job-Prozess meldet sich — dann bewegt sich keiner der Aufträge. */
    val jobProzessLaeuft: Boolean,
)

fun Auftrag.alsAnsicht() = AuftragAnsicht(
    id = id, art = art, artText = auftragsArtText(art), status = AuftragStatus.aus(status),
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
    pausen = pausen.map { AuftragsPauseAnsicht(it.art, auftragsArtText(it.art), it.bis, it.grund.orEmpty()) },
    bildbedarf = bildbedarf,
    jobProzessLaeuft = jobProzess.laeuft,
)

/** Die Namen der Arten wie in der Webapp (monitor.art.*); unbekannte zeigt die Liste roh. */
fun auftragsArtText(art: String): Int? = when (art) {
    "nacharbeit" -> R.string.art_nacharbeit
    "bilder" -> R.string.art_bilder
    "pdf" -> R.string.art_pdf
    "csv_import" -> R.string.art_csv_import
    "wechselkurse" -> R.string.art_wechselkurse
    "anleitung" -> R.string.art_anleitung
    "brickset" -> R.string.art_brickset
    "bildbedarf" -> R.string.art_bildbedarf
    "bilder_neu_laden" -> R.string.art_bilder_neu_laden
    "nachlauf" -> R.string.art_nachlauf
    "csv_sync" -> R.string.art_csv_sync
    "preise" -> R.string.art_preise
    "bild_nachlauf" -> R.string.art_bild_nachlauf
    "aufraeumen" -> R.string.art_aufraeumen
    "aufraeumen_taeglich" -> R.string.art_aufraeumen_taeglich
    else -> null
}
