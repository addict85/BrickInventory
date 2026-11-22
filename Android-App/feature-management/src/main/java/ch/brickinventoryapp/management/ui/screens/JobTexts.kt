package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.model.domain.JobStatus
import ch.brickinventoryapp.resources.R

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

/** The names of the kinds as in the web app (monitor.kind.*); unknown ones are shown raw by the list. */
internal fun jobKindText(kind: String): Int? = when (kind) {
    "rework" -> R.string.kind_rework
    "images" -> R.string.kind_images
    "pdf" -> R.string.kind_pdf
    "csv_import" -> R.string.kind_csv_import
    "exchange_rates" -> R.string.kind_exchange_rates
    "instructions" -> R.string.kind_instruction
    "brickset" -> R.string.kind_brickset
    "image_demand" -> R.string.kind_image_demand
    "images_reload" -> R.string.kind_images_new_load
    "followup" -> R.string.kind_follow_up
    "csv_sync" -> R.string.kind_csv_sync
    "prices" -> R.string.kind_prices
    "image_followup" -> R.string.kind_image_follow_up
    "cleanup" -> R.string.kind_clean_up
    "cleanup_daily" -> R.string.kind_clean_up_daily
    else -> null
}
