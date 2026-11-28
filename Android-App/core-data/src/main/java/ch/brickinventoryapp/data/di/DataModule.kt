package ch.brickinventoryapp.data.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import ch.brickinventoryapp.data.AccountStore
import ch.brickinventoryapp.data.CreateWithStore
import ch.brickinventoryapp.data.LoginStore
import ch.brickinventoryapp.data.RedemptionSource
import ch.brickinventoryapp.data.SetCreator
import ch.brickinventoryapp.data.TokenStore
import ch.brickinventoryapp.data.TokenSwap
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.cache.CacheOwner
import ch.brickinventoryapp.model.address.AddressRules
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.network.util.NetworkAddressRules
import ch.brickinventoryapp.security.DeviceLock
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton

/** Interfaces of the data layer and their implementations, where the data layer knows them. */
@Module
@InstallIn(SingletonComponent::class)
internal object DataModule {

    @Provides
    @Singleton
    fun provideJson(): Json = BrickJson

    /** The guard's address rules, for screens that must not know the network layer. */
    @Provides
    fun provideAddressRules(): AddressRules = NetworkAddressRules

    /** One DataStore per file and process; via Hilt instead of via an extension on Context. */
    @Provides
    @Singleton
    fun provideDataStore(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("app_prefs") }

    @Provides
    fun provideLoginStore(p: AccountStore): LoginStore = p

    @Provides
    fun provideRedemptionSource(p: TokenStore): RedemptionSource = p

    @Provides
    fun provideCacheOwner(p: TokenStore): CacheOwner = p

    /**
     * The token swap. Provider instead of directly: the account repository depends on the
     * api client, and that needs this swap — without the detour a cycle.
     */
    @Provides
    @javax.inject.Singleton
    fun provideTokenSwap(
        p: TokenStore,
        account: javax.inject.Provider<AccountRepository>,
        @ApplicationScope area: kotlinx.coroutines.CoroutineScope,
        lock: DeviceLock,
    ): TokenSwap = TokenSwap(
        state = { p.tokenStatus() },
        replace = { before, newValue, origin -> p.replaceSwappedToken(before, newValue, origin) },
        rotate = { account.get().rotateToken(it) },
        background = area,
        ready = { !lock.locked() },
    )

    @Provides
    fun provideSetCreator(c: CreateWithStore): SetCreator = c
}
