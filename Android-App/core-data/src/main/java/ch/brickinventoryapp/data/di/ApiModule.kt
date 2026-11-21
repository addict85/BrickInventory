package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.data.api.MinifigsApi
import ch.brickinventoryapp.data.api.FinancesApi
import ch.brickinventoryapp.data.api.VouchersApi
import ch.brickinventoryapp.data.api.HouseholdApi
import ch.brickinventoryapp.data.api.CatalogApi
import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.ManagementApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import retrofit2.Retrofit
import javax.inject.Singleton

/**
 * One binding per area of the interface (data/api/): every repository gets
 * only its area and cannot call anything else. One Retrofit, one client —
 * the network behavior stands in NetzModule and is the same for all areas.
 */
@Module
@InstallIn(SingletonComponent::class)
internal object ApiModule {
    @Provides @Singleton fun provideAccountApi(r: Retrofit): AccountApi = r.create(AccountApi::class.java)
    @Provides @Singleton fun provideManagementApi(r: Retrofit): ManagementApi = r.create(ManagementApi::class.java)
    @Provides @Singleton fun provideCatalogApi(r: Retrofit): CatalogApi = r.create(CatalogApi::class.java)
    @Provides @Singleton fun provideSetsApi(r: Retrofit): SetsApi = r.create(SetsApi::class.java)
    @Provides @Singleton fun providePartsApi(r: Retrofit): PartsApi = r.create(PartsApi::class.java)
    @Provides @Singleton fun provideMinifigsApi(r: Retrofit): MinifigsApi = r.create(MinifigsApi::class.java)
    @Provides @Singleton fun provideHouseholdApi(r: Retrofit): HouseholdApi = r.create(HouseholdApi::class.java)
    @Provides @Singleton fun provideFinancesApi(r: Retrofit): FinancesApi = r.create(FinancesApi::class.java)
    @Provides @Singleton fun provideVouchersApi(r: Retrofit): VouchersApi = r.create(VouchersApi::class.java)
    @Provides @Singleton fun provideDeviceApi(r: Retrofit): DeviceApi = r.create(DeviceApi::class.java)
}
