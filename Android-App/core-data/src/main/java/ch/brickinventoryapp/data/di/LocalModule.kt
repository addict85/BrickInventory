package ch.brickinventoryapp.data.di

import android.content.Context
import ch.brickinventoryapp.data.AccountStore
import ch.brickinventoryapp.data.AlarmStore
import ch.brickinventoryapp.data.AppearanceStore
import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.CsvImportObserver
import ch.brickinventoryapp.data.CsvImportRepository
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.CsvImportStream
import ch.brickinventoryapp.data.DevicesCleanup
import ch.brickinventoryapp.data.DevicesSettings
import ch.brickinventoryapp.data.DevicesStore
import ch.brickinventoryapp.data.InstructionDownload
import ch.brickinventoryapp.data.InstructionRepository
import ch.brickinventoryapp.data.LanguageStore
import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.NetworkTrust
import ch.brickinventoryapp.data.PasswordRequired
import ch.brickinventoryapp.data.RedemptionLog
import ch.brickinventoryapp.data.RedemptionPlanner
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.SessionCleanup
import ch.brickinventoryapp.data.SessionEnd
import ch.brickinventoryapp.data.SessionStore
import ch.brickinventoryapp.data.TokenAdoption
import ch.brickinventoryapp.data.TokenMirror
import ch.brickinventoryapp.data.TokenStore
import ch.brickinventoryapp.data.TrustStore
import ch.brickinventoryapp.data.WidgetStatusStore
import ch.brickinventoryapp.data.cache.CacheOwner
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.cache.PreviewStore
import ch.brickinventoryapp.data.cache.areaName
import ch.brickinventoryapp.data.cache.cleanOldResponseStore
import ch.brickinventoryapp.data.local.Baseline
import ch.brickinventoryapp.data.local.EditingSender
import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ServerSender
import ch.brickinventoryapp.data.local.WorkManagerPlanner
import ch.brickinventoryapp.data.local.WorkManagerRedemption
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.offline.LocalInventory
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.Outbox
import ch.brickinventoryapp.offline.OutboxPlanner
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import javax.inject.Singleton

/**
 * The local store: Room (core-offline) for lists and outbox, WorkManager for
 * sending. The logic (OfflineStore, sync) knows only the interfaces and is
 * thus checkable without Android.
 */
@Module
@InstallIn(SingletonComponent::class)
internal abstract class LocalModule {
    @Binds abstract fun planner(p: WorkManagerPlanner): OutboxPlanner
    @Binds abstract fun redemption(p: WorkManagerRedemption): RedemptionPlanner
    @Binds abstract fun sender(s: ServerSender): EditingSender
    @Binds abstract fun baseline(a: Reconcile): Baseline
    @Binds abstract fun device(p: DevicesStore): DevicesSettings
    @Binds abstract fun sessionStore(p: AccountStore): SessionStore
    @Binds abstract fun appearance(p: DevicesStore): AppearanceStore
    @Binds abstract fun widgetStatusStore(p: DevicesStore): WidgetStatusStore
    @Binds abstract fun trustStore(p: DevicesStore): TrustStore
    @Binds abstract fun networkTrust(p: DevicesStore): NetworkTrust
    @Binds abstract fun alarmStore(p: DevicesStore): AlarmStore
    @Binds abstract fun redemptionLog(p: DevicesStore): RedemptionLog
    @Binds abstract fun languageStore(p: DevicesStore): LanguageStore
    @Binds abstract fun access(p: TokenStore): Credentials
    @Binds abstract fun loginState(p: TokenStore): LoginState
    @Binds abstract fun sessionEnd(p: TokenStore): SessionEnd
    @Binds abstract fun tokenMirror(p: TokenStore): TokenMirror
    @Binds abstract fun tokenAdoption(p: TokenStore): TokenAdoption
    @Binds abstract fun instructions(d: InstructionDownload): InstructionRepository
    @Binds abstract fun csvStream(c: CsvImportSseClient): CsvImportStream
    @Binds abstract fun csvImport(b: CsvImportObserver): CsvImportRepository
    @Binds abstract fun cleanup(b: DevicesCleanup): SessionCleanup
    @Binds abstract fun previewStore(v: PreviewMemory): PreviewStore

    companion object {
        @Provides @Singleton fun messages(): MessageChannel = MessageChannel()
        @Provides @Singleton fun passwordRequired(): PasswordRequired = PasswordRequired()
        @Provides @Singleton fun factorRequired(): SecondFactorRequired = SecondFactorRequired()

        /**
         * The area comes from the signed-in account, hashed: asked now for writing,
         * as the session's StateFlow for observing. On the first build it clears the former
         * response cache that it replaces.
         */
        @Provides
        @Singleton
        fun offlineStore(stock: LocalInventory, outbox: Outbox, owner: CacheOwner, planner: OutboxPlanner,
                          @ApplicationScope area: CoroutineScope, json: Json, @ApplicationContext ctx: Context,
                          @Dispatcher(BrickDispatchers.IO) io: CoroutineDispatcher): OfflineStore {
            area.launch(io) { runCatching { cleanOldResponseStore(ctx.noBackupFilesDir, ctx.cacheDir) } }
            return OfflineStore(stock, outbox, areaSource = { owner.accountArea()?.let(::areaName) },
                planner = planner,
                areaFlow = owner.accountAreaFlow().map { it?.let(::areaName) }
                    .stateIn(area, SharingStarted.Eagerly, null),
                log = { AppLog.warning("Ablage", it) }, json = json)
        }
    }
}
