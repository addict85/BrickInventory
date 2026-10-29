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

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

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

    // Die herausgelösten ViewModels sehen Texte und Dateien nur über diese
    // Schnittstellen — so laufen sie im JVM-Test ohne Context.
    @Provides
    fun provideTexte(t: ch.brickinventoryapp.ui.viewmodel.AppTexte): ch.brickinventoryapp.ui.viewmodel.Texte = t

    @Provides
    fun provideDateiLeser(l: ch.brickinventoryapp.ui.viewmodel.AppDateiLeser): ch.brickinventoryapp.ui.viewmodel.DateiLeser = l

    @Provides
    fun provideAnmeldeablage(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.Anmeldeablage = p

    @Provides
    fun provideCacheBesitzer(p: ch.brickinventoryapp.data.PreferencesManager): ch.brickinventoryapp.data.cache.CacheBesitzer = p

    @Provides
    fun provideSetAnleger(c: ch.brickinventoryapp.data.SetAnlegenSseClient): ch.brickinventoryapp.data.SetAnleger = c

    @Provides
    fun provideFilterAblage(a: ch.brickinventoryapp.ui.ScopeFilterAblage): ch.brickinventoryapp.ui.FilterAblage = a
}
