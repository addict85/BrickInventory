package ch.brickinventoryapp.service

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import ch.brickinventoryapp.util.TEILELISTE_FRIST_MS
import ch.brickinventoryapp.util.raeumeAlteTeilelisteAuf
import java.util.concurrent.TimeUnit

/**
 * Löscht die exportierte Teileliste nach [TEILELISTE_FRIST_MS]: Sie liegt im Klartext,
 * weil die Ziel-App sie über den FileProvider lesen muss, aber nicht länger als nötig.
 * Die Meldung „fertig, antippen“ verschwindet mit, sie zeigte sonst ins Leere.
 */
class TeilelistenAufraeumer(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        if (raeumeAlteTeilelisteAuf(applicationContext.filesDir, System.currentTimeMillis())) {
            NotificationManagerCompat.from(applicationContext).cancel(PdfExportService.FERTIG_ID)
        }
        return Result.success()
    }

    companion object {
        private const val NAME = "teileliste-aufraeumen"

        /** REPLACE: Die Frist läuft ab der neusten Teileliste. */
        fun plane(context: Context) {
            val auftrag = OneTimeWorkRequestBuilder<TeilelistenAufraeumer>()
                .setInitialDelay(TEILELISTE_FRIST_MS, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, auftrag)
        }
    }
}
