package ch.brickinventoryapp.di

import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.util.KeystoreTokenTresor
import ch.brickinventoryapp.util.TokenVerschluesselung
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton

/** Schnittstellen der Datenschicht und ihre Umsetzungen, wo die Datenschicht sie kennt. */
@Module
@InstallIn(SingletonComponent::class)
object DatenModule {

    /**
     * Die Token-Verschlüsselung als Schnittstelle bereitstellen, nicht als konkrete
     * Klasse: Die Umsetzung braucht den Android-Keystore und läuft nur auf einem
     * Gerät. Fest daran gebunden liesse sich die Übernahme-Logik des
     * PreferencesManagers nicht auf der JVM prüfen — und die entscheidet, ob
     * bestehende Installationen beim Update angemeldet bleiben.
     */
    @Provides
    @Singleton
    fun provideTokenVerschluesselung(): TokenVerschluesselung = KeystoreTokenTresor()

    @Provides
    @Singleton
    fun provideJson(): Json = ch.brickinventoryapp.data.api.ApiJson

    @Provides
    fun provideAnmeldeablage(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Anmeldeablage = p

    @Provides
    fun provideCacheBesitzer(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.cache.CacheBesitzer = p

    /**
     * Der Tausch des Tokens. Provider statt direkt: Das Konto-Repository hängt am
     * api-Client, und der braucht diesen Tausch — ohne den Umweg ein Kreis.
     */
    @Provides
    @javax.inject.Singleton
    fun provideTokenTausch(
        p: ch.brickinventoryapp.data.PreferencesManager,
        konto: javax.inject.Provider<ch.brickinventoryapp.data.repository.KontoRepository>,
    ): ch.brickinventoryapp.data.TokenTausch = ch.brickinventoryapp.data.TokenTausch(
        token = { p.tokenJetzt() },
        speichere = { p.saveAuthToken(it) },
        rotiere = { konto.get().tokenRotieren(it) },
    )

    @Provides
    fun provideSetAnleger(c: ch.brickinventoryapp.data.SetAnlegenSseClient): ch.brickinventoryapp.data.SetAnleger = c
}
