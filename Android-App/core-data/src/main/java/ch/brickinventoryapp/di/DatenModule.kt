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
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.SetAnlegenSseClient
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.util.Ablageschluessel
import ch.brickinventoryapp.data.Entwertungsquelle
import ch.brickinventoryapp.data.cache.CacheBesitzer

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

    /** Der Schlüssel der lokalen Ablagen; umhüllt unter eigenem Alias, abgelegt ohne Sicherung. */
    @Provides
    @Singleton
    fun provideAblageschluessel(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
    ): Ablageschluessel = Ablageschluessel(
        java.io.File(context.noBackupFilesDir, "ablage.schluessel"), KeystoreTokenTresor("brickinventory_ablage"),
    )

    @Provides
    @Singleton
    fun provideJson(): Json = ApiJson

    @Provides
    fun provideAnmeldeablage(p: PreferencesManager): Anmeldeablage = p

    @Provides
    fun provideEntwertungsquelle(p: PreferencesManager): Entwertungsquelle = p

    @Provides
    fun provideCacheBesitzer(p: PreferencesManager): CacheBesitzer = p

    /**
     * Der Tausch des Tokens. Provider statt direkt: Das Konto-Repository hängt am
     * api-Client, und der braucht diesen Tausch — ohne den Umweg ein Kreis.
     */
    @Provides
    @javax.inject.Singleton
    fun provideTokenTausch(
        p: PreferencesManager,
        konto: javax.inject.Provider<KontoRepository>,
        @ApplicationScope bereich: kotlinx.coroutines.CoroutineScope,
    ): TokenTausch = TokenTausch(
        stand = { p.tokenStand() },
        ersetze = { vorher, neu, herkunft -> p.ersetzeGetauschtenToken(vorher, neu, herkunft) },
        rotiere = { konto.get().tokenRotieren(it) },
        hintergrund = bereich,
    )

    @Provides
    fun provideSetAnleger(c: SetAnlegenSseClient): SetAnleger = c
}
