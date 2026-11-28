package ch.brickinventoryapp.services.service

import ch.brickinventoryapp.dataapi.parts.ExportResult
import ch.brickinventoryapp.dataapi.parts.PartListsExport
import ch.brickinventoryapp.dataapi.parts.PdfFailure
import ch.brickinventoryapp.model.domain.PartListJob
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.outcome.Outcome
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/** Hands the job to the manager and waits for its end; WorkManager stays here and never reaches a ViewModel. */
internal class ServiceExport @Inject constructor(
    private val manager: PdfExportManager,
) : PartListsExport {
    override val progress: Flow<PdfProgress?> = manager.state.map { (it as? PdfExportState.Running)?.progress }

    override suspend fun generate(job: PartListJob): ExportResult {
        manager.commission(job)
        return when (val r = manager.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> ExportResult.FileEntry(r.file)
            is PdfExportState.Error -> ExportResult.Failure(r.reason)
            // Without an else branch, so a new state stands out here; first{} doesn't let both through.
            is PdfExportState.Idle, is PdfExportState.Running ->
                ExportResult.Failure(PdfFailure.Fetch(Outcome.Failure.Unknown()))
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal interface PartListsExportModule {
    @Binds fun export(e: ServiceExport): PartListsExport
}
