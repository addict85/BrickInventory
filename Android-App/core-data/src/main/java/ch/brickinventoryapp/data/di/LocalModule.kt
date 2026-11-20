package ch.brickinventoryapp.data.di

import kotlinx.serialization.json.Json
import ch.brickinventoryapp.offline.Ausgang
import ch.brickinventoryapp.offline.ExitPlanner
import ch.brickinventoryapp.data.local.Abgleich
import ch.brickinventoryapp.data.local.Baseline
import ch.brickinventoryapp.data.local.Bearbeitungssender
import ch.brickinventoryapp.offline.LocalInventory
import ch.brickinventoryapp.offline.Offlineablage
import ch.brickinventoryapp.data.cache.CacheOwner
import ch.brickinventoryapp.data.cache.areaName
import ch.brickinventoryapp.data.cache.cleanOldResponseStore
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.launch
import ch.brickinventoryapp.data.local.ServerSender
import ch.brickinventoryapp.data.local.WorkManagerPlanner
import ch.brickinventoryapp.network.util.Protokoll
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStream
import ch.brickinventoryapp.data.CsvImportObserver
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.DevicesCleanup
import ch.brickinventoryapp.data.SitzungsBereinigung
import ch.brickinventoryapp.data.Darstellungsablage
import ch.brickinventoryapp.data.Widgetablage
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.data.AccountStore
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.data.AnleitungsDownload
import ch.brickinventoryapp.data.AnleitungsRepository
import ch.brickinventoryapp.data.Tokenspiegel
import ch.brickinventoryapp.data.Tokenuebernahme
import ch.brickinventoryapp.data.Netzvertrauen
import ch.brickinventoryapp.data.Alarmablage
import ch.brickinventoryapp.data.Entwertungsprotokoll
import ch.brickinventoryapp.data.Sprachablage
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.Vertrauensablage
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.data.SessionEnd
import ch.brickinventoryapp.data.local.WorkManagerRedemption
import ch.brickinventoryapp.data.RedemptionPlanner
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.Vorschauablage
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.MessageQueue
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.PasswordRequiredState
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.SecondFactorState

/**
 * Die lokale Ablage: Room (core-offline) für Listen und Ausgang, WorkManager fürs
 * Senden. Die Logik (Offlineablage, Abgleich) kennt nur die Schnittstellen und ist
 * so ohne Android prüfbar.
 */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class LocalModule {
    @Binds abstract fun planner(p: WorkManagerPlanner): ExitPlanner
    @Binds abstract fun redemption(p: WorkManagerRedemption): RedemptionPlanner
    @Binds abstract fun sender(s: ServerSender): Bearbeitungssender
    @Binds abstract fun baseline(a: Abgleich): Baseline
    @Binds abstract fun geraet(p: DevicesStore): DevicesSettings
    @Binds abstract fun sitzungsablage(p: AccountStore): Sitzungsablage
    @Binds abstract fun darstellung(p: DevicesStore): Darstellungsablage
    @Binds abstract fun widgetablage(p: DevicesStore): Widgetablage
    @Binds abstract fun vertrauensablage(p: DevicesStore): Vertrauensablage
    @Binds abstract fun netzvertrauen(p: DevicesStore): Netzvertrauen
    @Binds abstract fun alarmablage(p: DevicesStore): Alarmablage
    @Binds abstract fun entwertungsprotokoll(p: DevicesStore): Entwertungsprotokoll
    @Binds abstract fun sprachablage(p: DevicesStore): Sprachablage
    @Binds abstract fun access(p: TokenAblage): Credentials
    @Binds abstract fun anmeldestand(p: TokenAblage): Anmeldestand
    @Binds abstract fun sessionEnd(p: TokenAblage): SessionEnd
    @Binds abstract fun tokenspiegel(p: TokenAblage): Tokenspiegel
    @Binds abstract fun tokenuebernahme(p: TokenAblage): Tokenuebernahme
    @Binds abstract fun anleitungen(d: AnleitungsDownload): AnleitungsRepository
    @Binds abstract fun csvStream(c: CsvImportSseClient): CsvImportStream
    @Binds abstract fun csvImport(b: CsvImportObserver): CsvImportRepository
    @Binds abstract fun cleanup(b: DevicesCleanup): SitzungsBereinigung
    @Binds abstract fun vorschauablage(v: VorschauSpeicher): Vorschauablage
    @Binds abstract fun meldungen(m: MessageQueue): MeldungsKanal
    @Binds abstract fun passwordRequired(p: PasswordRequiredState): PasswordRequired
    @Binds abstract fun factorRequired(z: SecondFactorState): SecondFactorRequired

    companion object {
        /**
         * Der Bereich kommt aus dem angemeldeten Konto, gestreut: zum Schreiben jetzt gefragt,
         * zum Beobachten als StateFlow der Sitzung. Beim ersten Bau räumt sie den früheren
         * Antwort-Zwischenspeicher, den sie ersetzt.
         */
        @Provides
        @Singleton
        fun offlineablage(bestand: LocalInventory, ausgang: Ausgang, besitzer: CacheOwner, planner: ExitPlanner,
                          @ApplicationScope bereich: CoroutineScope, json: Json, @ApplicationContext ctx: Context,
                          @Dispatcher(BrickDispatchers.IO) io: CoroutineDispatcher): Offlineablage {
            bereich.launch(io) { runCatching { cleanOldResponseStore(ctx.noBackupFilesDir, ctx.cacheDir) } }
            return Offlineablage(bestand, ausgang, areaSource = { besitzer.accountArea()?.let(::areaName) },
                planner = planner,
                areaFlow = besitzer.accountAreaFlow().map { it?.let(::areaName) }
                    .stateIn(bereich, SharingStarted.Eagerly, null),
                protokoll = { Protokoll.warnung("Ablage", it) }, json = json)
        }
    }
}
