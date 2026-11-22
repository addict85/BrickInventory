package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.JobStatus

// The texts for jobs belong to the display: the UI model in core-model knows
// no Android resources.

/** Text of a job state; DONE and UNBEKANNT show none. */
internal val JobStatus.statusText: Int?
    get() = when (this) {
        JobStatus.OPEN -> R.string.background_open
        JobStatus.RUNNING -> R.string.background_running
        JobStatus.ERROR -> R.string.background_error
        JobStatus.CANCELLED -> R.string.background_cancelled
        JobStatus.DONE, JobStatus.UNKNOWN -> null
    }

/** The names of the kinds as in the web app (monitor.art.*); unknown ones are shown raw by the list. */
internal fun jobKindText(kind: String): Int? = when (kind) {
    "nacharbeit" -> R.string.kind_rework
    "bilder" -> R.string.kind_images
    "pdf" -> R.string.kind_pdf
    "csv_import" -> R.string.kind_csv_import
    "wechselkurse" -> R.string.kind_exchange_rates
    "anleitung" -> R.string.kind_instruction
    "brickset" -> R.string.kind_brickset
    "bildbedarf" -> R.string.kind_image_demand
    "bilder_neu_laden" -> R.string.kind_images_new_load
    "nachlauf" -> R.string.kind_follow_up
    "csv_sync" -> R.string.kind_csv_sync
    "preise" -> R.string.kind_prices
    "bild_nachlauf" -> R.string.kind_image_follow_up
    "aufraeumen" -> R.string.kind_clean_up
    "aufraeumen_taeglich" -> R.string.kind_clean_up_daily
    else -> null
}
