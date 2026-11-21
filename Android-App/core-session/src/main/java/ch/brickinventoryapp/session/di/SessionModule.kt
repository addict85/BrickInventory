package ch.brickinventoryapp.session.di

import ch.brickinventoryapp.session.StoreAccountValues
import ch.brickinventoryapp.session.Kontowerte
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.session.SitzungsDienst
import ch.brickinventoryapp.session.SitzungsRepository
import ch.brickinventoryapp.session.SessionState
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The scopes see only the session's interfaces; the implementations are singletons. */
@Module
@InstallIn(SingletonComponent::class)
object SessionModule {
    @Provides fun provideSession(s: SessionState): Sitzung = s
    @Provides fun provideSitzungsRepository(d: SitzungsDienst): SitzungsRepository = d
    @Provides fun provideKontowerte(k: StoreAccountValues): Kontowerte = k
}
