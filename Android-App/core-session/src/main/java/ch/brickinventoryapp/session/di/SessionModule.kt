package ch.brickinventoryapp.session.di

import ch.brickinventoryapp.session.StoreAccountValues
import ch.brickinventoryapp.session.AccountValues
import ch.brickinventoryapp.session.Session
import ch.brickinventoryapp.session.SessionService
import ch.brickinventoryapp.session.SessionRepository
import ch.brickinventoryapp.session.SessionState
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

/** The scopes see only the session's interfaces; the implementations are singletons. */
@Module
@InstallIn(SingletonComponent::class)
object SessionModule {
    @Provides fun provideSession(s: SessionState): Session = s
    @Provides fun provideSessionRepository(d: SessionService): SessionRepository = d
    @Provides fun provideAccountValues(k: StoreAccountValues): AccountValues = k
}
