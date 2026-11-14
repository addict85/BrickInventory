package ch.brickinventoryapp.sicherheit

import android.app.KeyguardManager
import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/** Die Tresore und Schlüssel der App; die Keystore-Umsetzungen bleiben in diesem Modul. */
@Module
@InstallIn(SingletonComponent::class)
internal object SicherheitModule {

    /**
     * Die Token-Verschlüsselung als Schnittstelle bereitstellen, nicht als konkrete
     * Klasse: Die Umsetzung braucht den Android-Keystore und läuft nur auf einem
     * Gerät. Fest daran gebunden liesse sich die Übernahme-Logik der
     * TokenAblage nicht auf der JVM prüfen.
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

    /**
     * Der Schlüssel der lokalen Ablagen (Bestand, Kaufpreise, Ausgang); umhüllt wie das Token
     * unter einem Alias, der nur entsperrt arbeitet. Der Ausgang braucht keinen eigenen: Senden
     * geht ohnehin erst mit dem Token, und das öffnet sich auch nur entsperrt.
     */
    @Provides
    @Singleton
    fun provideAblageschluessel(@ApplicationContext context: Context): Ablageschluessel =
        Ablageschluessel(
            File(context.noBackupFilesDir, "ablage.schluessel"),
            EntsperrTresor(KeystoreTokenTresor(ALIAS_ABLAGE_ENTSPERRT, nurEntsperrt = true), KeystoreTokenTresor(ALIAS_ABLAGE)),
        )

    /** Pins und Nutzer-CA-Schalter: eigener Schlüssel, damit das Abmelden sie nicht unlesbar macht. */
    @Provides
    @Singleton
    fun provideVertrauenschiffre(@ApplicationContext context: Context): Vertrauenschiffre {
        val schluessel = Ablageschluessel(
            File(context.noBackupFilesDir, "vertrauen.schluessel"), KeystoreTokenTresor("brickinventory_vertrauen"),
        )
        return Vertrauenschiffre { schluessel.fuer("vertrauen") }
    }

    @Provides
    fun zertifikatsFrage(z: ZertifikatsRueckfrage): ZertifikatsFrage = z

    private const val ALIAS_ABLAGE = "brickinventory_ablage"
    /** Eigener Alias: Ein bestehender Schlüssel nimmt die Bedingung nachträglich nicht an. */
    private const val ALIAS_ABLAGE_ENTSPERRT = "brickinventory_ablage_entsperrt"
}
