package ch.brickinventoryapp.service

import android.content.Context
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.File
import javax.inject.Inject

/** Ausgang eines PDF-Exports: die Datei oder die Meldung des Servers. */
sealed interface ExportErgebnis {
    data class Datei(val datei: File) : ExportErgebnis
    data class Fehler(val meldung: String?) : ExportErgebnis
}

/** Der PDF-Export als Vordergrund-Dienst, der länger lebt als der Bildschirm; im Test ein Double. */
interface TeilelistenExport {
    /** „…noch ~Xs“ eines laufenden Exports, null ohne Export. */
    val status: Flow<String?>
    suspend fun erzeuge(rumpf: String): ExportErgebnis
}

/** Startet den Vordergrund-Dienst; der Context bleibt hier und erreicht kein ViewModel. */
internal class DienstExport @Inject constructor(
    private val manager: PdfExportManager,
    @param:ApplicationContext private val ctx: Context,
) : TeilelistenExport {
    override val status: Flow<String?> = manager.state.map { (it as? PdfExportState.Running)?.statusText }

    override suspend fun erzeuge(rumpf: String): ExportErgebnis {
        manager.reset()
        manager.pendingBody = rumpf
        PdfExportService.start(ctx)
        return when (val r = manager.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> ExportErgebnis.Datei(r.file)
            is PdfExportState.Error -> ExportErgebnis.Fehler(r.message)
            // Ohne else-Zweig, damit ein neuer Zustand hier auffällt; first{} lässt beide nicht durch.
            is PdfExportState.Idle, is PdfExportState.Running -> ExportErgebnis.Fehler(null)
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal interface TeilelistenExportModul {
    @Binds fun export(e: DienstExport): TeilelistenExport
}
