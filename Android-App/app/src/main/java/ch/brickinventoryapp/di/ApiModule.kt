package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.api.FigurenApi
import ch.brickinventoryapp.data.api.FinanzenApi
import ch.brickinventoryapp.data.api.GutscheineApi
import ch.brickinventoryapp.data.api.HaushaltApi
import ch.brickinventoryapp.data.api.KatalogApi
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.api.TeileApi
import ch.brickinventoryapp.data.api.VerwaltungApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import retrofit2.Retrofit
import javax.inject.Singleton

/**
 * Je Bereich der Schnittstelle ein Binding (data/api/): Jedes Repository bekommt
 * nur seinen Bereich und kann nichts anderes aufrufen. Ein Retrofit, ein Client —
 * das Netzverhalten steht in NetzModule und ist für alle Bereiche dasselbe.
 */
@Module
@InstallIn(SingletonComponent::class)
object ApiModule {
    @Provides @Singleton fun provideKontoApi(r: Retrofit): KontoApi = r.create(KontoApi::class.java)
    @Provides @Singleton fun provideVerwaltungApi(r: Retrofit): VerwaltungApi = r.create(VerwaltungApi::class.java)
    @Provides @Singleton fun provideKatalogApi(r: Retrofit): KatalogApi = r.create(KatalogApi::class.java)
    @Provides @Singleton fun provideSetsApi(r: Retrofit): SetsApi = r.create(SetsApi::class.java)
    @Provides @Singleton fun provideTeileApi(r: Retrofit): TeileApi = r.create(TeileApi::class.java)
    @Provides @Singleton fun provideFigurenApi(r: Retrofit): FigurenApi = r.create(FigurenApi::class.java)
    @Provides @Singleton fun provideHaushaltApi(r: Retrofit): HaushaltApi = r.create(HaushaltApi::class.java)
    @Provides @Singleton fun provideFinanzenApi(r: Retrofit): FinanzenApi = r.create(FinanzenApi::class.java)
    @Provides @Singleton fun provideGutscheineApi(r: Retrofit): GutscheineApi = r.create(GutscheineApi::class.java)
}
