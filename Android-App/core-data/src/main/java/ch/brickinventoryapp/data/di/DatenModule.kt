package ch.brickinventoryapp.data.di

import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.core.DataStore
import ch.brickinventoryapp.data.KontoAblage
import ch.brickinventoryapp.data.TokenAblage
import ch.brickinventoryapp.data.util.EntsperrTresor
import ch.brickinventoryapp.data.util.Geraetesperre
import ch.brickinventoryapp.data.util.KeystoreTokenTresor
import ch.brickinventoryapp.data.util.TokenVerschluesselung
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
import ch.brickinventoryapp.data.util.Ablageschluessel
import ch.brickinventoryapp.data.util.Vertrauenschiffre
import android.app.KeyguardManager
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import ch.brickinventoryapp.data.Entwertungsquelle
import ch.brickinventoryapp.data.cache.CacheBesitzer

/** Schnittstellen der Datenschicht und ihre Umsetzungen, wo die Datenschicht sie kennt. */
@Module
@InstallIn(SingletonComponent::class)
internal object DatenModule {

    /**
     * Die Token-Verschlüsselung als Schnittstelle bereitstellen, nicht als konkrete
     * Klasse: Die Umsetzung braucht den Android-Keystore und läuft nur auf einem
     * Gerät. Fest daran gebunden liesse sich die Übernahme-Logik der
     * TokenAblage nicht auf der JVM prüfen — und die entscheidet, ob
     * bestehende Installationen beim Update angemeldet bleiben.
     */
    @Provides
    @Singleton
    fun provideTokenVerschluesselung(): TokenVerschluesselung =
        EntsperrTresor(KeystoreTokenTresor(KeystoreTokenTresor.ALIAS_ENTSPERRT, nurEntsperrt = true), KeystoreTokenTresor())

    /** Gesperrt heisst hier: Der Schlüssel des Tokens gibt gerade nichts frei (EntsperrTresor). */
    @Provides
    @Singleton
    fun provideGeraetesperre(@ApplicationContext context: Context): Geraetesperre {
        val waechter = context.getSystemService(KeyguardManager::class.java)
        return Geraetesperre { waechter?.isDeviceLocked == true }
    }

    /** Der Schlüssel der lokalen Ablagen; umhüllt unter eigenem Alias, abgelegt ohne Sicherung. */
    @Provides
    @Singleton
    fun provideAblageschluessel(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context,
    ): Ablageschluessel = Ablageschluessel(
        java.io.File(context.noBackupFilesDir, "ablage.schluessel"), KeystoreTokenTresor("brickinventory_ablage"),
    )

    /** Pins und Nutzer-CA-Schalter: eigener Schlüssel, damit das Abmelden sie nicht unlesbar macht. */
    @Provides
    @Singleton
    fun provideVertrauenschiffre(
        @dagger.hilt.android.qualifiers.ApplicationContext context: Context,
    ): Vertrauenschiffre {
        val schluessel = Ablageschluessel(
            File(context.noBackupFilesDir, "vertrauen.schluessel"), KeystoreTokenTresor("brickinventory_vertrauen"),
        )
        return Vertrauenschiffre { schluessel.fuer("vertrauen") }
    }

    @Provides
    @Singleton
    fun provideJson(): Json = ApiJson

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
    ): TokenTausch = TokenTausch(
        stand = { p.tokenStand() },
        ersetze = { vorher, neu, herkunft -> p.ersetzeGetauschtenToken(vorher, neu, herkunft) },
        rotiere = { konto.get().tokenRotieren(it) },
        hintergrund = bereich,
    )

    @Provides
    fun provideSetAnleger(c: SetAnlegenSseClient): SetAnleger = c
}
