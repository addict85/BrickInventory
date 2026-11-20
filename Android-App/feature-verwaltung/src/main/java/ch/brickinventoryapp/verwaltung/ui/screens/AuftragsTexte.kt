package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.fach.JobStatus

// Die Texte zu Aufträgen gehören zur Anzeige: Das UI-Modell in core-model kennt
// keine Android-Ressourcen.

/** Text eines Auftragszustands; DONE und UNBEKANNT zeigen keinen. */
internal val JobStatus.statusText: Int?
    get() = when (this) {
        JobStatus.OFFEN -> R.string.hintergrund_offen
        JobStatus.LAEUFT -> R.string.hintergrund_laeuft
        JobStatus.FEHLER -> R.string.hintergrund_fehler
        JobStatus.ABGEBROCHEN -> R.string.hintergrund_abgebrochen
        JobStatus.DONE, JobStatus.UNBEKANNT -> null
    }

/** Die Namen der Arten wie in der Webapp (monitor.art.*); unbekannte zeigt die Liste roh. */
internal fun jobKindText(art: String): Int? = when (art) {
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
