package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.coroutines.ApplicationScope
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.core.DataStore
import ch.brickinventoryapp.data.AccountStore
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.security.Geraetesperre
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.CreateWithStore
import ch.brickinventoryapp.data.TokenSwap
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.data.repository.AccountRepository
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.data.Entwertungsquelle
import ch.brickinventoryapp.data.cache.CacheOwner

/** Interfaces of the data layer and their implementations, where the data layer knows them. */
@Module
@InstallIn(SingletonComponent::class)
internal object DataModule {

    @Provides
    @Singleton
    fun provideJson(): Json = BrickJson

    /** One DataStore per file and process; via Hilt instead of via an extension on Context. */
    @Provides
    @Singleton
    fun provideDataStore(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("app_prefs") }

    @Provides
    fun provideAnmeldeablage(p: AccountStore): Anmeldeablage = p

    @Provides
    fun provideEntwertungsquelle(p: TokenAblage): Entwertungsquelle = p

    @Provides
    fun provideCacheOwner(p: TokenAblage): CacheOwner = p

    /**
     * The token swap. Provider instead of directly: the account repository depends on the
     * api client, and that needs this swap — without the detour a cycle.
     */
    @Provides
    @javax.inject.Singleton
    fun provideTokenSwap(
        p: TokenAblage,
        konto: javax.inject.Provider<AccountRepository>,
        @ApplicationScope bereich: kotlinx.coroutines.CoroutineScope,
        lock: Geraetesperre,
    ): TokenSwap = TokenSwap(
        stand = { p.tokenStatus() },
        ersetze = { vorher, neu, herkunft -> p.replaceSwappedToken(vorher, neu, herkunft) },
        rotiere = { konto.get().rotateToken(it) },
        hintergrund = bereich,
        bereit = { !lock.gesperrt() },
    )

    @Provides
    fun provideSetCreator(c: CreateWithStore): SetCreator = c
}
