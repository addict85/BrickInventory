package ch.brickinventoryapp.services.service

import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import android.content.Context
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.model.domain.PdfProgress
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/** Starts the foreground service with the job; the context stays here and never reaches a ViewModel. */
internal class ServiceExport @Inject constructor(
    private val manager: PdfExportManager,
    @param:ApplicationContext private val ctx: Context,
) : PartListsExport {
    override val fortschritt: Flow<PdfProgress?> = manager.state.map { (it as? PdfExportState.Running)?.fortschritt }

    override suspend fun erzeuge(job: Teilelistenauftrag): ExportResult {
        manager.commission(job)
        PdfExportService.start(ctx)
        return when (val r = manager.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> ExportResult.Datei(r.file)
            is PdfExportState.Error -> ExportResult.Fehler(r.grund)
            // Without an else branch, so a new state stands out here; first{} doesn't let both through.
            is PdfExportState.Idle, is PdfExportState.Running ->
                ExportResult.Fehler(PdfFailure.Abruf(Ergebnis.Fehler.Unbekannt()))
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PartListsExportModule {
    @Binds fun export(e: ServiceExport): PartListsExport
}
