package ch.brickinventoryapp.dienste.service

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import ch.brickinventoryapp.data.util.PART_LIST_DEADLINE_MS
import ch.brickinventoryapp.data.util.cleanOldPartListOn
import java.util.concurrent.TimeUnit

/**
 * Löscht die exportierte Teileliste nach [PART_LIST_DEADLINE_MS]: Auch verschlüsselt soll
 * das Inventar nur so lange auf dem Gerät liegen, wie jemand es öffnen will.
 * Die Meldung „fertig, antippen“ verschwindet mit, sie zeigte sonst ins Leere.
 */
internal class PartListsAufraeumer(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        if (cleanOldPartListOn(applicationContext.filesDir, System.currentTimeMillis())) {
            NotificationManagerCompat.from(applicationContext).cancel(PdfExportService.DONE_ID)
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "teileliste-aufraeumen"

        /** REPLACE: Die Frist läuft ab der neusten Teileliste. */
        fun plane(context: Context) {
            val job = OneTimeWorkRequestBuilder<PartListsAufraeumer>()
                .setInitialDelay(PART_LIST_DEADLINE_MS, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, job)
        }
    }
}
