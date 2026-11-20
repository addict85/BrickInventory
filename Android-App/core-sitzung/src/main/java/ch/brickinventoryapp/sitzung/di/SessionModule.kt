package ch.brickinventoryapp.sitzung.di

import ch.brickinventoryapp.sitzung.StoreAccountValues
import ch.brickinventoryapp.sitzung.Kontowerte
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.sitzung.SitzungsDienst
import ch.brickinventoryapp.sitzung.SitzungsRepository
import ch.brickinventoryapp.sitzung.SessionState
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** Die Bereiche sehen nur die Schnittstellen der Sitzung; die Umsetzungen sind Singletons. */
@Module
@InstallIn(SingletonComponent::class)
object SessionModule {
    @Provides fun provideSession(s: SessionState): Sitzung = s
    @Provides fun provideSitzungsRepository(d: SitzungsDienst): SitzungsRepository = d
    @Provides fun provideKontowerte(k: StoreAccountValues): Kontowerte = k
}
