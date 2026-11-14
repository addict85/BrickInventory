package ch.brickinventoryapp.data.di

import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.core.DataStore
import ch.brickinventoryapp.data.KontoAblage
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.sicherheit.Geraetesperre
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton
import ch.brickinventoryapp.data.Anmeldeablage
import ch.brickinventoryapp.data.SetAnleger
import ch.brickinventoryapp.data.AnlegenMitAblage
import ch.brickinventoryapp.data.TokenTausch
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.data.repository.KontoRepository
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import ch.brickinventoryapp.data.Entwertungsquelle
import ch.brickinventoryapp.data.cache.CacheBesitzer

/** Schnittstellen der Datenschicht und ihre Umsetzungen, wo die Datenschicht sie kennt. */
@Module
@InstallIn(SingletonComponent::class)
internal object DatenModule {

    @Provides
    @Singleton
    fun provideJson(): Json = BrickJson

    /** Ein DataStore je Datei und Prozess; über Hilt statt über eine Erweiterung an Context. */
    @Provides
    @Singleton
    fun provideDataStore(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
    ): DataStore<Preferences> = PreferenceDataStoreFactory.create { context.preferencesDataStoreFile("app_prefs") }

    @Provides
    fun provideAnmeldeablage(p: KontoAblage): Anmeldeablage = p

    @Provides
    fun provideEntwertungsquelle(p: TokenAblage): Entwertungsquelle = p

    @Provides
    fun provideCacheBesitzer(p: TokenAblage): CacheBesitzer = p

    /**
     * Der Tausch des Tokens. Provider statt direkt: Das Konto-Repository hängt am
     * api-Client, und der braucht diesen Tausch — ohne den Umweg ein Kreis.
     */
    @Provides
    @javax.inject.Singleton
    fun provideTokenTausch(
        p: TokenAblage,
        konto: javax.inject.Provider<KontoRepository>,
        @ApplicationScope bereich: kotlinx.coroutines.CoroutineScope,
        sperre: Geraetesperre,
    ): TokenTausch = TokenTausch(
        stand = { p.tokenStand() },
        ersetze = { vorher, neu, herkunft -> p.ersetzeGetauschtenToken(vorher, neu, herkunft) },
        rotiere = { konto.get().tokenRotieren(it) },
        hintergrund = bereich,
        bereit = { !sperre.gesperrt() },
    )

    @Provides
    fun provideSetAnleger(c: AnlegenMitAblage): SetAnleger = c
}
